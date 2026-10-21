import { expect, test } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'
import { seedCards, tap, tapOn } from './touch.ts'

// On a phone: tap to select, tap again to open the colour panel beside the
// card, tap a dot. The selection bar's Edit opens it too; Done closes it.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

test('double-tap a colour card, tap a preset; Edit in the selection bar opens it again', async ({ page }) => {
  await seedCards(page, [{ type: 'swatch', x: 40, y: 40, w: 200, content: { hex: '#2F5D50' } }])
  const card = page.locator('[data-testid="card"][data-type="swatch"]')
  await expect(card).toHaveCount(1)
  const box = (await card.getByTestId('colour-paint').boundingBox())!
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await tap(page, p)
  await expect(card).toHaveClass(/selected/)
  await tap(page, p)
  const panel = page.getByTestId('colour-panel')
  await expect(panel).toBeVisible()
  // The whole panel fits on the phone screen, with finger-sized dots.
  const vp = page.viewportSize()!
  const pb = (await panel.boundingBox())!
  expect(pb.x).toBeGreaterThanOrEqual(0)
  expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width)
  expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height)
  const dot = panel.locator('[data-testid="colour-preset"][data-hex="#FFC53D"]')
  expect((await dot.boundingBox())!.width).toBeGreaterThanOrEqual(32)

  await dot.tap()
  await expect(card.getByTestId('colour-hex')).toHaveText('#FFC53D')
  await page.getByTestId('edit-done').tap()
  await expect(panel).toHaveCount(0)

  await tapOn(page, card.getByTestId('colour-paint'))
  await expect(card).toHaveClass(/selected/)
  await page.getByTestId('edit-card').tap()
  await expect(panel).toBeVisible()
  await panel.locator('[data-testid="colour-preset"][data-hex="#46A758"]').tap()
  await expect(card.getByTestId('colour-hex')).toHaveText('#46A758')
  // A tap on the board closes it.
  await tap(page, { x: vp.width / 2, y: 20 + (await page.getByTestId('canvas').boundingBox())!.y })
  await expect(panel).toHaveCount(0)

  await waitForSync(page)
  await page.reload()
  await expect(page.locator('[data-testid="card"][data-type="swatch"]').getByTestId('colour-hex')).toHaveText('#46A758')
})
