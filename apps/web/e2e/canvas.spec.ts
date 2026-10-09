import { expect, test } from '@playwright/test'
import { MOD, addNote, at, camera, canvasBox, cardByText, cards, clickEmpty, dragBy, freshBoard } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

test.describe('pan + zoom', () => {
  test('Space+drag pans the canvas', async ({ page }) => {
    const before = await camera(page)
    const p = await at(page, 0.5, 0.5)
    await page.mouse.move(p.x, p.y)
    await page.keyboard.down('Space')
    await page.mouse.down()
    await page.mouse.move(p.x + 120, p.y + 60, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    const after = await camera(page)
    expect(after.tx - before.tx).toBeCloseTo(120, 0)
    expect(after.ty - before.ty).toBeCloseTo(60, 0)
  })

  test('middle-button drag pans', async ({ page }) => {
    const before = await camera(page)
    const p = await at(page, 0.4, 0.4)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(p.x - 80, p.y + 40, { steps: 4 })
    await page.mouse.up({ button: 'middle' })
    const after = await camera(page)
    expect(after.tx - before.tx).toBeCloseTo(-80, 0)
    expect(after.ty - before.ty).toBeCloseTo(40, 0)
  })

  test('two-finger scroll pans', async ({ page }) => {
    const before = await camera(page)
    const p = await at(page, 0.5, 0.5)
    await page.mouse.move(p.x, p.y)
    await page.mouse.wheel(50, 100)
    await expect.poll(async () => (await camera(page)).ty).toBeCloseTo(before.ty - 100, 0)
    expect((await camera(page)).tx).toBeCloseTo(before.tx - 50, 0)
  })

  test('pinch / ⌘-wheel zooms around the cursor', async ({ page }) => {
    const note = await addNote(page, 'anchor', 0.3, 0.3)
    const b0 = (await note.boundingBox())!
    const anchor = { x: b0.x + 10, y: b0.y + 10 }
    await page.mouse.move(anchor.x, anchor.y)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -60)
    await page.keyboard.up('Control')
    await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(1.2)
    const b1 = (await note.boundingBox())!
    // The note's top-left (10px from the cursor) stays under the cursor, scaled.
    const z = (await camera(page)).zoom
    expect(b1.x).toBeCloseTo(anchor.x - 10 * z, 0)
    expect(b1.y).toBeCloseTo(anchor.y - 10 * z, 0)
  })

  test('zoom menu sets 100% and zoom shortcuts work', async ({ page }) => {
    await page.keyboard.press(`${MOD}+=`)
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.25, 2)
    await expect(page.getByTestId('zoom')).toHaveText('125%')
    await page.getByTestId('zoom').click()
    await page.getByText('Zoom to 100%').click()
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1, 2)
  })

  test('zooming far out switches cards to low detail', async ({ page }) => {
    await addNote(page, 'tiny text')
    const p = await at(page, 0.5, 0.5)
    await page.mouse.move(p.x, p.y)
    await page.keyboard.down('Control')
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 80)
    await page.keyboard.up('Control')
    await expect(page.getByTestId('canvas')).toHaveClass(/\blod\b/)
    // Zoomed out, cards are drawn on one canvas instead of mounted as DOM.
    await expect(page.getByTestId('lod-layer')).toBeVisible()
    await expect(page.getByTestId('card')).toHaveCount(0)
    await page.keyboard.press(`${MOD}+0`)
    await expect(page.getByTestId('canvas')).not.toHaveClass(/\blod\b/)
    await expect(cardByText(page, 'tiny text')).toBeVisible()
  })
})

