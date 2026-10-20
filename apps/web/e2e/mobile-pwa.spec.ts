import { expect, test } from '@playwright/test'
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
  expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('viewport-fit=cover')
})

test('the status bar colour follows the app theme', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  for (const mode of ['Light', 'Dark'] as const) {
    await page.getByTestId('account').tap()
    await page.getByRole('radio', { name: mode, exact: true }).tap()
    await page.keyboard.press('Escape')
    const colours = await page.locator('meta[name=theme-color]').evaluateAll((els) => els.map((e) => e.getAttribute('content')))
    expect(colours.every((c) => c === surfaces[mode === 'Light' ? 'light' : 'dark'].panel)).toBe(true)
  }
})

test('the phone shell fills the screen, installed or not', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  const fit = await page.evaluate(() => {
    const top = document.querySelector('.topbar')!
    return {
      root: document.getElementById('root')!.getBoundingClientRect().height,
      dock: document.querySelector('.mobile-dock')!.getBoundingClientRect().bottom,
      row: top.getBoundingClientRect().height - parseFloat(getComputedStyle(top).paddingTop),
      screen: innerHeight,
    }
  })
  expect(fit.root).toBe(fit.screen)
  expect(fit.dock).toBe(fit.screen)
  expect(fit.row).toBeGreaterThanOrEqual(52)

  // Home-screen app: iOS shrinks height:100% by the status bar, so standalone sizes the
  // shell with 100vh. Browsers can't emulate display-mode, so check the shipped rule.
  const standalone = await page.evaluate(() =>
    [...document.styleSheets]
      .flatMap((s) => [...s.cssRules])
      .filter((r): r is CSSMediaRule => r instanceof CSSMediaRule && /display-mode:\s*standalone/.test(r.conditionText))
      .flatMap((r) => [...r.cssRules] as CSSStyleRule[])
      .some((r) => /#root/.test(r.selectorText) && r.style.height === '100vh'),
  )
  expect(standalone).toBe(true)
})
