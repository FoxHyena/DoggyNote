import { expect, test, type Page } from '@playwright/test'

const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const accountMenu = (page: Page) => page.getByRole('dialog', { name: 'Account', exact: true })
async function appearance(page: Page) {
  await page.getByTestId('account').click()
  return accountMenu(page).getByRole('radiogroup', { name: 'Appearance' })
}

test('defaults to dark on first visit', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await bg(page)).toBe('rgb(28, 27, 26)')
  await expect((await appearance(page)).getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
})

test('explicit system, light and dark choices recolour the page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const choices = await appearance(page)
  const html = page.locator('html')

  await choices.getByRole('radio', { name: 'System', exact: true }).click()
  await expect(choices.getByRole('radio', { name: 'System', exact: true })).toBeChecked()
  await expect(html).toHaveAttribute('data-theme', 'light')

  await choices.getByRole('radio', { name: 'Light', exact: true }).click()
  await expect(choices.getByRole('radio', { name: 'Light', exact: true })).toBeChecked()
  expect(await bg(page)).toBe('rgb(243, 239, 233)')

  await choices.getByRole('radio', { name: 'Dark', exact: true }).click()
  await expect(choices.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  expect(await bg(page)).toBe('rgb(28, 27, 26)')
})

test('choice survives a reload with no flash of the other theme', async ({ page }) => {
  await page.goto('/')
  await (await appearance(page)).getByRole('radio', { name: 'Light', exact: true }).click()
  await page.reload({ waitUntil: 'domcontentloaded' })
  // The inline head script applies the saved choice before the app paints.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect((await appearance(page)).getByRole('radio', { name: 'Light', exact: true })).toBeChecked()
})

test('system mode follows OS appearance changes live', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await (await appearance(page)).getByRole('radio', { name: 'System', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('account appearance works from the keyboard and dismisses without losing focus', async ({ page }) => {
  await page.goto('/')
  const account = page.getByTestId('account')
  await expect(account).toHaveAccessibleName('Account')
  await expect(account).toHaveAttribute('data-tooltip', 'Account')
  await expect(account).not.toContainText('rex')
  await account.focus()
  await page.keyboard.press('Enter')
  const menu = accountMenu(page)
  await expect(menu.getByText('rex', { exact: true })).toBeVisible()
  const dark = menu.getByRole('radio', { name: 'Dark', exact: true })
  await expect(dark).toBeFocused()
  await page.keyboard.press('Home')
  const system = menu.getByRole('radio', { name: 'System', exact: true })
  await expect(system).toBeChecked()
  await expect(system).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const light = menu.getByRole('radio', { name: 'Light', exact: true })
  await expect(light).toBeChecked()
  await expect(light).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(account).toBeFocused()
  await expect(account).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('radio', { name: 'Light', exact: true })).toBeFocused()
  await page.getByTestId('canvas').click({ position: { x: 15, y: 100 } })
  await expect(menu).toHaveCount(0)
  await expect(account).toHaveAttribute('aria-expanded', 'false')
})

test('shows dog-themed names in the shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Doghouse').first()).toBeVisible()
  await expect(page.getByText('Buried bones')).toBeVisible()
})
