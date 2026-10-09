import { expect, test } from '@playwright/test'

// The e2e build is version 0.0.1; these mock what the server reports.

test('a newer web version offers a reload', async ({ page }) => {
  await page.route('**/api/version', (r) => r.fulfill({ json: { version: '0.1.42', minClient: '0.0.0' } }))
  await page.goto('/')
  const toast = page.getByTestId('update-toast')
  await expect(toast).toContainText('DoggyNote was updated')
  await expect(toast).toContainText('v0.1.42')
  const reloaded = page.waitForEvent('load')
  await page.getByTestId('apply-update').click()
  await reloaded
})

test('the same version shows nothing', async ({ page }) => {
  await page.route('**/api/version', (r) => r.fulfill({ json: { version: '0.0.1', minClient: '0.0.0' } }))
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByTestId('update-toast')).toHaveCount(0)
})

test('a client older than minClient must update', async ({ page }) => {
  await page.route('**/api/version', (r) => r.fulfill({ json: { version: '2.0.0', minClient: '2.0.0' } }))
  await page.goto('/')
  await expect(page.getByTestId('update-required')).toContainText('too old')
})
