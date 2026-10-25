import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { MOD, addNote, at, clickEmpty, freshBoard, postSync, waitForSync } from './helpers.ts'
import { boardOf, seedCards, setCamera } from './touch.ts'

// Sketch cards and drawing on the board, with real mouse input. A sketch opens
// in place with a double-click; its editor has the ink tools (pen, highlighter,
// eraser, widths), the title and paper colour, Undo/Redo, zoom, full screen and
// Done. Clicking outside it saves and closes. Draw puts ink straight on the board.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const contexts = new Set<BrowserContext>()
test.afterEach(async () => {
  await Promise.all([...contexts].map((c) => c.close()))
  contexts.clear()
})

const sketchCard = (page: Page) => page.locator('[data-testid="card"][data-type="sketch"]')
const inkCards = (page: Page) => page.locator('[data-testid="card"][data-type="ink"]')
const editor = (page: Page) => page.getByTestId('sketch-editor')
const editorStrokes = (page: Page) => editor(page).locator('[data-stroke-id]')

/** Drag across a box from one fraction of it to another, in small steps like a hand. */
async function scribble(page: Page, target: Locator, from: [number, number], to: [number, number], steps = 12) {
  const b = (await target.boundingBox())!
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1])
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps })
  await page.mouse.up()
}

const background = (el: Locator) => el.evaluate((e) => getComputedStyle(e).backgroundColor)

