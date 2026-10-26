import { expect, test, type Browser, type Page } from '@playwright/test'
import { MOD, at, cardByText, cards, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'
import { boardOf, note, seedCards } from './touch.ts'

// Quick wins: single-key creation (N, T, B, L), the "?" shortcut sheet,
// Move to board… and Distribute evenly.

const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`)
async function clearAll(page: Page) {
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('.card.selected')).toHaveCount(0)
  await expect(page.locator('.card.editing')).toHaveCount(0)
}
/** A board someone else owns, shared with rex as view only. Close the returned context. */
async function viewOnlyBoard(page: Page, browser: Browser) {
  const username = `qwowner_${crypto.randomUUID().slice(0, 8)}`
  expect((await page.request.post('/api/users', { data: { username, password: 'quickwins123' } })).status()).toBe(201)
  const owner = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  expect((await owner.request.post('/api/auth/login', { data: { username, password: 'quickwins123' } })).ok()).toBe(true)
  const home = (await (await owner.request.get('/api/access')).json()).homeBoardId
  const id = crypto.randomUUID(), title = `Look only ${id.slice(0, 6)}`, noteId = crypto.randomUUID()
  expect((await postSync(owner.request, { data: { changes: [
    { id, patch: { id, kind: 'board', parentId: home, title, icon: 'paw', color: 'gold', createdAt: Date.now() } },
    { id: noteId, patch: { id: noteId, kind: 'card', type: 'note', boardId: id, content: { md: 'Just looking' }, x: 0, y: 0, w: 240, h: 60, z: 1, color: 'none', createdAt: Date.now() } },
  ] } })).ok()).toBe(true)
  expect((await owner.request.post(`/api/boards/${id}/members`, { data: { username: 'rex', permission: 'view' } })).status()).toBe(201)
  return { owner, id, title }
}
async function shiftSelect(page: Page, ids: string[]) {
  for (const id of ids) await card(page, id).click({ modifiers: ['Shift'], position: { x: 30, y: 14 } })
  await expect(page.locator('.card.selected')).toHaveCount(ids.length)
}

test.describe('single-key creation', () => {
  test('N, T and B add a note, a to-do and a board under the pointer; L toggles the Line tool', async ({ page }) => {
    await freshBoard(page)
    const expectUnder = async (id: string, p: { x: number; y: number }) => {
      const box = (await card(page, id).boundingBox())!
      // The card's top centre lands on the pointer (within grid snapping).
      expect(Math.abs(box.x + box.width / 2 - p.x)).toBeLessThan(24)
      expect(Math.abs(box.y + 20 - p.y)).toBeLessThan(24)
    }
    const newest = async (type: string) => {
      const typed = page.locator(`[data-testid="card"][data-type="${type}"]`)
      await expect(typed).toHaveCount(1)
      return (await typed.getAttribute('data-card-id'))!
    }

    const p1 = await at(page, 0.3, 0.35)
    await page.mouse.move(p1.x, p1.y)
    await page.keyboard.press('n')
    await expect(page.getByTestId('note-editor')).toBeFocused()
    await page.keyboard.type('Walkies')
    const noteId = await newest('note')
    await expectUnder(noteId, p1)
    await clearAll(page)
    await expect(cardByText(page, 'Walkies')).toBeVisible()

    const p2 = await at(page, 0.65, 0.35)
    await page.mouse.move(p2.x, p2.y)
    await page.keyboard.press('t')
    const todoId = await newest('todo')
    await expectUnder(todoId, p2)
    await expect(card(page, todoId)).toHaveClass(/editing/)
    await page.keyboard.type('Fetch the ball')
    await clearAll(page)

    const p3 = await at(page, 0.5, 0.7)
    await page.mouse.move(p3.x, p3.y)
    await page.keyboard.press('b')
    const boardCard = await newest('board')
    await expectUnder(boardCard, p3)
    await clearAll(page)
    await expect(cards(page)).toHaveCount(3)

    // Off the board (over the toolbar), the card goes in the middle of the view instead.
    const tool = (await page.getByTestId('tool-note').boundingBox())!
    await page.mouse.move(tool.x + tool.width / 2, tool.y + tool.height / 2)
    await page.keyboard.press('n')
    await expect(cards(page)).toHaveCount(4)
    await expect(page.getByTestId('note-editor')).toBeInViewport()
    await clearAll(page)

    await page.keyboard.press('l')
    await expect(page.getByTestId('tool-line')).toHaveClass(/active/)
    await page.keyboard.press('l')
    await expect(page.getByTestId('tool-line')).not.toHaveClass(/active/)
    await expect(page.getByTestId('tool-note')).toHaveAttribute('aria-keyshortcuts', 'N')
    await waitForSync(page)
    const { objects } = await pullAllObjects(page.request)
    expect(objects.filter((o: { boardId?: string; kind: string }) => o.kind === 'card' && o.boardId === boardOf(page)).map((o: { type: string }) => o.type).sort()).toEqual(['board', 'note', 'note', 'todo'])
  })

  test('the keys do nothing while typing, in a menu or with a modifier', async ({ page }) => {
    await freshBoard(page)
    const [id] = await seedCards(page, [note('Typing here', 0, 0)])
    await expect(cards(page)).toHaveCount(1)
    const p = await at(page, 0.6, 0.6)
    await page.mouse.move(p.x, p.y)

    // In the note editor (CodeMirror), the letters are text.
    await card(page, id).dblclick({ position: { x: 30, y: 14 } })
    await expect(page.getByTestId('note-editor')).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type(' ntbl?')
    await expect(cards(page)).toHaveCount(1)
    await expect(page.getByTestId('shortcut-sheet')).toHaveCount(0)
    await clearAll(page)
    await expect(cardByText(page, 'Typing here ntbl?')).toBeVisible()

    // In Fetch's search field.
    await page.keyboard.press(`${MOD}+k`)
    await expect(page.getByTestId('fetch-input')).toBeFocused()
    await page.keyboard.type('nb')
    await expect(page.getByTestId('fetch-input')).toHaveValue('nb')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('fetch')).toHaveCount(0)

    // With the right-click menu open.
    await card(page, id).click({ button: 'right', position: { x: 30, y: 14 } })
    await expect(page.getByTestId('canvas-context-menu')).toBeVisible()
    await page.keyboard.press('n')
    await page.keyboard.press('t')
    await expect(page.getByTestId('canvas-context-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('canvas-context-menu')).toHaveCount(0)
    await clearAll(page)

    // With the account menu open (focus on its first button).
    await page.getByTestId('account').click()
    await page.keyboard.press('b')
    await page.keyboard.press('Escape')

    // Modifiers belong to the browser and the editor.
    await page.keyboard.press('Shift+N')
    await page.keyboard.press('Alt+t')
    await expect(cards(page)).toHaveCount(1)
  })

  test('on a board you can only view, N, T and B add nothing but ? still shows the shortcuts', async ({ page, browser }) => {
    await freshBoard(page)
    const { owner, id, title } = await viewOnlyBoard(page, browser)
    try {
      await page.goto(`/#/b/${id}`)
      await page.reload()
      await expect(page.getByTestId('board-name')).toHaveText(title)
      await expect(page.getByTestId('board-permission')).toHaveText('View only')
      await expect(cardByText(page, 'Just looking')).toBeVisible()
      const p = await at(page, 0.5, 0.5)
      await page.mouse.move(p.x, p.y)
      for (const key of ['n', 't', 'b', 'l']) await page.keyboard.press(key)
      await expect(cards(page)).toHaveCount(1)
      await expect(page.locator('.card.editing')).toHaveCount(0)
      await page.keyboard.press('?')
      await expect(page.getByTestId('shortcut-sheet')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('shortcut-sheet')).toHaveCount(0)
      const { objects } = await pullAllObjects(owner.request)
      expect(objects.filter((o: { boardId?: string; kind: string }) => o.kind === 'card' && o.boardId === id)).toHaveLength(1)
    } finally { await owner.close() }
  })
})