test.describe('zoomed out (canvas overview)', () => {
  async function zoomOutFar(page: import('@playwright/test').Page) {
    const p = await at(page, 0.5, 0.5)
    await page.mouse.move(p.x, p.y)
    await page.keyboard.down('Control')
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 80)
    await page.keyboard.up('Control')
    await expect(page.getByTestId('lod-layer')).toBeVisible()
  }
  /** Screen point of a card's centre, computed from the camera (no DOM for cards when zoomed out). */
  async function cardCentre(page: import('@playwright/test').Page, box: { x: number; y: number; width: number; height: number }, before: { tx: number; ty: number; zoom: number }) {
    const cam = await camera(page)
    // World coords from the DOM box taken at the old camera, mapped to the new one.
    const c = await canvasBox(page)
    const wx = (box.x + box.width / 2 - c.x - before.tx) / before.zoom
    const wy = (box.y + box.height / 2 - c.y - before.ty) / before.zoom
    return { x: c.x + cam.tx + wx * cam.zoom, y: c.y + cam.ty + wy * cam.zoom }
  }

  test('click selects, drag moves, and the move is real at normal zoom', async ({ page }) => {
    const note = await addNote(page, 'tiny dot', 0.5, 0.5)
    const box = (await note.boundingBox())!
    const cam0 = await camera(page)
    await zoomOutFar(page)
    const c = await cardCentre(page, box, cam0)
    await page.mouse.click(c.x, c.y)
    await expect(page.getByTestId('selection-bar')).toBeVisible()
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    await page.mouse.move(c.x + 30, c.y + 10, { steps: 5 })
    await page.mouse.up()
    const zoom = (await camera(page)).zoom
    await page.keyboard.press(`${MOD}+0`)
    await expect(cardByText(page, 'tiny dot')).toBeVisible()
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1, 2)
    // Compare world x (screen positions differ: ⌘0 re-centres the camera).
    const cb = await canvasBox(page)
    const worldX = (b: { x: number }, cam: { tx: number; zoom: number }) => (b.x - cb.x - cam.tx) / cam.zoom
    const moved = (await cardByText(page, 'tiny dot').boundingBox())!
    const dx = worldX(moved, await camera(page)) - worldX(box, cam0)
    // 30 screen px at the far zoom is 30/zoom world px.
    expect(dx).toBeCloseTo(30 / zoom, -1)
  })

  test('clicking a board tile opens it', async ({ page }) => {
    await page.getByTestId('tool-board').click()
    await page.keyboard.type('Far kennel')
    await page.keyboard.press('Enter')
    const tile = cardByText(page, 'Far kennel').locator('.board-tile')
    const box = (await tile.boundingBox())!
    const cam0 = await camera(page)
    await zoomOutFar(page)
    const c = await cardCentre(page, box, cam0)
    await page.mouse.click(c.x, c.y)
    await expect(page.getByTestId('board-name')).toHaveText('Far kennel')
  })
})

test.describe('notes', () => {
  test('double-click creates a note; text survives a reload', async ({ page }) => {
    await addNote(page, 'Walk the dog at 6')
    await page.waitForTimeout(400) // debounced IndexedDB flush
    await page.reload()
    await expect(cardByText(page, 'Walk the dog at 6')).toBeVisible()
  })

  test('typing immediately after creating a note is not lost', async ({ page }) => {
    const p = await at(page, 0.5, 0.5)
    await page.mouse.dblclick(p.x, p.y)
    await page.keyboard.type('fast typer')
    await page.keyboard.press('Escape')
    await expect(cardByText(page, 'fast typer')).toBeVisible()
  })

  test('toolbar Note button creates a note in free space', async ({ page }) => {
    await page.getByTestId('tool-note').click()
    await page.keyboard.type('first')
    await page.keyboard.press('Escape')
    await page.getByTestId('tool-note').click()
    await page.keyboard.type('second')
    await page.keyboard.press('Escape')
    const a = (await cardByText(page, 'first').boundingBox())!
    const b = (await cardByText(page, 'second').boundingBox())!
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    expect(overlap).toBe(false)
  })

  test('clicking a note edits it; bold formatting renders', async ({ page }) => {
    const note = await addNote(page, 'plain')
    await note.click()
    await expect(page.getByTestId('note-editor')).toBeVisible()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.press(`${MOD}+b`)
    await page.keyboard.press('Escape')
    await expect(note.locator('strong')).toHaveText('plain')
  })

  test('markdown shortcuts make headings and lists', async ({ page }) => {
    const p = await at(page, 0.5, 0.5)
    await page.mouse.dblclick(p.x, p.y)
    await page.keyboard.type('# Title')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Escape')
    const note = cardByText(page, 'Title')
    await expect(note.locator('h1')).toHaveText('Title')
    await expect(note.locator('ul li')).toHaveCount(2)
  })

  test('an empty new note disappears when you click away', async ({ page }) => {
    const p = await at(page, 0.5, 0.5)
    await page.mouse.dblclick(p.x, p.y)
    await expect(page.getByTestId('note-editor')).toBeVisible()
    await clickEmpty(page)
    await expect(cards(page)).toHaveCount(0)
    // Discarded, not buried.
    await page.getByTestId('tool-trash').click()
    await expect(page.getByTestId('trash-item')).toHaveCount(0)
  })
})