test('make a sketch, draw with pen, highlighter and eraser, name it and pick paper: it all comes back after a reload', async ({ page }) => {
  // A new sketch opens straight in the editor. Done closes it.
  await page.getByTestId('tool-sketch').click()
  await expect(sketchCard(page)).toHaveCount(1)
  await expect(editor(page)).toBeVisible()
  await page.getByTestId('sketch-done').click()
  await expect(editor(page)).toHaveCount(0)
  // No title until it has one, and no Edit button on the card.
  await expect(sketchCard(page).getByTestId('sketch-card-title')).toHaveCount(0)
  await expect(sketchCard(page).getByRole('button')).toHaveCount(0)

  // Double-click opens it in place.
  await sketchCard(page).getByTestId('sketch-paper').dblclick()
  await expect(editor(page)).toBeVisible()
  const surface = page.getByTestId('sketch-surface')

  // Pen, at the default width.
  await expect(page.getByTestId('ink-pen')).toHaveAttribute('aria-pressed', 'true')
  await scribble(page, surface, [0.1, 0.2], [0.9, 0.25])
  await expect(editorStrokes(page)).toHaveCount(1)
  await expect(editorStrokes(page).first()).toHaveAttribute('stroke-width', '6')

  // A bolder line in red.
  await page.getByTestId('ink-width-12').click()
  await page.locator('[data-testid="ink-colour"][data-hex="#D7263D"]').click()
  await scribble(page, surface, [0.1, 0.5], [0.9, 0.55])
  await expect(editorStrokes(page)).toHaveCount(2)
  await expect(editorStrokes(page).nth(1)).toHaveAttribute('stroke-width', '12')
  await expect(editorStrokes(page).nth(1)).toHaveAttribute('stroke', '#D7263D')

  // The highlighter is a wide, see-through pen.
  await page.getByTestId('ink-highlighter').click()
  await page.getByTestId('ink-width-6').click()
  await scribble(page, surface, [0.1, 0.8], [0.9, 0.8])
  await expect(editorStrokes(page)).toHaveCount(3)
  await expect(editorStrokes(page).nth(2)).toHaveAttribute('stroke-opacity', '0.3')
  await expect(editorStrokes(page).nth(2)).toHaveAttribute('stroke-width', '18')

  // The eraser takes a line it passes over; colour and width step aside while it's in hand.
  await page.getByTestId('ink-eraser').click()
  await expect(page.getByTestId('ink-colour')).toHaveCount(0)
  await scribble(page, surface, [0.5, 0.05], [0.5, 0.35])
  await expect(editorStrokes(page)).toHaveCount(2)

  // Undo brings the line back, Redo erases it again. Neither touches the board.
  await page.getByTestId('sketch-undo').click()
  await expect(editorStrokes(page)).toHaveCount(3)
  await page.getByTestId('sketch-redo').click()
  await expect(editorStrokes(page)).toHaveCount(2)
  await page.keyboard.press(`${MOD}+z`)
  await expect(editorStrokes(page)).toHaveCount(3)
  await expect(sketchCard(page)).toHaveCount(1)

  // Title and paper, in the header and the tools.
  await page.getByTestId('sketch-title').fill('Walk route')
  await page.getByTestId('sketch-paper-button').click()
  await page.locator('[data-testid="sketch-paper"][data-hex="#EDEDEA"]').click()
  expect(await background(surface)).toBe('rgb(237, 237, 234)')
  // The shared colour picker: a "+" slot that wears the custom colour once picked.
  const paperPanel = page.getByTestId('sketch-paper-panel')
  const customSlot = paperPanel.locator('.color-custom')
  await expect(customSlot.locator('svg')).toHaveCount(1)
  await expect(customSlot).not.toHaveClass(/\bon\b/)
  await page.getByTestId('sketch-paper-custom').fill('#e3d5c1')
  expect(await background(surface)).toBe('rgb(227, 213, 193)')
  await expect(customSlot).toHaveClass(/\bon\b/)
  await expect(customSlot.locator('svg')).toHaveCount(0)
  expect(await background(customSlot)).toBe('rgb(227, 213, 193)')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sketch-paper-panel')).toHaveCount(0)
  await expect(editor(page)).toBeVisible()

  // Full screen, from the zoom menu, fills the window, and back.
  await page.getByTestId('sketch-zoom').click()
  await page.getByTestId('sketch-full').click()
  const vp = page.viewportSize()!
  await expect.poll(async () => (await editor(page).boundingBox())!.width).toBe(vp.width)
  await page.getByTestId('sketch-zoom').click()
  await expect(page.getByTestId('sketch-full')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('sketch-full').click()
  await expect.poll(async () => (await editor(page).boundingBox())!.width).toBeLessThan(vp.width)

  // A click outside the editor saves and closes it.
  await page.mouse.click(6, vp.height / 2)
  await expect(editor(page)).toHaveCount(0)
  await expect(sketchCard(page).getByTestId('sketch-card-title')).toHaveText('Walk route')
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(3)
  expect(await background(sketchCard(page).getByTestId('sketch-paper'))).toBe('rgb(227, 213, 193)')

  await waitForSync(page)
  await page.reload()
  await expect(sketchCard(page).getByTestId('sketch-card-title')).toHaveText('Walk route')
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(3)
  expect(await background(sketchCard(page).getByTestId('sketch-paper'))).toBe('rgb(227, 213, 193)')
})

test('Escape closes the editor; Enter reopens it; Delete inside it never buries the card', async ({ page }) => {
  await page.getByTestId('tool-sketch').click()
  await expect(editor(page)).toBeVisible()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)
  await expect(sketchCard(page)).toHaveCount(1)
  await expect(sketchCard(page)).toHaveClass(/selected/)
  await page.keyboard.press('Enter')
  await expect(editor(page)).toBeVisible()
  // Done, then Draw: the sketch is put down, nothing stays picked up.
  await page.getByTestId('sketch-done').click()
  await page.getByTestId('tool-draw').click()
  await expect(page.locator('[data-testid="card"]:is(.selected, .editing)')).toHaveCount(0)
})

