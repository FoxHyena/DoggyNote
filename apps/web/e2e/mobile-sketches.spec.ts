import { expect, test, type Page } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'
import { Fingers, seedCards, tap, tapEmpty, touchDrag } from './touch.ts'

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
    if (await control.evaluate((el) => el.matches('button:not(.color-dot)'))) expect(Math.min(r.width, r.height), name).toBeGreaterThanOrEqual(44)
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

test('after editing a sketch half off screen, Draw’s bar and the board stay in place', async ({ page }) => {
  await seedCards(page, [{ type: 'sketch', x: 200, y: 40, w: 300, content: { title: '', width: 800, height: 600, background: '#2B2E34' } }])
  const card = page.locator('[data-testid="card"][data-type="sketch"]')
  const before = (await card.boundingBox())!
  // Clear of the connect handle on its left edge.
  const p = { x: before.x + 90, y: before.y + before.height * 0.3 }
  await tap(page, p)
  await expect(card).toHaveClass(/selected/)
  await tap(page, p)
  await expect(editor(page)).toBeVisible()
  // White ink on charcoal paper, and the paper right under the tools.
  await expect(page.locator('[data-testid="ink-colour"][data-hex="#FFFFFF"]')).toHaveAttribute('aria-pressed', 'true')
  const head = (await editor(page).locator('.ink-head').boundingBox())!
  const paper = (await page.getByTestId('sketch-surface').boundingBox())!
  expect(paper.y - (head.y + head.height)).toBeLessThanOrEqual(16)
  await page.getByTestId('sketch-done').tap()
  await expect(editor(page)).toHaveCount(0)
  expect((await card.boundingBox())!.x).toBeCloseTo(before.x, 0)
  // Put it down: the docked selection bar covers the dock.
  await tapEmpty(page)
  await expect(card).not.toHaveClass(/selected/)
  await page.getByTestId('dock-add').tap()
  await page.getByTestId('add-draw').tap()
  await expect(page.getByTestId('board-ink-bar')).toBeVisible()
  await reachable(page, 'board-ink-bar')
  expect((await card.boundingBox())!.x).toBeCloseTo(before.x, 0)
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

/** A quick flick of a finger: down, two moves, up at once. */
async function flick(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const f = new Fingers(page)
  await f.press(0, from)
  await f.move(0, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })
  await f.move(0, to)
  await f.release(0)
}

/**
 * Tap a Done button until its panel closes. Right after a synthetic flick,
 * CI's x64 Chromium can still hold the touch gesture open and give the next tap
 * no click (see Fingers.release); no hand gets from a stroke to Done that fast.
 */
async function tapDone(page: Page, testid: string) {
  const done = page.getByTestId(testid)
  await expect(async () => {
    if (await done.count()) await done.tap({ timeout: 1000 })
    await expect(done).toHaveCount(0, { timeout: 1000 })
  }).toPass()
}

test('quick finger strokes are kept, in a sketch and on the board', async ({ page }) => {
  await seedCards(page, [{ type: 'sketch', x: 20, y: 40, w: 300, content: { title: '', width: 800, height: 600, background: '#FFFFFF' } }])
  const card = page.locator('[data-testid="card"][data-type="sketch"]')
  const box = (await card.boundingBox())!
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await tap(page, p)
  await tap(page, p)
  await expect(editor(page)).toBeVisible()
  const s = (await page.getByTestId('sketch-surface').boundingBox())!
  await flick(page, { x: s.x + s.width * 0.2, y: s.y + s.height * 0.3 }, { x: s.x + s.width * 0.7, y: s.y + s.height * 0.4 })
  await flick(page, { x: s.x + s.width * 0.2, y: s.y + s.height * 0.7 }, { x: s.x + s.width * 0.7, y: s.y + s.height * 0.8 })
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(2)
  await tapDone(page, 'sketch-done')
  // Put the sketch down, so the dock is back.
  await page.getByTestId('selection-done').tap()

  await page.getByTestId('dock-add').tap()
  await page.getByTestId('add-draw').tap()
  const bar = (await page.getByTestId('board-ink-bar').boundingBox())!
  const y = Math.max(bar.y + bar.height, box.y + box.height) + 40
  await flick(page, { x: 60, y }, { x: 220, y: y + 40 })
  const ink = page.locator('[data-testid="card"][data-type="ink"]')
  await expect(ink).toHaveCount(1)
  await tapDone(page, 'board-ink-done')
  await waitForSync(page)
  await page.reload()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(2)
  await expect(ink).toHaveCount(1)
})
