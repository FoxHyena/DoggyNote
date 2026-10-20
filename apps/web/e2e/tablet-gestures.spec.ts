import { expect, test } from '@playwright/test'
import { camera, cardByText, freshBoard } from './helpers.ts'
import { center, note, pinch, seedCards, tapOn, touchDrag } from './touch.ts'

// iPad: the desktop layout (rail, top bar) with the touch gestures and a
// selection bar along the bottom.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

test('tablets keep the rail and use touch gestures', async ({ page }) => {
  await expect(page.locator('aside.toolbar')).toBeVisible()
  await expect(page.getByTestId('mobile-dock')).toHaveCount(0)
  await seedCards(page, [note('Tablet note', 0, 0)])
  const before = await camera(page)
  const p = await center(page.getByTestId('canvas'))
  await touchDrag(page, p, { x: p.x + 100, y: p.y })
  expect((await camera(page)).tx - before.tx).toBeCloseTo(100, 0)
  await pinch(page, p, 1.5)
  expect((await camera(page)).zoom).toBeGreaterThan(1.3)
})

test('a selected card shows fingertip handles and a bottom bar', async ({ page }) => {
  await seedCards(page, [note('Handles', 0, 0, { w: 280 })])
  const card = cardByText(page, 'Handles')
  await tapOn(page, card)
  const bar = page.getByTestId('selection-bar')
  await expect(bar).toHaveClass(/docked/)
  const vp = page.viewportSize()!
  const b = (await bar.boundingBox())!
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height)
  expect(b.y + b.height).toBeGreaterThan(vp.height - 60)
  // Handles have a 44px reach whatever the zoom.
  for (const id of ['resize-handle', 'connect-handle-right']) {
    const reach = await page.getByTestId(id).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el, '::before')
      return r.width + 2 * -parseFloat(s.left)
    })
    expect(reach, id).toBeGreaterThanOrEqual(43)
  }
  await expect(page.getByTestId('connect-handle-left')).toBeVisible()
})

test('a tapped tool keeps the new card focused, so the keyboard stays up', async ({ page }) => {
  for (const [tool, field] of [['tool-note', 'note-editor'], ['tool-movie', 'movie-search']] as const) {
    await tapOn(page, page.getByTestId(tool))
    await expect(page.getByTestId(field)).toBeVisible()
    // The tap's late mouse events land on the tool button after the card has focus.
    await page.waitForTimeout(400)
    expect(await page.getByTestId(field).evaluate((el) => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
  }
})