async function friend(browser: Browser, owner: Page) {
  const id = boardOf(owner)
  const grant = await owner.request.post(`/api/boards/${id}/members`, { data: { username: 'fido', permission: 'edit', includeChildren: true } })
  expect(grant.ok(), await grant.text()).toBe(true)
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
  contexts.add(context)
  expect((await context.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  const page = await context.newPage()
  await page.goto(owner.url())
  await expect(page.getByTestId('canvas')).toBeVisible()
  return page
}

test('someone else on the board sees the strokes as they are drawn', async ({ page, browser }) => {
  await page.getByTestId('tool-sketch').click()
  await page.getByTestId('sketch-done').click()
  await waitForSync(page)
  const other = await friend(browser, page)
  await expect(sketchCard(other)).toHaveCount(1)

  await page.bringToFront()
  await sketchCard(page).getByTestId('sketch-paper').dblclick()
  await scribble(page, page.getByTestId('sketch-surface'), [0.2, 0.2], [0.8, 0.7])
  await expect(editorStrokes(page)).toHaveCount(1)
  // The stroke is saved as soon as it's drawn, while the editor is still open.
  await waitForSync(page)
  await expect(sketchCard(other).locator('[data-stroke-id]')).toHaveCount(1, { timeout: 15000 })
})

test('one person renames a sketch while another changes its paper: both changes survive', async ({ page, browser }) => {
  await page.getByTestId('tool-sketch').click()
  await page.getByTestId('sketch-done').click()
  await waitForSync(page)
  const other = await friend(browser, page)
  await expect(sketchCard(other)).toHaveCount(1)

  // Both open the same sketch at once.
  await sketchCard(page).getByTestId('sketch-paper').dblclick()
  await sketchCard(other).getByTestId('sketch-paper').dblclick()
  await expect(editor(page)).toBeVisible()
  await expect(editor(other)).toBeVisible()
  await page.getByTestId('sketch-title').fill('Walk route')
  await other.getByTestId('sketch-paper-button').click()
  await other.locator('[data-testid="sketch-paper"][data-hex="#E3EEF9"]').click()
  await other.keyboard.press('Escape')
  // Each saves while the other's editor is still open.
  await page.getByTestId('sketch-done').click()
  await waitForSync(page)
  await other.getByTestId('sketch-done').click()
  await waitForSync(other)

  for (const p of [page, other]) {
    await p.reload()
    await expect(sketchCard(p).getByTestId('sketch-card-title')).toHaveText('Walk route')
    await expect.poll(() => background(sketchCard(p).getByTestId('sketch-paper'))).toBe('rgb(227, 238, 249)')
  }
})

test('a sketch with more strokes than the clip limit still duplicates', async ({ page }) => {
  const board = boardOf(page)
  const sketchId = crypto.randomUUID()
  const card = { id: sketchId, patch: { id: sketchId, kind: 'card', type: 'sketch', boardId: board, x: 0, y: 0, w: 320, h: 240, z: 1, color: 'none', columnId: null, createdAt: Date.now(), content: { title: '', width: 800, height: 600, background: '#FFFFFF' } } }
  const strokes = Array.from({ length: 520 }, (_, i) => {
    const id = crypto.randomUUID()
    const x = 20 + (i % 26) * 30, y = 20 + Math.floor(i / 26) * 28
    return { id, patch: { id, kind: 'stroke', boardId: board, cardId: sketchId, tool: 'pen', color: '#292D35', width: 3, opacity: 1, order: i + 1, points: [{ x, y }, { x: x + 20, y: y + 10 }], bounds: { x: x - 1.5, y: y - 1.5, w: 23, h: 13 }, createdAt: Date.now() } }
  })
  // The server takes 200 changes per push.
  for (const changes of [[card, ...strokes.slice(0, 199)], strokes.slice(199, 399), strokes.slice(399)]) {
    const res = await postSync(page.request, { data: { changes } })
    expect(res.ok(), await res.text()).toBe(true)
  }
  await setCamera(page, { x: -40, y: -40, zoom: 1 })
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(520)
  // Card actions live in the right-click menu.
  await sketchCard(page).getByTestId('sketch-paper').click({ button: 'right' })
  await page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(sketchCard(page)).toHaveCount(2)
  await expect(sketchCard(page).nth(1).locator('[data-stroke-id]')).toHaveCount(520)
  await expect(page.getByTestId('toast')).toHaveCount(0)
  await waitForSync(page)
  await page.reload()
  await expect(sketchCard(page)).toHaveCount(2)
  for (const c of await sketchCard(page).all()) await expect(c.locator('[data-stroke-id]')).toHaveCount(520)
})

test('Edit in the right-click menu opens a sketch in place', async ({ page }) => {
  await seedCards(page, [{ type: 'sketch', x: 40, y: 40, w: 300, content: { title: '', width: 800, height: 600, background: '#FFFFFF' } }])
  await sketchCard(page).getByTestId('sketch-paper').click({ button: 'right' })
  await page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Edit', exact: true }).click()
  await expect(editor(page)).toBeVisible()
})

test('Draw puts ink straight on the board, over other cards, and the eraser takes it away', async ({ page }) => {
  await addNote(page, 'Under the ink', 0.5, 0.4)
  // Starting to draw puts down whatever was picked up.
  await expect(page.locator('[data-testid="card"][data-type="note"]')).toHaveClass(/selected/)
  await page.getByTestId('tool-draw').click()
  await expect(page.locator('[data-testid="card"].selected')).toHaveCount(0)
  await expect(page.getByTestId('board-ink-bar')).toBeVisible()
  await expect(page.getByTestId('tool-draw')).toHaveAttribute('aria-pressed', 'true')

  // A line across the board and the note: the note isn't picked up or moved.
  const note = page.locator('[data-testid="card"][data-type="note"]')
  const before = (await note.boundingBox())!
  const a = await at(page, 0.2, 0.42)
  const b = await at(page, 0.8, 0.48)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 15 })
  await page.mouse.up()
  await expect(inkCards(page)).toHaveCount(1)
  await expect(inkCards(page).locator('[data-stroke-id]')).toHaveCount(1)
  expect(await note.boundingBox()).toEqual(before)
  await expect(note).not.toHaveClass(/selected/)

  // A second, shorter line.
  const c = await at(page, 0.3, 0.7)
  const d = await at(page, 0.5, 0.75)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(d.x, d.y, { steps: 10 })
  await page.mouse.up()
  await expect(inkCards(page)).toHaveCount(2)

  // The eraser across the second line takes it (the board's Undo brings it back, Redo takes it again).
  await page.getByTestId('ink-eraser').click()
  const e1 = await at(page, 0.4, 0.62)
  const e2 = await at(page, 0.4, 0.82)
  await page.mouse.move(e1.x, e1.y)
  await page.mouse.down()
  await page.mouse.move(e2.x, e2.y, { steps: 10 })
  await page.mouse.up()
  await expect(inkCards(page)).toHaveCount(1)
  await page.getByTestId('undo').click()
  await expect(inkCards(page)).toHaveCount(2)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(inkCards(page)).toHaveCount(1)

  // Done (or Escape) goes back to selecting; a click on the line picks it up.
  await page.getByTestId('ink-pen').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('board-ink-bar')).toHaveCount(0)
  const path = inkCards(page).locator('.ink-hit-path').first()
  const mid = await at(page, 0.5, 0.45)
  await page.mouse.click(mid.x, mid.y)
  await expect(inkCards(page).first()).toHaveClass(/selected/)
  await expect(path).toHaveCount(1)

  await waitForSync(page)
  await page.reload()
  await expect(inkCards(page)).toHaveCount(1)
  await expect(inkCards(page).locator('[data-stroke-id]')).toHaveCount(1)
})

