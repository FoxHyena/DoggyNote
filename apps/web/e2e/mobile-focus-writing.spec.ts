import { expect, test } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'
import { note, seedCards, tapOn } from './touch.ts'

test('touch Focus opens a readable note and returns to the same card', async ({ page }, info) => {
  await freshBoard(page)
  await seedCards(page, [note('A small research note', 0, 0)])
  const card = page.getByTestId('card').first()
  const id = await card.getAttribute('data-card-id')
  await tapOn(page, card)
  await page.getByTestId('focus-note').tap()
  const surface = page.getByTestId('focus-surface')
  await expect(surface).toBeVisible()
  await expect(surface.getByTestId('note-editor')).toBeFocused()
  await expect(page.getByTestId('edit-dock')).toHaveCount(0)
  const bounds = (await surface.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const bold = surface.getByRole('button', { name: 'Bold', exact: true })
  const boldBounds = (await bold.boundingBox())!
  expect(boldBounds.width).toBeGreaterThanOrEqual(44)
  expect(boldBounds.height).toBeGreaterThanOrEqual(44)
  expect((await surface.getByTestId('focus-return').boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.keyboard.type(' expanded')
  await page.keyboard.press('ControlOrMeta+a')
  await bold.tap()
  if (process.env.FOCUS_SHOTS) await page.screenshot({ path: info.outputPath('focus-touch-writing.png'), scale: 'css' })
  await surface.getByTestId('focus-return').tap()
  await expect(surface).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(1)
  expect(await card.getAttribute('data-card-id')).toBe(id)
  await expect(card.locator('strong')).toContainText('expanded')
  await waitForSync(page)
  await page.reload()
  await expect(page.getByTestId('card')).toContainText('expanded')
})
