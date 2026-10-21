import { expect, test, type Page } from '@playwright/test'
import { at, camera, cardByText, freshBoard, waitForSync } from './helpers.ts'
import { Fingers, center, longPress, note, pinch, seedCards, setCamera, tap, tapOn, touchDrag } from './touch.ts'

// Phones: one finger pans (even across cards), a selected card drags, long-press
// lifts, two fingers pinch. Tap selects; tapping the selected card again edits.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const left = (page: Page, text: string) => cardByText(page, text).evaluate((el) => parseFloat((el as HTMLElement).style.left))
const selected = (page: Page) => page.locator('.card.selected')

test('one finger on empty canvas pans, it does not draw a selection box', async ({ page }) => {
  await seedCards(page, [note('Biscuit', 0, 0)])
  const before = await camera(page)
  const p = await at(page, 0.5, 0.7)
  await touchDrag(page, p, { x: p.x - 90, y: p.y - 50 })
  const after = await camera(page)
  expect(after.tx - before.tx).toBeCloseTo(-90, 0)
  expect(after.ty - before.ty).toBeCloseTo(-50, 0)
  await expect(selected(page)).toHaveCount(0)
})

test('dragging across a card that is not selected pans instead of moving it', async ({ page }) => {
  await seedCards(page, [note('Leave me be', 0, 0)])
  const x0 = await left(page, 'Leave me be')
  const before = await camera(page)
  const p = await center(cardByText(page, 'Leave me be'))
  await touchDrag(page, p, { x: p.x + 60, y: p.y + 80 })
  expect(await left(page, 'Leave me be')).toBe(x0)
  expect((await camera(page)).ty - before.ty).toBeCloseTo(80, 0)
})

test('tap selects without opening the keyboard; tap again edits', async ({ page }) => {
  await seedCards(page, [note('Tap me', 0, 0)])
  const card = cardByText(page, 'Tap me')
  await tapOn(page, card)
  await expect(card).toHaveClass(/selected/)
  await expect(page.getByTestId('note-editor')).toHaveCount(0)
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await tapOn(page, card)
  await expect(page.getByTestId('note-editor')).toBeVisible()
})

test('a selected card follows the finger, and the move is saved', async ({ page }) => {
  await seedCards(page, [note('Fetch', 0, 0)])
  const card = cardByText(page, 'Fetch')
  await tapOn(page, card)
  await expect(card).toHaveClass(/selected/)
  const x0 = await left(page, 'Fetch')
  const p = await center(card)
  await touchDrag(page, p, { x: p.x + 80, y: p.y + 40 })
  await expect.poll(() => left(page, 'Fetch')).toBeGreaterThan(x0 + 60)
  await waitForSync(page)
  await page.reload()
  expect(await left(page, 'Fetch')).toBeGreaterThan(x0 + 60)
})

test('a move on touch offers Undo', async ({ page }) => {
  await seedCards(page, [note('Stay', 0, 0)])
  const card = cardByText(page, 'Stay')
  await tapOn(page, card)
  const x0 = await left(page, 'Stay')
  const p = await center(card)
  await touchDrag(page, p, { x: p.x + 80, y: p.y + 40 })
  await expect(page.getByTestId('toast')).toContainText('Moved')
  await page.getByTestId('toast-action').tap()
  await expect.poll(() => left(page, 'Stay')).toBeLessThan(x0 + 2)
})

test('long-press lifts a card that was not selected', async ({ page }) => {
  await seedCards(page, [note('Lift me', 0, 0)])
  const x0 = await left(page, 'Lift me')
  const card = cardByText(page, 'Lift me'), p = await center(card), finger = new Fingers(page)
  await finger.press(0, p)
  // Observe the lift before moving instead of racing a fixed wall-clock sleep.
  await expect(card).toHaveClass(/selected/)
  for (let i = 1; i <= 8; i++) await finger.move(0, { x: p.x + 70 * i / 8, y: p.y + 30 * i / 8 })
  await finger.release(0)
  await expect.poll(() => left(page, 'Lift me')).toBeGreaterThan(x0 + 50)
  await expect(cardByText(page, 'Lift me')).toHaveClass(/selected/)
})

test('pinch zooms around the fingers', async ({ page }) => {
  await seedCards(page, [note('Anchor', 0, 0)])
  const card = cardByText(page, 'Anchor')
  const b0 = (await card.boundingBox())!
  const c = { x: b0.x + 100, y: b0.y + 10 }
  await pinch(page, c, 2)
  const cam = await camera(page)
  expect(cam.zoom).toBeGreaterThan(1.6)
  const b1 = (await card.boundingBox())!
  // The point between the fingers stays put: the card grows away from it.
  expect(b1.x).toBeCloseTo(c.x - 100 * cam.zoom, -1)
  expect(b1.y).toBeCloseTo(c.y - 10 * cam.zoom, -1)
})

test('a second finger turns a card drag into a pinch and puts the card back', async ({ page }) => {
  await seedCards(page, [note('Steady', 0, 0)])
  const card = cardByText(page, 'Steady')
  await tapOn(page, card)
  const x0 = await left(page, 'Steady')
  const p = await center(card)
  const f = new Fingers(page)
  await f.press(0, p)
  await f.move(0, { x: p.x + 30, y: p.y })
  await f.move(0, { x: p.x + 50, y: p.y })
  await f.press(1, { x: p.x + 150, y: p.y + 100 })
  await f.move(1, { x: p.x + 220, y: p.y + 160 })
  await f.release(1)
  await f.release(0)
  expect(await left(page, 'Steady')).toBe(x0)
  expect((await camera(page)).zoom).toBeGreaterThan(1.1)
})