/** Every button in the editor is fully on screen and inside the editor. */
async function controlsVisible(page: Page) {
  const vp = page.viewportSize()!
  // The window resizes to fit the paper after the tools change: check once it has settled.
  await expect(async () => {
    const box = (await editor(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5)
    for (const control of await editor(page).locator('button:visible, input:visible').all()) {
      const r = (await control.boundingBox())!
      expect(r.x, await control.getAttribute('data-testid') ?? '').toBeGreaterThanOrEqual(box.x - 0.5)
      expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
      expect(r.y).toBeGreaterThanOrEqual(box.y - 0.5)
      expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height + 0.5)
    }
    // The paper keeps real room to draw in.
    const paper = (await page.getByTestId('sketch-surface').boundingBox())!
    expect(paper.height).toBeGreaterThan(120)
  }).toPass({ timeout: 5000 })
}

test('the editor’s controls all fit in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 560 })
  await page.getByTestId('tool-sketch').click()
  await expect(editor(page)).toBeVisible()
  await page.getByTestId('sketch-title').fill('A rather long sketch title that keeps going and going')
  await controlsVisible(page)
  await page.getByTestId('ink-eraser').click()
  await controlsVisible(page)
})

test('a sketch and its strokes survive Duplicate board', async ({ page }) => {
  const board = boardOf(page)
  const sketchId = crypto.randomUUID()
  const points = [{ x: 100, y: 100 }, { x: 600, y: 400 }]
  const res = await postSync(page.request, { data: { changes: [
    { id: sketchId, patch: { id: sketchId, kind: 'card', type: 'sketch', boardId: board, x: 0, y: 0, w: 320, h: 240, z: 1, color: 'none', columnId: null, createdAt: Date.now(), content: { title: 'Garden plan', width: 800, height: 600, background: '#FBF3DF' } } },
    ...[0, 1].map((i) => {
      const id = crypto.randomUUID()
      const pts = points.map((p) => ({ x: p.x, y: p.y + i * 80 }))
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
      return { id, patch: { id, kind: 'stroke', boardId: board, cardId: sketchId, tool: 'pen', color: '#245FE5', width: 6, opacity: 1, order: i + 1, points: pts, bounds: { x: Math.min(...xs) - 3, y: Math.min(...ys) - 3, w: Math.max(...xs) - Math.min(...xs) + 6, h: Math.max(...ys) - Math.min(...ys) + 6 }, createdAt: Date.now() } }
    }),
  ] } })
  expect(res.ok(), await res.text()).toBe(true)
  await setCamera(page, { x: -40, y: -40, zoom: 1 })
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(2)

  await page.getByTestId('board-more').click()
  await page.getByTestId('duplicate-board').click()
  await expect(page.getByTestId('board-name')).toContainText('copy')
  expect(boardOf(page)).not.toBe(board)
  await expect(sketchCard(page).getByTestId('sketch-card-title')).toHaveText('Garden plan')
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(2)
  await waitForSync(page)
  await page.reload()
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(2)
  // The copy is its own: drawing on it leaves the original alone.
  await sketchCard(page).getByTestId('sketch-paper').dblclick()
  await scribble(page, page.getByTestId('sketch-surface'), [0.2, 0.6], [0.8, 0.9])
  await page.getByTestId('sketch-done').click()
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(3)
  await waitForSync(page)
  await page.goto(`/#/b/${board}`)
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(2)
})