test('? opens the shortcut sheet with this platform’s keys; Escape, ? and the account menu work', async ({ page }) => {
  await freshBoard(page)
  const sheet = page.getByTestId('shortcut-sheet')
  await page.keyboard.press('?')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent))
  const row = (label: string) => sheet.getByTestId('shortcut-row').filter({ has: page.getByText(label, { exact: true }) })
  await expect(row('Note').locator('dd')).toHaveAttribute('data-keys', 'N')
  await expect(row('Redo').locator('dd')).toHaveAttribute('data-keys', mac ? '⇧⌘Z' : 'Ctrl+Shift+Z')
  await expect(row('Redo').locator('dd')).toContainText(mac ? '⇧⌘Z' : 'Ctrl+Shift+Z')
  await expect(row('Undo').locator('kbd').first()).toHaveText(mac ? '⌘' : 'Ctrl')
  // Every existing shortcut is listed, not just the new ones.
  for (const label of ['To-do list', 'Board', 'Duplicate', 'Select all', 'Paste as plain text', 'Fetch', 'Zoom to fit', 'Snap to grid', 'Bury']) await expect(row(label)).toHaveCount(1)
  // A compact panel, not a modal: no backdrop, and it fits the window.
  const box = (await sheet.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(560)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId('account')).toBeFocused()

  await page.keyboard.press('?')
  await expect(sheet).toBeVisible()
  await page.keyboard.press('?')
  await expect(sheet).toHaveCount(0)

  await page.getByTestId('account').click()
  await page.getByTestId('open-shortcuts').click()
  await expect(sheet).toBeVisible()
  await sheet.getByTestId('shortcut-sheet-close').click()
  await expect(sheet).toHaveCount(0)

  // Not while typing.
  await page.getByTestId('open-fetch').click()
  await page.keyboard.type('?')
  await expect(page.getByTestId('fetch-input')).toHaveValue('?')
  await expect(sheet).toHaveCount(0)
})

