import { runCardAction } from './helpers.ts'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MOD, at, cardByText, clickEmpty, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'
import { boardOf, setCamera } from './touch.ts'

// Whole-board copies from the board "…" menu (Duplicate board, Save as template,
// New from template) and labels that survive copying cards between boards.

type Obj = Record<string, unknown> & { id: string; kind: string }
const LIGHT = 'aaaaaaaaaaaa'
const PROPS = 'bbbbbbbbbbbb'
const chips = (page: Page, text: string) => cardByText(page, text).getByTestId('card-labels').locator('.label-chip')

/** Labels on the open board, and notes carrying them (`labels` are ids). */
async function seedLabelled(page: Page, labels: Record<string, [string, string]>, notes: { md: string; x: number; labels: string[] }[]) {
  const board = boardOf(page)
  const fields: Record<string, string> = {}
  for (const [id, [name, color]] of Object.entries(labels)) Object.assign(fields, { [`labelName${id}`]: name, [`labelColor${id}`]: color })
  const changes: { id: string; patch: Record<string, unknown> }[] = [{ id: board, patch: fields }]
  notes.forEach((n, i) => {
    const id = crypto.randomUUID()
    changes.push({ id, patch: { id, kind: 'card', type: 'note', boardId: board, x: n.x, y: 0, w: 240, h: 80, z: i + 1, color: 'none', content: { md: n.md }, columnId: null, createdAt: Date.now(), ...Object.fromEntries(n.labels.map((l) => [`label${l}`, true])) } })
  })
  const res = await postSync(page.request, { data: { changes } })
  expect(res.ok(), await res.text()).toBe(true)
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
}

async function menu(page: Page, item: string) {
  await page.getByTestId('board-more').click()
  await expect(page.getByTestId('board-actions-menu')).toBeVisible()
  await page.getByTestId(item).click()
}

/** The server's copy of a board's labels: name → colour. */
async function serverLabels(page: Page, id: string) {
  const { objects } = await pullAllObjects(page.request)
  const board = objects.find((o: Obj) => o.id === id) as Obj
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(board)) if (k.startsWith('labelName') && v) out[v as string] = board[`labelColor${k.slice(9)}`]
  return out
}

