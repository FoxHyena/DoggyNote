import { expect, test, type Page } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'
import { seedCards, tap, touchDrag } from './touch.ts'

// On a phone: double-tap a sketch to open its editor, which fills the screen
// with every control in reach; draw with a finger; Done closes it. Draw from
// the + sheet puts ink straight on the board.

test.use({ viewport: { width: 375, height: 667 } })

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const editor = (page: Page) => page.getByTestId('sketch-editor')

/** Every control is fully on screen and at least finger-sized. */
async function reachable(page: Page, scope: string) {
  const vp = page.viewportSize()!
  const controls = await page.getByTestId(scope).locator('button:visible, input:visible').all()
  expect(controls.length).toBeGreaterThan(5)
  for (const control of controls) {
    const r = (await control.boundingBox())!
    const name = (await control.getAttribute('data-testid')) ?? (await control.getAttribute('aria-label')) ?? ''
    expect(r.x, name).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width, name).toBeLessThanOrEqual(vp.width + 0.5)
    expect(r.y, name).toBeGreaterThanOrEqual(0)
    expect(r.y + r.height, name).toBeLessThanOrEqual(vp.height + 0.5)
    if (await control.evaluate((el) => el.matches('button:not(.ink-dot)'))) expect(Math.min(r.width, r.height), name).toBeGreaterThanOrEqual(44)
  }
}

test('double-tap a sketch, draw with a finger, Done: the stroke is on the card', async ({ page }) => {
  await seedCards(page, [{ type: 'sketch', x: 20, y: 40, w: 300, content: { title: '', width: 800, height: 600, background: '#FFFFFF' } }])
  const card = page.locator('[data-testid="card"][data-type="sketch"]')
  const box = (await card.boundingBox())!
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  // A tap picks it up; a second, quick tap opens it.
  await tap(page, p)
  await expect(card).toHaveClass(/selected/)
  await tap(page, p)
  await expect(editor(page)).toBeVisible()
  await reachable(page, 'sketch-editor')
  // The phone editor is the whole screen: no full-screen toggle to offer.
  await expect(page.getByTestId('sketch-full')).toBeHidden()

  const s = (await page.getByTestId('sketch-surface').boundingBox())!
  await touchDrag(page, { x: s.x + s.width * 0.2, y: s.y + s.height * 0.3 }, { x: s.x + s.width * 0.8, y: s.y + s.height * 0.6 }, { steps: 10 })
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(1)
  await page.getByTestId('sketch-done').tap()
  await expect(editor(page)).toHaveCount(0)
  await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
  await waitForSync(page)
})

test('Draw from the + sheet puts ink on the board; its bar fits the phone', async ({ page }) => {
  await page.getByTestId('dock-add').tap()
  await page.getByTestId('add-draw').tap()
  await expect(page.getByTestId('board-ink-bar')).toBeVisible()
  await reachable(page, 'board-ink-bar')
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  // Below the bar, which sits under the top bar on a phone.
  const bar = (await page.getByTestId('board-ink-bar').boundingBox())!
  const y = bar.y + bar.height + 60
  await touchDrag(page, { x: canvas.x + 60, y }, { x: canvas.x + 260, y: y + 80 }, { steps: 10 })
  const ink = page.locator('[data-testid="card"][data-type="ink"]')
  await expect(ink).toHaveCount(1)
  await page.getByTestId('board-ink-done').tap()
  await expect(page.getByTestId('board-ink-bar')).toHaveCount(0)
  await waitForSync(page)
  await page.reload()
  await expect(ink).toHaveCount(1)
})