test.describe('Move to board', () => {
  async function seedMove(page: Page) {
    const sourceTitle = await freshBoard(page, `Move from ${crypto.randomUUID().slice(0, 6)}`)
    const source = boardOf(page)
    const target = crypto.randomUUID(), targetTitle = `Kennel plans ${target.slice(0, 6)}`
    const srcLabel = 'aaaaaaaaaaaa'.replace(/a/g, () => '0123456789abcdef'[Math.floor(Math.random() * 16)])
    const dstLabel = 'bbbbbbbbbbbb'.replace(/b/g, () => '0123456789abcdef'[Math.floor(Math.random() * 16)])
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    const comment = crypto.randomUUID(), conn = crypto.randomUUID()
    const noteOf = (id: string, md: string, x: number, extra = {}) => ({ id, patch: { id, kind: 'card', type: 'note', boardId: source, content: { md }, x, y: 40, w: 200, h: 80, z: 1, color: 'none', createdAt: Date.now(), ...extra } })
    const res = await postSync(page.request, { data: { changes: [
      { id: target, patch: { id: target, kind: 'board', parentId: 'home', title: targetTitle, icon: 'bone', color: 'sky', createdAt: Date.now(), [`labelName${dstLabel}`]: 'Urgent', [`labelColor${dstLabel}`]: 'collar' } },
      { id: source, patch: { [`labelName${srcLabel}`]: 'Urgent', [`labelColor${srcLabel}`]: 'gold' } },
      noteOf(a, 'Buy kibble', 40, { [`label${srcLabel}`]: true }),
      noteOf(b, 'Vet on Tuesday', 300),
      noteOf(c, 'Stays here', 560),
      { id: conn, patch: { id: conn, kind: 'connection', boardId: source, from: a, to: b, fromSide: null, toSide: null, arrow: 'end', createdAt: Date.now() } },
      { id: comment, patch: { id: comment, kind: 'comment', boardId: source, cardId: a, text: 'The big bag', createdAt: Date.now() } },
    ] } })
    expect(res.ok(), await res.text()).toBe(true)
    await page.reload()
    await page.keyboard.press(`${MOD}+1`)
    for (const id of [a, b, c]) await expect(card(page, id)).toBeVisible()
    return { source, sourceTitle, target, targetTitle, a, b, c, comment, conn, srcLabel, dstLabel }
  }
  const objectsById = async (page: Page) => new Map((await pullAllObjects(page.request)).objects.map((o: { id: string }) => [o.id, o as Record<string, unknown>]))

  test('moves the selection with its comments, labels and connection; one Undo; Go to follows', async ({ page }) => {
    const s = await seedMove(page)
    const before = await card(page, s.b).evaluate((el: HTMLElement) => parseFloat(el.style.left)) - await card(page, s.a).evaluate((el: HTMLElement) => parseFloat(el.style.left))
    await shiftSelect(page, [s.a, s.b])
    await card(page, s.a).click({ button: 'right', position: { x: 30, y: 14 } })
    await page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Move to board…' }).click()
    const picker = page.getByTestId('move-board-popover')
    await expect(picker).toBeVisible()
    await expect(page.getByTestId('move-board-input')).toBeFocused()
    // Never the board you're on.
    await expect(picker.locator(`[data-board-id="${s.source}"]`)).toHaveCount(0)
    await page.keyboard.type(s.targetTitle.slice(0, 18))
    await expect(page.getByTestId('move-board-option').first()).toHaveAttribute('data-board-id', s.target)
    await page.keyboard.press('Enter')
    await expect(picker).toHaveCount(0)
    await expect(page.getByTestId('toast')).toContainText(`Moved 2 cards to ${s.targetTitle}`)
    await expect(card(page, s.a)).toHaveCount(0)
    await expect(card(page, s.b)).toHaveCount(0)
    await expect(card(page, s.c)).toBeVisible()
    await waitForSync(page)
    let objs = await objectsById(page)
    expect(objs.get(s.a)!.boardId).toBe(s.target)
    expect(objs.get(s.b)!.boardId).toBe(s.target)
    expect(objs.get(s.comment)!.boardId).toBe(s.target)
    expect(objs.get(s.conn)!.boardId).toBe(s.target)
    // The label maps by name onto the target's own "Urgent".
    expect(objs.get(s.a)![`label${s.dstLabel}`]).toBe(true)
    expect(objs.get(s.a)![`label${s.srcLabel}`] ?? null).toBeNull()
    expect(objs.get(s.c)!.boardId).toBe(s.source)

    // One Undo brings both back, comment and all.
    await page.keyboard.press(`${MOD}+z`)
    await expect(card(page, s.a)).toBeVisible()
    await expect(card(page, s.b)).toBeVisible()
    await expect(card(page, s.a).getByTestId('card-labels')).toContainText('Urgent')
    await waitForSync(page)
    objs = await objectsById(page)
    expect(objs.get(s.a)!.boardId).toBe(s.source)
    expect(objs.get(s.b)!.boardId).toBe(s.source)
    expect(objs.get(s.comment)!.boardId).toBe(s.source)

    // Move again, by clicking a row, then follow with Go to.
    await clearAll(page)
    await shiftSelect(page, [s.a, s.b])
    await card(page, s.b).click({ button: 'right', position: { x: 30, y: 14 } })
    await page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Move to board…' }).click()
    await picker.locator(`[data-board-id="${s.target}"]`).click()
    await expect(page.getByTestId('toast-action')).toHaveText('Go to')
    await page.getByTestId('toast-action').click()
    await expect(page.getByTestId('board-name')).toHaveText(s.targetTitle)
    await expect(card(page, s.a)).toBeVisible()
    await expect(card(page, s.a)).toHaveClass(/selected/)
    await expect(card(page, s.b)).toHaveClass(/selected/)
    await expect(card(page, s.a).getByTestId('card-labels')).toContainText('Urgent')
    // The pair keeps its shape.
    const after = await card(page, s.b).evaluate((el: HTMLElement) => parseFloat(el.style.left)) - await card(page, s.a).evaluate((el: HTMLElement) => parseFloat(el.style.left))
    expect(after).toBe(before)
  })

  test('only offers boards you can edit, unsyncs a note sent to the Inbox, and hides for board cards', async ({ page, browser }) => {
    const shared = await viewOnlyBoard(page, browser)
    await shared.owner.close()
    const s = await seedMove(page)
    await shiftSelect(page, [s.c])
    await card(page, s.c).click({ button: 'right', position: { x: 30, y: 14 } })
    await page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Move to board…' }).click()
    const ids = await page.getByTestId('move-board-option').evaluateAll((els) => els.map((el) => el.getAttribute('data-board-id')))
    expect(ids).toContain(s.target)
    expect(ids).not.toContain(s.source)
    // A board shared with you as view only isn't a place you can put things.
    expect(ids).not.toContain(shared.id)
    // Your Inbox is always there and comes first.
    expect(ids[0]).toMatch(/^toybox:/)
    await page.getByTestId('move-board-input').fill('no such board here')
    await expect(page.getByTestId('move-board-popover')).toContainText('No board by that name.')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('move-board-popover')).toHaveCount(0)
    await expect(card(page, s.c)).toBeVisible()
    await clearAll(page)

    // A synced copy sent to your Inbox stops syncing (rule 10); the original keeps its group.
    await shiftSelect(page, [s.c])
    await card(page, s.c).click({ button: 'right', position: { x: 30, y: 14 } })
    await page.getByTestId('make-synced-copy').click()
    // The copy lands beside the original, maybe past the edge of the view.
    await page.keyboard.press(`${MOD}+1`)
    await expect(page.locator('.card.selected')).toHaveCount(1)
    const copyId = (await page.locator('.card.selected').getAttribute('data-card-id'))!
    expect(copyId).not.toBe(s.c)
    await waitForSync(page)
    await card(page, copyId).click({ button: 'right', position: { x: 30, y: 14 } })
    await page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Move to board…' }).click()
    await page.getByTestId('move-board-option').first().click()
    await expect(page.getByTestId('toast')).toContainText('Moved 1 card to Inbox')
    await expect(card(page, copyId)).toHaveCount(0)
    await waitForSync(page)
    const objs = await objectsById(page)
    expect(String(objs.get(copyId)!.boardId)).toMatch(/^toybox:/)
    expect(objs.get(copyId)!.syncId ?? null).toBeNull()
    expect(objs.get(s.c)!.syncId).toBeTruthy()
    await clearAll(page)

    await page.keyboard.press('b')
    await clearAll(page)
    const boardCard = page.locator('[data-testid="card"][data-type="board"]')
    await boardCard.click({ modifiers: ['Shift'], position: { x: 30, y: 30 } })
    await boardCard.click({ button: 'right', position: { x: 30, y: 30 } })
    await expect(page.getByTestId('canvas-context-menu')).toBeVisible()
    await expect(page.getByTestId('move-to-board')).toHaveCount(0)
  })
})

