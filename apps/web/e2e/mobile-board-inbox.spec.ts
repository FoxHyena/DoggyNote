import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { captureBoardImage } from './clipper-helpers.ts'

test('phone board Inbox previews and places an image while Private stays separate', async ({ page }) => {
  await freshBoard(page, 'Phone collection')
  const id = new URL(page.url()).hash.split('/b/')[1]
  await captureBoardImage(page.request, id)
  await page.goto(`/?boardInbox=${id}`)
  const panel = page.getByTestId('toybox-panel'), item = page.getByTestId('board-inbox-item')
  await expect(item).toBeVisible()
  await expect.poll(() => item.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  await page.screenshot({ path: `test-results/board-inbox-${test.info().project.name}.png`, animations: 'disabled' })
  await item.getByRole('button', { name: 'Place', exact: true }).tap()
  await expect(item).toHaveCount(0)
  await panel.getByRole('tab', { name: /^Private/ }).tap()
  await expect(page.getByTestId('toybox-input')).toBeVisible()
  await panel.getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(page.getByTestId('card-image')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