test('double-tap empty canvas makes a note', async ({ page }) => {
  const p = await at(page, 0.5, 0.5)
  await tap(page, p)
  await page.waitForTimeout(80)
  await tap(page, p)
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.type('Good boy')
  await expect(page.getByTestId('note-editor')).toContainText('Good boy')
})

test('tapping a selected board opens it', async ({ page }) => {
  const inner = crypto.randomUUID()
  expect((await page.request.post('/api/sync', { data: { changes: [{ id: inner, patch: { id: inner, kind: 'board', parentId: null, title: 'Kennel plans', icon: 'bone', color: 'green', createdAt: Date.now() } }] } })).ok()).toBe(true)
  await seedCards(page, [{ type: 'board', x: 0, y: 0, w: 140, content: { boardId: inner } }])
  const tile = cardByText(page, 'Kennel plans')
  await tapOn(page, tile, { x: 60, y: 40 })
  await expect(tile).toHaveClass(/selected/)
  await tapOn(page, tile, { x: 60, y: 40 })
  await expect(page.getByTestId('board-name')).toHaveText('Kennel plans')
})

test('a tap near a to-do checkbox ticks it, without editing', async ({ page }) => {
  await seedCards(page, [{ type: 'todo', x: 0, y: 0, w: 240, content: { title: 'Walkies', items: [{ id: 'a', text: 'Leash', done: false }, { id: 'b', text: 'Bags', done: false }] } }])
  const box = cardByText(page, 'Walkies').locator('.todo-check').first()
  const b = (await box.boundingBox())!
  // A fingertip lands a little off the 14px box.
  await tap(page, { x: b.x + b.width / 2 + 12, y: b.y + b.height / 2 + 6 })
  await expect(box).toBeChecked()
  await expect(page.getByTestId('todo-item-input')).toHaveCount(0)
})

test('a tap on the to-do title selects it, it does not tick the first item', async ({ page }) => {
  await seedCards(page, [{ type: 'todo', x: 0, y: 0, w: 240, content: { title: 'Walkies', items: [{ id: 'a', text: 'Leash', done: false }] } }])
  const card = cardByText(page, 'Walkies')
  const box = card.locator('.todo-check').first()
  const title = (await card.locator('.todo-title').boundingBox())!
  const b = (await box.boundingBox())!
  // The bottom of the title, right above the first box.
  await tap(page, { x: b.x + b.width / 2, y: title.y + title.height - 3 })
  await expect(card).toHaveClass(/selected/)
  await expect(box).not.toBeChecked()
  // Nor does a tap on an item's words.
  await page.getByTestId('selection-done').tap()
  const text = (await card.locator('.todo-text').first().boundingBox())!
  await tap(page, { x: text.x + text.width - 4, y: text.y + text.height / 2 })
  await expect(card).toHaveClass(/selected/)
  await expect(box).not.toBeChecked()
})

test('long-press on empty canvas, then drag, selects with a box', async ({ page }) => {
  await seedCards(page, [note('One', 0, 0, { w: 120 }), note('Two', 0, 120, { w: 120 })])
  const one = (await cardByText(page, 'One').boundingBox())!
  const start = { x: one.x + one.width + 30, y: one.y - 12 }
  await touchDrag(page, start, { x: one.x + 20, y: one.y + 200 }, { hold: 550 })
  await expect(selected(page)).toHaveCount(2)
})

test('a quick flick keeps the board gliding', async ({ page }) => {
  const p = await at(page, 0.5, 0.6)
  const f = new Fingers(page)
  await f.press(0, p)
  for (let i = 1; i <= 4; i++) await f.move(0, { x: p.x, y: p.y - i * 40 })
  await f.release(0)
  const released = (await camera(page)).ty
  await page.waitForTimeout(300)
  expect((await camera(page)).ty).toBeLessThan(released - 10)
})

test('zoomed out, a tap on a card inside a column picks that card', async ({ page }) => {
  const col = crypto.randomUUID()
  await seedCards(page, [
    { id: col, type: 'column', x: 0, y: 0, w: 280, content: { title: 'Ideas' } },
    note('First idea', 0, 0, { columnId: col, order: 1 }),
    note('Second idea', 0, 0, { columnId: col, order: 2 }),
  ])
  const second = (await cardByText(page, 'Second idea').boundingBox())!
  const firstBox = (await cardByText(page, 'First idea').boundingBox())!
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  // Measured heights sync (debounced); the overview stacks children by them.
  await page.waitForTimeout(600)
  await waitForSync(page)
  // Zoom to 25% around the canvas origin (world 0,0 is 24px in).
  await setCamera(page, { x: -24 / 0.25, y: -24 / 0.25, zoom: 0.25 })
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  const target = { x: canvas.x + 24 + (second.x - canvas.x - 24 + 20) * 0.25, y: canvas.y + 24 + (second.y - canvas.y - 24 + 10) * 0.25 }
  expect(second.y).toBeGreaterThan(firstBox.y)
  await tap(page, target)
  await pinch(page, target, 4, { spread: 20 })
  await expect(selected(page)).toContainText('Second idea')
})

test('long-press does not open the browser menu or select text', async ({ page }) => {
  await seedCards(page, [note('Quiet', 0, 0)])
  const menus: string[] = []
  await page.exposeFunction('sawMenu', (prevented: boolean) => menus.push(String(prevented)))
  await page.evaluate(() => document.addEventListener('contextmenu', (e) => setTimeout(() => (window as unknown as { sawMenu(p: boolean): void }).sawMenu(e.defaultPrevented)), { capture: false }))
  await longPress(page, await center(cardByText(page, 'Quiet')))
  expect(menus.every((m) => m === 'true')).toBe(true)
  expect(await page.evaluate(() => String(getSelection()))).toBe('')
})
