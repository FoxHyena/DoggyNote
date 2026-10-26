import { expect, test, type Page } from '@playwright/test'
import { setAccountAppearance } from './helpers.ts'
import { surfaces } from '../../../packages/theme/src/tokens.ts'

// Add to Home Screen: a manifest with icons, a share target and theme colours.

test('the app can be installed on a phone home screen', async ({ page }) => {
  await page.goto('/')
  const href = await page.locator('link[rel=manifest]').getAttribute('href')
  const res = await page.request.get(href!)
  expect(res.ok()).toBe(true)
  const m = await res.json()
  expect(m.display).toBe('standalone')
  expect(m.share_target.action).toBe('/share')
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  for (const icon of [...m.icons, { src: await page.locator('link[rel=apple-touch-icon]').getAttribute('href') }]) {
    const r = await page.request.get(icon.src)
    expect(r.ok(), icon.src).toBe(true)
    expect(r.headers()['content-type']).toContain('image/png')
  }
  await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('meta[name=apple-mobile-web-app-status-bar-style]')).toHaveCount(0)
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('viewport-fit=cover')
})

test('the status bar colour follows the app theme', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  for (const mode of ['Light', 'Dark'] as const) {
    await setAccountAppearance(page, mode, { tap: true })
    const colours = await page.locator('meta[name=theme-color]').evaluateAll((els) => els.map((e) => e.getAttribute('content')))
    expect(colours.every((c) => c === surfaces[mode === 'Light' ? 'light' : 'dark'].panel)).toBe(true)
  }
})

test('installed iOS follows the host layout height, separately from the keyboard', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true })
    Object.defineProperty(navigator, 'platform', { value: 'iPhone' })
  })
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  const fullHeight = await page.evaluate(() => innerHeight)
  const reservedHeight = fullHeight - 62
  // Existing and fresh icons can expose different host bounds on the same OS.
  await page.evaluate((height) => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    window.dispatchEvent(new Event('resize'))
  }, reservedHeight)
  await expect.poll(async () => (await shellGeometry(page)).rootBottom).toBe(reservedHeight)
  expect((await shellGeometry(page)).dockBottom).toBe(reservedHeight)

  // A smaller visual viewport represents the keyboard, not a smaller app shell.
  await page.evaluate((height) => {
    Object.defineProperty(visualViewport!, 'height', { configurable: true, value: height })
    visualViewport!.dispatchEvent(new Event('resize'))
  }, reservedHeight - 200)
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--vv-height'))).toBe(`${reservedHeight - 200}px`)
  expect((await shellGeometry(page)).rootBottom).toBe(reservedHeight)

  await page.evaluate((height) => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    Object.defineProperty(visualViewport!, 'height', { configurable: true, value: height })
    window.dispatchEvent(new Event('pageshow'))
  }, fullHeight)
  await expect.poll(async () => (await shellGeometry(page)).dockBottom).toBe(fullHeight)
})

test('an installed Android app keeps the regular CSS viewport layout', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true })
    Object.defineProperty(navigator, 'platform', { value: 'Linux armv8l' })
  })
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/ios-standalone/)
  const fit = await shellGeometry(page)
  expect(fit.rootBottom).toBe(fit.screen)
  expect(fit.dockBottom).toBe(fit.screen)
})

// Playwright devices have zero safe-area insets and do not launch installed apps.
// Exercise nonzero insets in browser and installed-iOS layout paths;
// real iOS Home Screen launches remain a separate manual verification.
async function safeArea(page: Page, insets: { top: number; right: number; bottom: number; left: number }) {
  await page.evaluate((insets) => {
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          rule.style.cssText = rule.style.cssText.replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_, side: keyof typeof insets) => `${insets[side]}px`)
        }
        if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
      }
    }
    for (const sheet of document.styleSheets) visit(sheet.cssRules)
  }, insets)
}

async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const top = document.querySelector('.topbar')!
    const dock = document.querySelector('.mobile-dock')!
    const stage = document.querySelector('.stage')!
    const root = document.getElementById('root')!.getBoundingClientRect()
    const header = top.getBoundingClientRect()
    const nav = dock.getBoundingClientRect()
    const canvas = stage.getBoundingClientRect()
    const button = document.querySelector('[data-testid=tool-trash]')!.getBoundingClientRect()
    const navStyle = getComputedStyle(dock)
    return {
      rootTop: root.top, rootBottom: root.bottom,
      headerTop: header.top, headerBottom: header.bottom,
      headerRow: header.height - parseFloat(getComputedStyle(top).paddingTop),
      dockTop: nav.top, dockBottom: nav.bottom,
      dockPadding: parseFloat(navStyle.paddingBottom),
      dockRow: nav.height - parseFloat(navStyle.borderTopWidth) - parseFloat(navStyle.paddingTop) - parseFloat(navStyle.paddingBottom),
      buttonBottom: button.bottom, buttonHeight: button.height,
      canvasTop: canvas.top, canvasBottom: canvas.bottom,
      screen: innerHeight, scrollY,
    }
  })
}

