import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'

test('tablet users can open people and point to the current viewport with a fingertip', async ({ page }) => {
  await freshBoard(page, 'A shared tablet board')
  const trigger = page.getByTestId('collaborators'), bounds = (await trigger.boundingBox())!
  expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44)
  await trigger.tap(); await expect(page.getByTestId('live-status')).toHaveText('Live')
  await page.getByRole('button', { name: 'Look here', exact: true }).tap()
  await expect(page.getByTestId('remote-ping')).toBeVisible()
  await expect(page.getByRole('log')).toContainText('rex pointed to a location on this board')
  await expect(page.getByTestId('remote-ping')).toHaveCount(0, { timeout: 5000 })
})
