import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'

test('templates are discoverable by touch, keep modal focus, and create a usable board', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('board-more').tap()
  await page.getByTestId('open-templates').tap()
  const dialog = page.getByTestId('templates-dialog')
  await expect(dialog).toBeVisible()
  const bounds = (await dialog.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.getByTestId('template-project-brief').tap()
  await page.getByTestId('create-from-template').tap()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('board-name')).toHaveText('Project brief')
  await expect(page.getByTestId('card').first()).toBeVisible()
})