test('zoomed out, a sketch is drawn on the overview with its paper and ink', async ({ page }) => {
  const board = boardOf(page)
  const id = crypto.randomUUID()
  const stroke = crypto.randomUUID()
  const pts = [{ x: 0, y: 300 }, { x: 800, y: 300 }]
  const res = await postSync(page.request, { data: { changes: [
    { id, patch: { id, kind: 'card', type: 'sketch', boardId: board, x: 0, y: 0, w: 800, h: 600, z: 1, color: 'none', columnId: null, createdAt: Date.now(), content: { title: '', width: 800, height: 600, background: '#FBF3DF' } } },
    { id: stroke, patch: { id: stroke, kind: 'stroke', boardId: board, cardId: id, tool: 'pen', color: '#245FE5', width: 40, opacity: 1, order: 1, points: pts, bounds: { x: -20, y: 280, w: 840, h: 40 }, createdAt: Date.now() } },
  ] } })
  expect(res.ok(), await res.text()).toBe(true)
  await setCamera(page, { x: -100, y: -100, zoom: 0.25 })
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  const pixel = (x: number, y: number) => page.getByTestId('lod-layer').evaluate((c: HTMLCanvasElement, [px, py]) => [...c.getContext('2d')!.getImageData(px, py, 1, 1).data].slice(0, 3), [x, y])
  // Screen = (world + 100) / 4: world (100, 100) is paper, world (400, 300) is on the blue line.
  await expect.poll(() => pixel(50, 50)).toEqual([251, 243, 223])
  await expect.poll(() => pixel(125, 100)).toEqual([36, 95, 229])
})

