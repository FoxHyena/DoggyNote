import { expect, test, type Page } from '@playwright/test'
import { MOD, at, cardByText, clickEmpty, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'
import { boardOf } from './touch.ts'

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
  const friend = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
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
  await page.getByTestId('duplicate-selection').click()
  await expect(page.locator('[data-testid=card]', { hasText: 'Beam' })).toHaveCount(2)
  for (const card of await page.locator('[data-testid=card]', { hasText: 'Beam' }).all()) await expect(card.getByTestId('card-labels').locator('.label-chip')).toHaveText(['Lighting'])
  await waitForSync(page)
  expect(await serverLabels(page, boardOf(page))).toEqual({ Lighting: 'gold' })
})