test('the phone shell fills the browser viewport', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  const fit = await shellGeometry(page)
  expect(fit.rootTop).toBe(0)
  expect(fit.rootBottom).toBe(fit.screen)
  expect(fit.dockBottom).toBe(fit.screen)
  expect(fit.headerRow).toBeGreaterThanOrEqual(52)
})

for (const scenario of [
  { name: 'iOS 27 with a native status bar', version: 27, installed: true, top: 0, gap: 15 },
  { name: 'iOS 27 with an edge-to-edge installation', version: 27, installed: true, top: 62, gap: 15 },
  { name: 'iOS 26', version: 26, installed: true, top: 62, gap: 0 },
  { name: 'an unverified future Safari release', version: 28, installed: true, top: 62, gap: 0 },
  { name: 'Safari 27 in a browser tab', version: 27, installed: false, top: 0, gap: 0 },
  { name: 'iOS 27 in landscape', version: 27, installed: true, top: 0, gap: 0, landscape: true },
]) {
  test(`header clearance is correct for ${scenario.name}`, async ({ page }) => {
    await page.addInitScript(({ version, installed }) => {
      Object.defineProperty(navigator, 'standalone', { value: installed })
      Object.defineProperty(navigator, 'platform', { value: 'iPhone' })
      Object.defineProperty(navigator, 'userAgent', {
        value: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version}.0.1 Mobile/15E148 Safari/604.1`,
      })
    }, scenario)
    if (scenario.landscape) await page.setViewportSize({ width: 852, height: 393 })
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await safeArea(page, { top: scenario.top, right: 0, bottom: 34, left: 0 })
    const row = scenario.landscape ? 44 : 52
    const fit = await shellGeometry(page)
    // In landscape a 44px target plus the border can make the row 45px.
    expect(fit.headerRow).toBeGreaterThanOrEqual(row)
    expect(fit.headerRow).toBeLessThanOrEqual(row + 1)
    expect(fit.headerBottom).toBe(fit.headerRow + scenario.top + scenario.gap)
    expect(fit.canvasTop).toBe(fit.headerBottom)
    expect(fit.rootBottom).toBe(fit.screen)
    expect(fit.dockBottom).toBe(fit.screen)
    expect(fit.dockPadding).toBe(34)
    expect((await page.getByTestId('board-name').boundingBox())!.y).toBeGreaterThanOrEqual(scenario.top + scenario.gap)
  })
}

for (const standalone of [false, true]) {
  for (const landscape of [false, true]) {
    test(`safe areas are counted once in ${standalone ? 'installed iOS' : 'browser'}, ${landscape ? 'landscape' : 'portrait'}`, async ({ page }) => {
      if (standalone) await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { value: true })
        Object.defineProperty(navigator, 'platform', { value: 'iPhone' })
      })
      if (landscape) await page.setViewportSize({ width: 852, height: 393 })
      await page.goto('/')
      await expect(page.getByTestId('canvas')).toBeVisible()
      const insets = landscape ? { top: 0, right: 59, bottom: 21, left: 59 } : { top: 59, right: 0, bottom: 34, left: 0 }
      await safeArea(page, insets)
      const fit = await shellGeometry(page)
      expect(fit.rootTop).toBe(0)
      expect(fit.headerTop).toBe(0)
      expect(fit.rootBottom).toBe(fit.screen)
      expect(fit.dockBottom).toBe(fit.screen)
      expect(fit.dockPadding).toBe(insets.bottom)
      // In landscape the 48px Add button centres the other 44px targets.
      expect(fit.buttonBottom).toBe(fit.screen - insets.bottom - (fit.dockRow - fit.buttonHeight) / 2)
      expect(fit.headerRow).toBeGreaterThanOrEqual(landscape ? 44 : 52)
      expect(fit.canvasTop).toBe(fit.headerBottom)
      expect(fit.canvasBottom).toBe(fit.dockTop)
      expect(fit.canvasBottom).toBeGreaterThan(fit.canvasTop)
      expect(fit.scrollY).toBe(0)
    })
  }
}