test('save a board as a template, then make a new board from it with its cards and labels', async ({ page, browser }) => {
  const name = await freshBoard(page, `Trip plan ${Math.random().toString(36).slice(2, 6)}`)
  await seedLabelled(page, { [LIGHT]: ['Urgent', 'gold'] }, [{ md: 'Pack the bags', x: 0, labels: [LIGHT] }])
  await expect(chips(page, 'Pack the bags')).toHaveText(['Urgent'])
  const source = boardOf(page)

  // Saving stays on the board; a toast confirms it.
  await menu(page, 'save-template')
  await expect(page.getByTestId('toast')).toContainText('template')
  expect(boardOf(page)).toBe(source)

  // The template sits in the picker, a small popover under the "…" button.
  await menu(page, 'open-templates')
  const picker = page.getByTestId('templates-popover')
  await expect(picker).toBeVisible()
  const row = picker.locator(`[data-testid="template-row"][data-name="${name}"]`)
  await expect(row).toHaveCount(1)
  expect((await picker.boundingBox())!.width).toBeLessThan(340)
  await row.getByTestId('template-use').click()

  // A new board, opened, with the template's card and label.
  await expect(page.getByTestId('board-name')).toHaveText(name)
  expect(boardOf(page)).not.toBe(source)
  await expect(chips(page, 'Pack the bags')).toHaveText(['Urgent'])
  const made = boardOf(page)
  await waitForSync(page)
  expect(await serverLabels(page, made)).toEqual({ Urgent: 'gold' })
  // Its board card is on the board the picker was opened from.
  const { objects } = await pullAllObjects(page.request)
  expect(objects.some((o: Obj) => o.kind === 'card' && o.boardId === source && (o.content as { boardId?: string })?.boardId === made && !o.purged)).toBe(true)
  // The template itself has no parent and no card: Fetch doesn't find it.
  const template = objects.find((o: Obj) => o.kind === 'board' && o.template === true && o.title === name) as Obj
  expect(template.parentId).toBeNull()
  // Templates are private: a friend's pull never includes it or its cards.
  const friend = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  try {
    expect((await friend.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
    const seen = (await pullAllObjects(friend.request)).objects
    expect(seen.some((o: Obj) => o.id === template.id && !o.hidden)).toBe(false)
    expect(seen.some((o: Obj) => o.boardId === template.id && !o.hidden)).toBe(false)
  } finally {
    await friend.close()
  }
  await page.reload()
  await expect(chips(page, 'Pack the bags')).toHaveText(['Urgent'])

  // Remove it from the picker: gone, with Undo.
  await menu(page, 'open-templates')
  await row.hover()
  await row.getByTestId('template-remove').click()
  await expect(row).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('Template removed')
})

/**
 * What people really build: notes, a column holding two cards, a nested board
 * card with a note inside, and a card far off screen. Returns the texts to find.
 */
async function seedTree(api: APIRequestContext, board: string, tag: string) {
  const id = () => crypto.randomUUID()
  const [col, inner, innerCard] = [id(), id(), id()]
  const note = (md: string, x: number, y: number, extra = {}) => ({ id: id(), kind: 'card', type: 'note', boardId: board, x, y, w: 240, h: 80, z: 1, color: 'none', content: { md }, columnId: null, createdAt: Date.now(), ...extra })
  const changes = [
    { id: inner, kind: 'board', parentId: board, title: `Inner ${tag}`, icon: 'paw', color: 'gold', createdAt: Date.now() },
    note(`Loose ${tag}`, 0, 0),
    note(`Far away ${tag}`, 6000, 4000),
    { id: col, kind: 'card', type: 'column', boardId: board, x: 320, y: 0, w: 280, h: 80, z: 2, color: 'none', content: { title: `Column ${tag}` }, columnId: null, createdAt: Date.now() },
    note(`First in column ${tag}`, 0, 0, { columnId: col, order: 1 }),
    note(`Second in column ${tag}`, 0, 0, { columnId: col, order: 2 }),
    { id: innerCard, kind: 'card', type: 'board', boardId: board, x: 0, y: 200, w: 160, h: 120, z: 3, color: 'none', content: { boardId: inner }, columnId: null, createdAt: Date.now() },
    { ...note(`Deep inside ${tag}`, 0, 0), boardId: inner },
  ].map((o) => ({ id: o.id, patch: o }))
  const res = await postSync(api, { data: { changes } })
  expect(res.ok(), await res.text()).toBe(true)
}

/** Everything that arrived on a board made from the tree, checked through the server. */
async function expectTree(api: APIRequestContext, board: string, tag: string) {
  const { objects } = await pullAllObjects(api)
  const live = (o: Obj) => !o.purged && !o.deletedAt && !o.hidden
  const on = (id: string) => objects.filter((o: Obj) => o.boardId === id && live(o)) as Obj[]
  const text = (o: Obj) => (o.content as { md?: string; title?: string })?.md ?? (o.content as { title?: string })?.title
  const cards = on(board)
  expect(cards.map(text).filter(Boolean).sort()).toEqual([`Column ${tag}`, `Far away ${tag}`, `First in column ${tag}`, `Loose ${tag}`, `Second in column ${tag}`].sort())
  const col = cards.find((o) => o.type === 'column')!
  expect(cards.filter((o) => o.columnId === col.id).map(text).sort()).toEqual([`First in column ${tag}`, `Second in column ${tag}`])
  const boardCard = cards.find((o) => o.type === 'board')!
  const inner = (boardCard.content as { boardId: string }).boardId
  expect(objects.find((o: Obj) => o.id === inner)).toMatchObject({ kind: 'board', parentId: board, title: `Inner ${tag}` })
  expect(on(inner).map(text)).toEqual([`Deep inside ${tag}`])
}

for (const reload of [true, false]) {
  test(`a template keeps notes, columns, nested boards and far-off cards${reload ? ', across a reload' : ''}`, async ({ page }) => {
    const tag = Math.random().toString(36).slice(2, 7)
    const name = await freshBoard(page, `Full ${tag}`)
    await seedTree(page.request, boardOf(page), tag)
    // The far-off card would otherwise open the board zoomed out past card detail.
    await setCamera(page, { x: 0, y: 0, zoom: 1 })
    await expect(cardByText(page, `Loose ${tag}`)).toBeVisible()
    await menu(page, 'save-template')
    await expect(page.getByTestId('toast')).toContainText('template')
    if (reload) {
      await waitForSync(page)
      await page.reload()
      await expect(page.getByTestId('canvas')).toBeVisible()
    }
    await menu(page, 'open-templates')
    await page.getByTestId('templates-popover').locator(`[data-testid="template-row"][data-name="${name}"]`).getByTestId('template-use').click()
    await expect(page.getByTestId('board-name')).toHaveText(name)
    await waitForSync(page)
    await expectTree(page.request, boardOf(page), tag)
  })
}

test('duplicate board keeps notes, columns, nested boards and far-off cards', async ({ page }) => {
  const tag = Math.random().toString(36).slice(2, 7)
  const name = await freshBoard(page, `Dup ${tag}`)
  await seedTree(page.request, boardOf(page), tag)
  await setCamera(page, { x: 0, y: 0, zoom: 1 })
  await expect(cardByText(page, `Loose ${tag}`)).toBeVisible()
  await menu(page, 'duplicate-board')
  await expect(page.getByTestId('board-name')).toHaveText(`${name} copy`)
  await waitForSync(page)
  await expectTree(page.request, boardOf(page), tag)
})

test('your home board saved as a template copies everything, and nothing lands back on home', async ({ page, browser }) => {
  // A brand-new account, so its home is this test's alone.
  const username = `tpl${Math.random().toString(36).slice(2, 8)}`
  const created = await page.request.post('/api/users', { data: { username, password: 'template-pass-1' } })
  expect(created.ok(), await created.text()).toBe(true)
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  try {
    const login = await context.request.post('/api/auth/login', { data: { username, password: 'template-pass-1' } })
    expect(login.ok()).toBe(true)
    const home = `home:${(await login.json()).user.id}`
    const me = await context.newPage()
    await me.goto('/')
    await expect(me.getByTestId('canvas')).toBeVisible()
    const tag = Math.random().toString(36).slice(2, 7)
    await seedTree(context.request, home, tag)
    await me.goto(`/#/b/${encodeURIComponent(home)}`)
    await setCamera(me, { x: 0, y: 0, zoom: 1 })
    await expect(cardByText(me, `Loose ${tag}`)).toBeVisible()
    const before = (await pullAllObjects(context.request)).objects.filter((o: Obj) => o.boardId === home && !o.purged).length

    await menu(me, 'save-template')
    await expect(me.getByTestId('toast')).toContainText('template')
    await waitForSync(me)
    expect((await pullAllObjects(context.request)).objects.filter((o: Obj) => o.boardId === home && !o.purged)).toHaveLength(before)
    const template = (await pullAllObjects(context.request)).objects.find((o: Obj) => o.kind === 'board' && o.template === true) as Obj
    await expectTree(context.request, template.id, tag)

    await me.reload()
    await menu(me, 'open-templates')
    const home0 = boardOf(me)
    await me.getByTestId('template-use').first().click()
    await expect.poll(() => boardOf(me)).not.toBe(home0)
    await waitForSync(me)
    await expectTree(context.request, boardOf(me), tag)
  } finally {
    await context.close()
  }
})

test('duplicate a board: the copy opens beside the original with its labels; Undo goes back', async ({ page }) => {
  const name = await freshBoard(page, `Kennel ${Math.random().toString(36).slice(2, 6)}`)
  await seedLabelled(page, { [LIGHT]: ['Lighting', 'sky'], [PROPS]: ['Props', '#12AB3F'] }, [{ md: 'Lamp', x: 0, labels: [LIGHT, PROPS] }, { md: 'Rug', x: 300, labels: [PROPS] }])
  const source = boardOf(page)
  await menu(page, 'duplicate-board')
  await expect(page.getByTestId('board-name')).toHaveText(`${name} copy`)
  const copy = boardOf(page)
  expect(copy).not.toBe(source)
  await expect(chips(page, 'Lamp')).toHaveText(['Lighting', 'Props'])
  await expect(chips(page, 'Rug')).toHaveText(['Props'])
  await waitForSync(page)
  expect(await serverLabels(page, copy)).toEqual({ Lighting: 'sky', Props: '#12AB3F' })

  // Undo from the toast removes the copy and takes you back.
  await page.getByTestId('toast-action').click()
  await expect(page.getByTestId('board-name')).toHaveText(name)
  expect(boardOf(page)).toBe(source)
  await expect(chips(page, 'Lamp')).toHaveText(['Lighting', 'Props'])
})

test('copying labelled cards to another board maps labels by name, or makes them with the same colour', async ({ page, browserName }) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await freshBoard(page)
  await seedLabelled(page, { [LIGHT]: ['Lighting', 'gold'], [PROPS]: ['Props', '#12AB3F'] }, [{ md: 'Spotlight', x: 0, labels: [LIGHT, PROPS] }])
  await clickEmpty(page)
  await cardByText(page, 'Spotlight').click()
  await page.keyboard.press(`${MOD}+C`)

  // The other board already has "lighting" (another id, another colour).
  await freshBoard(page, 'Other stage')
  const other = 'cccccccccccc'
  await seedLabelled(page, { [other]: ['lighting', 'sky'] }, [])
  const p = await at(page, 0.5, 0.5)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.press(`${MOD}+V`)
  await expect(cardByText(page, 'Spotlight')).toBeVisible()
  // Reused by name (this board's spelling and colour), and Props made here in green.
  await expect(chips(page, 'Spotlight')).toHaveText(['lighting', 'Props'])
  await waitForSync(page)
  expect(await serverLabels(page, boardOf(page))).toEqual({ lighting: 'sky', Props: '#12AB3F' })
  const { objects } = await pullAllObjects(page.request)
  const pasted = objects.find((o: Obj) => o.kind === 'card' && o.boardId === boardOf(page) && (o.content as { md?: string })?.md === 'Spotlight') as Obj
  expect(pasted[`label${other}`]).toBe(true)
  expect(pasted[`label${LIGHT}`]).toBeUndefined()

  // One undo step takes both the card and the new label away.
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+Z`)
  await expect(cardByText(page, 'Spotlight')).toHaveCount(0)
  await waitForSync(page)
  expect(await serverLabels(page, boardOf(page))).toEqual({ lighting: 'sky' })
})

test('duplicating on the same board keeps the labels as they are', async ({ page }) => {
  await freshBoard(page)
  await seedLabelled(page, { [LIGHT]: ['Lighting', 'gold'] }, [{ md: 'Beam', x: 0, labels: [LIGHT] }])
  await clickEmpty(page)
  await cardByText(page, 'Beam').click()
  await runCardAction(page, 'Duplicate')
  await expect(page.locator('[data-testid=card]', { hasText: 'Beam' })).toHaveCount(2)
  for (const card of await page.locator('[data-testid=card]', { hasText: 'Beam' }).all()) await expect(card.getByTestId('card-labels').locator('.label-chip')).toHaveText(['Lighting'])
  await waitForSync(page)
  expect(await serverLabels(page, boardOf(page))).toEqual({ Lighting: 'gold' })
})
