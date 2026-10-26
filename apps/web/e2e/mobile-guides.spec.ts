import { expect, test, type Locator } from '@playwright/test'
import { chooseAppearance } from './helpers.ts'

async function reachable(el: Locator) {
  await expect(el).toBeInViewport()
  const box = (await el.boundingBox())!
  // A comfortable thumb target.
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('on a phone, the guide list opens from the header and the appearance icon is in reach', async ({ page }) => {
    await page.goto('/docs/explore-the-docs#keep-your-place')
    await expect(page.locator('#keep-your-place')).toBeInViewport()
    const position = await page.evaluate(() => scrollY)
    const browse = page.getByRole('button', { name: 'Browse guides' })
    await reachable(browse)
    await reachable(page.getByTestId('theme-toggle'))
    await browse.tap()
    const list = page.getByRole('navigation', { name: 'Guides', exact: true })
    await expect(list.getByRole('link', { name: 'All guides' })).toBeInViewport()
    // Opening the list doesn't lose your place in the guide.
    expect(await page.evaluate(() => scrollY)).toBe(position)
    await page.getByRole('button', { name: 'Close guides' }).tap()
    await expect(list.getByRole('link', { name: 'All guides' })).toBeHidden()
    await browse.tap()
    await list.getByRole('link', { name: 'Read comfortably' }).tap()
    await expect(page.getByRole('heading', { name: 'Read comfortably', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Browse guides' })).toHaveAttribute('aria-expanded', 'false')
    await chooseAppearance(page, 'Light', { tap: true })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('on a phone, the guides are grouped, and a guide’s screenshots fit and load', async ({ page }) => {
    await page.goto('/docs')
    await expect(page.locator('#docs-main').getByRole('heading', { name: 'Writing & drawing', level: 3 })).toBeVisible()
    await page.locator('.docs-guide-row', { hasText: 'Draw a sketch card' }).tap()
    await expect(page.getByRole('heading', { name: 'Draw a sketch card', exact: true, level: 1 })).toBeVisible()
    for (const figure of await page.locator('.docs-section figure').all()) {
      await figure.scrollIntoViewIfNeeded()
      const img = figure.locator('img:visible')
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
      expect((await img.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test('on a phone, the account sheet has the appearance icon and the guides link', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.getByTestId('account').tap()
  const sheet = page.getByRole('dialog', { name: 'Account', exact: true })
  await reachable(sheet.getByTestId('theme-toggle'))
  await expect(sheet.getByRole('link', { name: 'Guides' })).toBeInViewport()
  await chooseAppearance(sheet, 'Light', { tap: true })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await chooseAppearance(sheet, 'Dark', { tap: true })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
