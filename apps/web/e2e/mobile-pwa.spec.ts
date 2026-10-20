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