test('Distribute spaces 3+ cards evenly, skips locked ones and is one Undo', async ({ page }) => {
  await freshBoard(page)
  const ids = await seedCards(page, [note('One', 0, 0, { w: 120 }), note('Two', 150, 40, { w: 160 }), note('Locked', 260, 120, { w: 100 }), note('Three', 420, 10, { w: 140 }), note('Four', 900, 60, { w: 120 })])
  const lockedId = ids[2]!
  expect((await postSync(page.request, { data: { changes: [{ id: lockedId, patch: { positionLocked: true } }] } })).ok()).toBe(true)
  await page.reload()
  for (const id of ids) await expect(card(page, id)).toBeVisible()
  const xs = () => Promise.all(ids.map((id) => card(page, id).evaluate((el: HTMLElement) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth }))))
  const start = await xs()

  // Two unlocked cards: nothing to distribute.
  await shiftSelect(page, [ids[0]!, ids[1]!, lockedId])
  await expect(page.getByTestId('align-selection')).toBeVisible()
  await expect(page.getByTestId('distribute-selection')).toHaveCount(0)
  await clearAll(page)

  await page.keyboard.press(`${MOD}+a`)
  await expect(page.locator('.card.selected')).toHaveCount(5)
  const button = page.getByTestId('distribute-horizontal')
  await expect(button).toHaveAttribute('data-tip', /Distribute horizontally/)
  await expect(page.getByTestId('distribute-vertical')).toBeVisible()
  await button.click()
  await expect(page.getByTestId('toast')).toContainText('1 locked unit stayed in place')
  const after = await xs()
  const free = [0, 1, 3, 4].map((i) => after[i]!).sort((p, q) => p.x - q.x)
  const gaps = free.slice(1).map((c, i) => c.x - (free[i]!.x + free[i]!.w))
  for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(1)
  expect(after[2]).toEqual(start[2])
  expect(after[0]!.x).toBe(start[0]!.x)
  expect(after[4]!.x).toBe(start[4]!.x)
  // Only the x axis moved.
  expect(after.map((c) => c.y)).toEqual(start.map((c) => c.y))

  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(xs).toEqual(start)
})
