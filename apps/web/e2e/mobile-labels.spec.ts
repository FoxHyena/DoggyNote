import { expect, test } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'
import { note, seedCards, selectionBarFits, tapOn } from './touch.ts'

// On a phone the labels popover opens from the docked bar, fits the screen,
// and has finger-sized rows, tools and colour dots.

test('tap a card, open labels from the bar, create one with a colour and rename it in place', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Phone note', 0, 0)])
  const card = page.getByTestId('card').filter({ hasText: 'Phone note' })
  await tapOn(page, card)
  await expect(card).toHaveClass(/selected/)
  await selectionBarFits(page)

  await page.getByTestId('labels-button').tap()
  const popover = page.getByTestId('labels-popover')
  await expect(popover).toBeVisible()
  const vp = page.viewportSize()!
  const box = (await popover.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)

  await page.getByTestId('labels-input').fill('Errand')
  const dot = popover.locator('[data-testid="label-color"][data-color="peach"]')
  expect((await dot.boundingBox())!.width).toBeGreaterThanOrEqual(32)
  await dot.tap()
  await page.getByTestId('label-create').tap()
  const chips = card.getByTestId('card-labels').locator('.label-chip')
  await expect(chips).toHaveText(['Errand'])

  // Row tools are always visible for fingers, and 44px.
  const rename = popover.getByTestId('label-rename')
  await expect(rename).toBeVisible()
  const r = (await rename.boundingBox())!
  expect(r.width).toBeGreaterThanOrEqual(44)
  expect(r.height).toBeGreaterThanOrEqual(44)
  await rename.tap()
  const field = page.getByTestId('label-rename-input')
  await expect(field).toBeFocused()
  await field.fill('Errands')
  await field.press('Enter')
  await expect(chips).toHaveText(['Errands'])

  // Toggle off with a tap.
  await popover.getByTestId('label-toggle').tap()
  await expect(card.getByTestId('card-labels')).toHaveCount(0)
  await popover.getByTestId('label-toggle').tap()
  await expect(chips).toHaveText(['Errands'])
  await waitForSync(page)
  await page.reload()
  await expect(page.getByTestId('card').filter({ hasText: 'Phone note' }).getByTestId('card-labels')).toHaveText('Errands')
})
