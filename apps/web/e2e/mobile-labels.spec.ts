import { expect, test } from '@playwright/test'
import { cardByText, freshBoard, waitForSync } from './helpers.ts'
import { note, seedCards, tapOn } from './touch.ts'

test('touch label creation, editing and search remain reachable on a narrow board', async ({ page }) => {
  const labelName = `Lighting references ${crypto.randomUUID().slice(0, 8)} with a descriptive name`
  await freshBoard(page)
  await seedCards(page, [note('Touch lighting reference', 0, 0)])
  const card = cardByText(page, 'Touch lighting reference')
  await tapOn(page, card)
  await page.getByTestId('labels-button').tap()
  const dialog = page.getByTestId('labels-dialog')
  await expect(dialog).toBeVisible()
  await page.getByLabel('Label name', { exact: true }).fill(labelName)
  await page.getByRole('button', { name: 'Create', exact: true }).tap()
  await expect(card.locator('.label-chip')).toContainText('Lighting references')
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.getByLabel('Close labels').tap()
  // Finish the selection sheet to expose the phone's main navigation row.
  await page.getByTestId('selection-done').tap()
  await waitForSync(page)
  await page.getByTestId('open-fetch').tap()
  await page.getByTestId('fetch-input').fill(labelName)
  await page.getByTestId('fetch-hit').filter({ hasText: 'Touch lighting reference' }).tap()
  await expect(card).toHaveClass(/selected/)
})
