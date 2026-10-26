import { expect, test, type Page } from '@playwright/test'
import { chooseAppearance } from './helpers.ts'

const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const accountMenu = (page: Page) => page.getByRole('dialog', { name: 'Account', exact: true })
async function appearance(page: Page) {
  await page.getByTestId('account').click()
  return accountMenu(page).getByTestId('theme-toggle')
}

test('defaults to dark on first visit', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await bg(page)).toBe('rgb(28, 27, 26)')
  const toggle = await appearance(page)
  await expect(toggle).toHaveAccessibleName('Appearance: Dark')
  await expect(toggle.locator('svg')).toHaveAttribute('data-icon', 'moon')
})

test('one icon cycles system, light and dark and recolours the page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  const toggle = await appearance(page)
  const html = page.locator('html')
  // Only one control: no radio buttons or dropdowns.
  await expect(accountMenu(page).getByRole('radio')).toHaveCount(0)
  await expect(accountMenu(page).locator('select')).toHaveCount(0)

  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Appearance: System')
  await expect(toggle.locator('svg')).toHaveAttribute('data-icon', 'system')
  await expect(toggle).toHaveAttribute('data-tooltip', 'Appearance: System. Switch to Light')
  await expect(html).toHaveAttribute('data-theme', 'light')

  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Appearance: Light')
  await expect(toggle.locator('svg')).toHaveAttribute('data-icon', 'sun')
  expect(await bg(page)).toBe('rgb(243, 239, 233)')

  await toggle.click()
  await expect(toggle).toHaveAccessibleName('Appearance: Dark')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  expect(await bg(page)).toBe('rgb(28, 27, 26)')
  // Safari leaves focus on <body> after a click; Escape still closes the menu.
  await page.keyboard.press('Escape')
  await expect(accountMenu(page)).toHaveCount(0)
  await expect(page.getByTestId('account')).toBeFocused()
})

test('choice survives a reload with no flash of the other theme', async ({ page }) => {
  await page.goto('/')
  await appearance(page)
  await chooseAppearance(accountMenu(page), 'Light')
  await page.reload({ waitUntil: 'domcontentloaded' })
  // The inline head script applies the saved choice before the app paints.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(await appearance(page)).toHaveAccessibleName('Appearance: Light')
})

test('system mode follows OS appearance changes live', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await appearance(page)
  await chooseAppearance(accountMenu(page), 'System')
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
  const toggle = menu.getByTestId('theme-toggle')
  // The appearance icon is the first control, so it has focus when the menu opens.
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAccessibleName('Appearance: System')
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAccessibleName('Appearance: Light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(account).toBeFocused()
  await expect(account).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByTestId('theme-toggle')).toBeFocused()
  await page.getByTestId('canvas').click({ position: { x: 15, y: 100 } })
  await expect(menu).toHaveCount(0)
  await expect(account).toHaveAttribute('aria-expanded', 'false')
})

test('shows dog-themed names in the shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Doghouse').first()).toBeVisible()
  await expect(page.getByText('Buried bones')).toBeVisible()
})
