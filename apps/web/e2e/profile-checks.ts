import { expect, type Page } from '@playwright/test'
import { avatarUser } from './avatar-checks.ts'

export { avatarUser as profileUser }
export async function editProfile(page: Page, tap = false) {
  if (await page.getByTestId('account').getAttribute('aria-expanded') !== 'true') await (tap ? page.getByTestId('account').tap() : page.getByTestId('account').click())
  await (tap ? page.getByTestId('edit-profile').tap() : page.getByTestId('edit-profile').click())
  await expect(page.getByTestId('profile-editor')).toBeVisible()
  await expect(page.getByLabel('Display name', { exact: true })).toBeFocused()
}

export async function profileFlow(page: Page, tap = false) {
  const person = await avatarUser(page)
  const click = async (name: string) => {
    const button = page.getByTestId('profile-editor').getByRole('button', { name, exact: true })
    await (tap ? button.tap() : button.click())
  }
  await editProfile(page, tap)
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(`@${person.username}`)
  await expect(page.getByLabel('Username', { exact: true })).toHaveAttribute('readonly', '')
  const input = page.getByLabel('Display name', { exact: true })
  await input.fill('Unsaved name')
  await click('Cancel')
  await expect(page.getByTestId('edit-profile')).toBeFocused()
  await expect(page.locator('.account-menu-identity strong')).toHaveText(person.username)
  await editProfile(page, tap)
  await input.fill('  Oreo 🐺  ')
  await page.route('**/api/me/profile', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Could not save. Try again.' }) }), { times: 1 })
  await click('Save')
  await expect(page.getByRole('alert')).toContainText('Try again')
  await expect(input).toHaveValue('  Oreo 🐺  ')
  await click('Save')
  await expect(page.getByTestId('profile-editor')).toHaveCount(0)
  await expect(page.locator('.account-menu-identity strong')).toHaveText('Oreo 🐺')
  await expect(page.locator('.account-profile-text small')).toHaveText(`@${person.username}`)
  await page.reload()
  await page.getByTestId('account').click()
  await expect(page.locator('.account-menu-identity strong')).toHaveText('Oreo 🐺')
  // The acknowledged name remains usable when reopening the app offline.
  await page.route('**/api/**', route => route.abort())
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.getByTestId('account').click()
  await expect(page.locator('.account-menu-identity strong')).toHaveText('Oreo 🐺')
  await page.unroute('**/api/**')
  await editProfile(page, tap)
  await input.fill('')
  await click('Save')
  await expect(page.locator('.account-menu-identity strong')).toHaveText(person.username)
  expect((await (await page.request.get('/api/me')).json()).user.username).toBe(person.username)
}