/** Quick strokes, as a hand makes them: no waits, a single move, or a pause right before letting go. */
async function quickStrokes(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const p = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
  // A few fast moves, released at once.
  let a = p(0.15, 0.2), b = p(0.6, 0.3)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up()
  // One move, released at once.
  a = p(0.2, 0.5); b = p(0.7, 0.55)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up()
  // Stop, then let go 50 ms later.
  a = p(0.2, 0.8); b = p(0.75, 0.85)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.waitForTimeout(50); await page.mouse.up()
}

test('fast strokes in the sketch editor are all kept, through a reload', async ({ page }) => {
  await page.getByTestId('tool-sketch').click()
  await expect(editor(page)).toBeVisible()
  await quickStrokes(page, (await page.getByTestId('sketch-surface').boundingBox())!)
  await expect(editorStrokes(page)).toHaveCount(3)
  await page.getByTestId('sketch-done').click()
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(3)
  await waitForSync(page)
  await page.reload()
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(3)
})

test('fast strokes drawn on the board are all kept, through a reload', async ({ page }) => {
  await page.getByTestId('tool-draw').click()
  await expect(page.getByTestId('board-ink-bar')).toBeVisible()
  const c = (await page.getByTestId('canvas').boundingBox())!
  await quickStrokes(page, { x: c.x + 40, y: c.y + 140, width: c.width - 80, height: c.height - 220 })
  await expect(inkCards(page)).toHaveCount(3)
  await waitForSync(page)
  await page.reload()
  await expect(inkCards(page)).toHaveCount(3)
  await expect(inkCards(page).locator('[data-stroke-id]')).toHaveCount(3)
})

/** A path's points, from its `d` ("M x y L x y …"). */
const pathPoints = async (path: Locator) => {
  const nums = ((await path.getAttribute('d')) ?? '').match(/-?[\d.]+/g)!.map(Number)
  return Array.from({ length: nums.length / 2 }, (_, i) => ({ x: nums[i * 2], y: nums[i * 2 + 1] }))
}
async function shiftClick(page: Page, p: { x: number; y: number }) {
  await page.keyboard.down('Shift')
  await page.mouse.click(p.x, p.y)
  await page.keyboard.up('Shift')
}

