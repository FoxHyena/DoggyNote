import { expect, test } from '@playwright/test'

const bg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test('defaults to dark on first visit', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('theme-toggle')).toHaveAttribute('data-mode', 'dark')
  expect(await bg(page)).toBe('rgb(28, 27, 26)')
})

test('toggle cycles dark → system → light → dark and recolours the page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const toggle = page.getByTestId('theme-toggle')
  const html = page.locator('html')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-mode', 'system')
  await expect(html).toHaveAttribute('data-theme', 'light') // OS says light

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-mode', 'light')
  await expect(html).toHaveAttribute('data-theme', 'light')
  expect(await bg(page)).toBe('rgb(243, 239, 233)')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-mode', 'dark')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  expect(await bg(page)).toBe('rgb(28, 27, 26)')
})

test('choice survives a reload with no flash of the other theme', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('theme-toggle').click() // system
  await page.getByTestId('theme-toggle').click() // light
  await page.reload()
  // Checked before app JS: the inline head script must already have set it.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('theme-toggle')).toHaveAttribute('data-mode', 'light')
})

test('system mode follows OS appearance changes live', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await page.getByTestId('theme-toggle').click() // system
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('shows dog-themed names in the shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Doghouse').first()).toBeVisible()
  await expect(page.getByText('Buried bones')).toBeVisible()
})