test.describe('selection, move, resize, delete', () => {
  test('marquee selects; dragging moves every selected card', async ({ page }) => {
    const a = await addNote(page, 'alpha', 0.35, 0.4)
    const b = await addNote(page, 'beta', 0.65, 0.4)
    const tl = await at(page, 0.1, 0.2)
    const br = await at(page, 0.9, 0.7)
    await page.mouse.move(tl.x, tl.y)
    await page.mouse.down()
    await page.mouse.move(br.x, br.y, { steps: 6 })
    await page.mouse.up()
    await expect(page.locator('.card.selected')).toHaveCount(2)
    const a0 = (await a.boundingBox())!
    const b0 = (await b.boundingBox())!
    await dragBy(page, a, 40, 90)
    const a1 = (await a.boundingBox())!
    const b1 = (await b.boundingBox())!
    expect(a1.x - a0.x).toBeCloseTo(40, 0)
    expect(a1.y - a0.y).toBeCloseTo(90, 0)
    expect(b1.x - b0.x).toBeCloseTo(40, 0)
    expect(b1.y - b0.y).toBeCloseTo(90, 0)
  })

  test('shift-click adds to the selection', async ({ page }) => {
    await addNote(page, 'one', 0.3, 0.3)
    await addNote(page, 'two', 0.7, 0.6)
    await clickEmpty(page)
    await dragBy(page, cardByText(page, 'one'), 12, 0)
    await cardByText(page, 'two').click({ modifiers: ['Shift'] })
    await expect(page.locator('.card.selected')).toHaveCount(2)
  })

  test('resize handle changes the width', async ({ page }) => {
    const note = await addNote(page, 'stretch me')
    await dragBy(page, note, 12, 0) // a drag selects without entering edit mode
    const w0 = (await note.boundingBox())!.width
    const h = page.getByTestId('resize-handle')
    const hb = (await h.boundingBox())!
    await page.mouse.move(hb.x + 5, hb.y + 5)
    await page.mouse.down()
    await page.mouse.move(hb.x + 125, hb.y + 5, { steps: 6 })
    await page.mouse.up()
    expect((await note.boundingBox())!.width - w0).toBeCloseTo(120, 0)
  })

  test('Delete buries the selection; trash restores it', async ({ page }) => {
    const note = await addNote(page, 'bury me')
    await dragBy(page, note, 12, 0)
    await page.keyboard.press('Backspace')
    await expect(cardByText(page, 'bury me')).toHaveCount(0)
    await page.getByTestId('tool-trash').click()
    await expect(page.getByTestId('trash-item')).toHaveCount(1)
    await page.getByTestId('restore').click()
    await expect(cardByText(page, 'bury me')).toBeVisible()
  })
})

test.describe('undo / redo', () => {
  test('undo reverts a move, then the creation; redo replays both', async ({ page }) => {
    const note = await addNote(page, 'undoable')
    const p0 = (await note.boundingBox())!
    await dragBy(page, note, 100, 0)
    await expect.poll(async () => (await note.boundingBox())!.x).toBeCloseTo(p0.x + 100, 0)

    await clickEmpty(page)
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(async () => (await cardByText(page, 'undoable').boundingBox())!.x).toBeCloseTo(p0.x, 0)
    await page.keyboard.press(`${MOD}+z`)
    await expect(cardByText(page, 'undoable')).toHaveCount(0)

    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(cardByText(page, 'undoable')).toBeVisible() // text came back with it
    await page.getByTestId('redo').click()
    await expect.poll(async () => (await cardByText(page, 'undoable').boundingBox())!.x).toBeCloseTo(p0.x + 100, 0)
  })

  test('a text edit is one undo step', async ({ page }) => {
    const note = await addNote(page, 'before')
    await note.click()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type('after')
    await page.keyboard.press('Escape')
    await expect(cardByText(page, 'after')).toBeVisible()
    await page.getByTestId('undo').click()
    await expect(cardByText(page, 'before')).toBeVisible()
  })
})

test.describe('Fetch (⌘K)', () => {
  test('finds a card on another board and jumps to it', async ({ page }) => {
    const unique = `squeaky${Math.random().toString(36).slice(2, 7)}`
    await page.getByTestId('tool-board').click()
    await page.keyboard.type('Toy chest')
    await page.keyboard.press('Enter')
    await cardByText(page, 'Toy chest').locator('.board-tile').click()
    await addNote(page, `the ${unique} duck`, 0.8, 0.8)
    await page.getByTestId('crumb').first().click()
    await expect(page.getByTestId('board-name')).not.toHaveText('Toy chest')

    await page.keyboard.press(`${MOD}+k`)
    await page.getByTestId('fetch-input').fill(unique)
    await expect(page.getByTestId('fetch-hit')).toHaveCount(1)
    await expect(page.getByTestId('fetch-hit')).toContainText('Toy chest')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('fetch')).toHaveCount(0)
    await expect(page.getByTestId('board-name')).toHaveText('Toy chest')
    const card = cardByText(page, unique)
    await expect(card).toHaveClass(/selected/)
    await expect(card).toBeInViewport()
  })

  test('finds boards by name and says so when nothing matches', async ({ page }) => {
    const name = await page.getByTestId('board-name').textContent()
    await page.getByTestId('open-fetch').click()
    await page.getByTestId('fetch-input').fill(name!)
    await expect(page.getByTestId('fetch-hit').first()).toContainText(name!)
    await page.getByTestId('fetch-input').fill('zzz-no-such-bone-zzz')
    await expect(page.getByText('No bones found')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('fetch')).toHaveCount(0)
  })
})

test('reopening the app returns to the last board', async ({ page }) => {
  const name = await page.getByTestId('board-name').textContent()
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
  await page.goto('/') // no hash: like relaunching the desktop app
  await expect(page.getByTestId('board-name')).toHaveText(name!)
  await page.getByTestId('crumb').first().click()
  await page.goto('/')
  await expect(page.getByTestId('board-name')).toHaveText('Doghouse')
})