test('click, then shift-click: a straight line in the current colour and width, chained by more shift-clicks', async ({ page }) => {
  await page.getByTestId('tool-sketch').click()
  const surface = page.getByTestId('sketch-surface')
  const r = (await surface.boundingBox())!
  const at = (fx: number, fy: number) => ({ x: r.x + r.width * fx, y: r.y + r.height * fy })
  await page.locator('[data-testid="ink-colour"][data-hex="#245FE5"]').click()
  await page.getByTestId('ink-width-12').click()
  await expect(page.getByTestId('ink-pen')).toHaveAttribute('data-tip', /Shift-click/)

  // A click leaves a dot; a shift-click joins it to the new spot with a straight line.
  await page.mouse.click(at(0.2, 0.3).x, at(0.2, 0.3).y)
  await expect(editorStrokes(page)).toHaveCount(1)
  await shiftClick(page, at(0.7, 0.6))
  await expect(editorStrokes(page)).toHaveCount(2)
  const line = editorStrokes(page).nth(1)
  await expect(line).toHaveAttribute('stroke', '#245FE5')
  await expect(line).toHaveAttribute('stroke-width', '12')
  const [a, b] = await pathPoints(line)
  expect(await pathPoints(line)).toHaveLength(2)
  for (const [p, q] of [[a, { x: 160, y: 180 }], [b, { x: 560, y: 360 }]]) {
    expect(Math.abs(p.x - q.x)).toBeLessThan(3)
    expect(Math.abs(p.y - q.y)).toBeLessThan(3)
  }

  // Another shift-click chains on from there; Undo takes that one line away.
  await shiftClick(page, at(0.8, 0.2))
  await expect(editorStrokes(page)).toHaveCount(3)
  expect((await pathPoints(editorStrokes(page).nth(2)))[0]).toEqual(b)
  await page.keyboard.press(`${MOD}+z`)
  await expect(editorStrokes(page)).toHaveCount(2)
  // Holding shift while dragging is still freehand.
  await page.keyboard.down('Shift')
  await scribble(page, surface, [0.1, 0.9], [0.5, 0.92])
  await page.keyboard.up('Shift')
  await expect(editorStrokes(page)).toHaveCount(3)
  expect((await pathPoints(editorStrokes(page).nth(2))).length).toBeGreaterThan(2)

  await page.getByTestId('sketch-done').click()
  await waitForSync(page)
  await page.reload()
  await expect(sketchCard(page).locator('[data-stroke-id]')).toHaveCount(3)
  expect(await pathPoints(sketchCard(page).locator('[data-stroke-id]').nth(1))).toEqual([a, b])
})

test('the eraser’s shift-click erases along a straight line', async ({ page }) => {
  await page.getByTestId('tool-sketch').click()
  const surface = page.getByTestId('sketch-surface')
  const r = (await surface.boundingBox())!
  // Two upright lines; the eraser's straight pass crosses both without touching them in between.
  await scribble(page, surface, [0.4, 0.2], [0.4, 0.8])
  await scribble(page, surface, [0.6, 0.2], [0.6, 0.8])
  await expect(editorStrokes(page)).toHaveCount(2)
  await page.getByTestId('ink-eraser').click()
  await page.mouse.click(r.x + r.width * 0.2, r.y + r.height * 0.5)
  await expect(editorStrokes(page)).toHaveCount(2)
  await shiftClick(page, { x: r.x + r.width * 0.8, y: r.y + r.height * 0.5 })
  await expect(editorStrokes(page)).toHaveCount(0)
})

test('on the board, click then shift-click draws a straight line, kept after a reload', async ({ page }) => {
  await page.getByTestId('tool-draw').click()
  const a = await at(page, 0.3, 0.5)
  const b = await at(page, 0.7, 0.6)
  await page.mouse.click(a.x, a.y)
  await expect(inkCards(page)).toHaveCount(1)
  await shiftClick(page, b)
  await expect(inkCards(page)).toHaveCount(2)
  const line = inkCards(page).nth(1)
  const box = (await line.boundingBox())!
  // The line's card spans from the first click to the second.
  expect(box.width).toBeGreaterThan(b.x - a.x - 4)
  expect(box.height).toBeGreaterThan(b.y - a.y - 4)
  expect(await pathPoints(line.locator('[data-stroke-id]'))).toHaveLength(2)
  await waitForSync(page)
  await page.reload()
  await expect(inkCards(page)).toHaveCount(2)
})

test('a custom ink colour from the shared picker draws, and stays after a reload', async ({ page }) => {
  await page.getByTestId('tool-sketch').click()
  const surface = page.getByTestId('sketch-surface')
  await page.getByTestId('ink-custom-colour').fill('#7a4fd6')
  await expect(editor(page).locator('.color-custom')).toHaveClass(/\bon\b/)
  await scribble(page, surface, [0.2, 0.3], [0.8, 0.6])
  await expect(editorStrokes(page).first()).toHaveAttribute('stroke', '#7A4FD6')
  await page.getByTestId('sketch-done').click()
  await waitForSync(page)
  await page.reload()
  await expect(sketchCard(page).locator('[data-stroke-id]').first()).toHaveAttribute('stroke', '#7A4FD6')
  // Board Draw has the same picker.
  await page.keyboard.press('Escape')
  await page.getByTestId('tool-draw').click()
  const bar = page.getByTestId('board-ink-bar')
  await bar.getByTestId('ink-custom-colour').fill('#1b8a7a')
  await expect(bar.locator('.color-custom')).toHaveClass(/\bon\b/)
  const a = await at(page, 0.2, 0.75)
  const b = await at(page, 0.6, 0.8)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 6 })
  await page.mouse.up()
  await expect(inkCards(page).locator('[data-stroke-id]')).toHaveAttribute('stroke', '#1B8A7A')
  await waitForSync(page)
  await page.reload()
  await expect(inkCards(page).locator('[data-stroke-id]')).toHaveAttribute('stroke', '#1B8A7A')
})

test('on a narrow window, the ink follows dark paper and the board never slides under the editor or the Draw bar', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 560 })
  // Half off the right edge, where focusing it once scrolled the whole board sideways.
  await seedCards(page, [{ type: 'sketch', x: 380, y: 40, w: 320, content: { title: '', width: 800, height: 600, background: '#2B2E34' } }])
  const card = sketchCard(page)
  const before = (await card.boundingBox())!
  await card.getByTestId('sketch-paper').dblclick()
  await expect(editor(page)).toBeVisible()
  // Charcoal ink would vanish on charcoal paper: the pen starts white.
  await expect(page.locator('[data-testid="ink-colour"][data-hex="#FFFFFF"]')).toHaveAttribute('aria-pressed', 'true')
  // A pick that still reads on new paper stays; one that wouldn't becomes charcoal.
  const ink = (hex: string) => page.locator(`[data-testid="ink-colour"][data-hex="${hex}"]`)
  const paper = async (hex: string) => {
    await page.getByTestId('sketch-paper-button').click()
    await page.locator(`[data-testid="sketch-paper"][data-hex="${hex}"]`).click()
    await page.keyboard.press('Escape')
  }
  await ink('#D7263D').click()
  await expect(ink('#D7263D')).toHaveAttribute('aria-pressed', 'true')
  await paper('#FFFFFF')
  expect(await background(page.getByTestId('sketch-surface'))).toBe('rgb(255, 255, 255)')
  await expect(ink('#D7263D')).toHaveAttribute('aria-pressed', 'true')
  await ink('#F2C94C').click()
  await paper('#EDEDEA')
  await expect(ink('#292D35')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('sketch-done').click()
  await expect(editor(page)).toHaveCount(0)
  expect((await card.boundingBox())!.x).toBeCloseTo(before.x, 0)

  await page.keyboard.press('Escape')
  await page.getByTestId('tool-draw').click()
  const bar = page.getByTestId('board-ink-bar')
  await expect(bar).toBeVisible()
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  for (const id of ['ink-pen', 'ink-eraser', 'ink-width-12', 'board-ink-done']) {
    const r = (await bar.getByTestId(id).boundingBox())!
    expect(r.x, id).toBeGreaterThanOrEqual(canvas.x)
    expect(r.x + r.width, id).toBeLessThanOrEqual(canvas.x + canvas.width)
  }
  expect((await card.boundingBox())!.x).toBeCloseTo(before.x, 0)
})
