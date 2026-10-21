import { expect, test, type Page } from '@playwright/test'
import { MOD, addNote, cardByText, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

const boardOf = (page: Page) => decodeURIComponent(page.url().split('#/b/')[1])
async function action(page: Page, id: string) {
  await page.getByTestId('board-more').click()
  await page.getByTestId(id).click()
  await expect(page.getByTestId('templates-dialog')).toBeVisible()
}
async function snapshot(page: Page, board: string) {
  const response = await page.request.get(`/api/boards/${board}/copy-source`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).objects as Record<string, any>[]
}

test('selection copies are independent, undoable, durable and usable offline', async ({ page, context }) => {
  await freshBoard(page)
  const source = boardOf(page)
  const original = await addNote(page, 'Original research observation')
  const originalId = await original.getAttribute('data-card-id')
  await page.getByTestId('duplicate-selection').click()
  await expect(page.getByTestId('card')).toHaveCount(2)
  const selected = page.locator('[data-testid=card].selected')
  await selected.dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await expect(page.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.type('Independent variation')
  await page.keyboard.press('Escape')
  await expect(cardByText(page, 'Original research observation')).toBeVisible()
  await expect(cardByText(page, 'Independent variation')).toBeVisible()
  await waitForSync(page)
  await page.reload()
  await expect(cardByText(page, 'Independent variation')).toBeVisible()
  await cardByText(page, 'Independent variation').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('duplicate-selection')).toBeVisible()
  await context.setOffline(true)
  await page.keyboard.press(`${MOD}+d`)
  await expect(page.getByTestId('card')).toHaveCount(3)
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByTestId('card')).toHaveCount(2)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(page.getByTestId('card')).toHaveCount(3)
  await context.setOffline(false)
  await page.getByTestId('sync-status').click()
  await waitForSync(page)
  const objects = await snapshot(page, source)
  expect(objects.find((o) => o.id === originalId)?.content.md).toBe('Original research observation')
  expect(objects.filter((o) => o.kind === 'card')).toHaveLength(3)
})

test('a research tree copies columns, nested boards, assets and internal connectors without discussion or shortcut traversal', async ({ page, browser }) => {
  await freshBoard(page, 'Research tree source')
  const source = boardOf(page)
  const id = () => crypto.randomUUID()
  const child = id(), deep = id(), unrelated = id(), column = id(), note = id(), image = id(), tile = id(), shortcut = id(), deepNote = id(), connector = id(), comment = id(), asset = id()
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  for (const size of ['thumb', 'small', 'medium', 'full']) expect((await page.request.put(`/api/assets/${asset}/${size}`, { data: bytes, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  const board = (id: string, parentId: string | null, title: string) => ({ id, kind: 'board', parentId, title, icon: 'paw', color: 'sky', createdAt: Date.now() })
  const card = (id: string, type: string, content: unknown, x: number, y: number, extra = {}) => ({ id, kind: 'card', type, boardId: source, x, y, w: 260, h: 100, z: 1, color: 'none', createdAt: Date.now(), content, ...extra })
  const objects = [board(child, source, 'Nested study'), board(deep, child, 'Deep study'), board(unrelated, null, 'Unrelated project'),
    card(column, 'column', { title: 'References' }, 0, 0, { w: 280 }),
    card(note, 'note', { md: 'Keep the source unchanged' }, 0, 0, { columnId: column, order: 1 }),
    card(image, 'image', { assetId: asset, width: 1, height: 1, sizes: ['thumb', 'small', 'medium', 'full'] }, 340, 0),
    card(tile, 'board', { boardId: child }, 0, 260, { w: 120, h: 120 }),
    card(shortcut, 'board', { boardId: unrelated }, 340, 340, { w: 120, h: 120 }),
    card(deepNote, 'note', { md: 'Deep content' }, 0, 0, { boardId: deep }),
    { id: connector, kind: 'connection', boardId: source, from: note, to: image, arrow: 'end', createdAt: Date.now() },
    { id: comment, kind: 'comment', boardId: source, cardId: note, text: 'Original authors stay on the original board', createdAt: Date.now() },
  ]
  const written = await postSync(page.request, { data: { changes: objects.map((o) => ({ id: o.id, patch: o })) } })
  expect(written.ok(), await written.text()).toBe(true)
  await page.reload()
  await expect(cardByText(page, 'Keep the source unchanged')).toBeVisible()
  await action(page, 'duplicate-board')
  await expect(page.getByTestId('templates-dialog')).toContainText('Discussion stays on the original')
  await page.getByTestId('template-name').fill('Independent research copy')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Independent research copy')
  const copiedRoot = boardOf(page)
  await waitForSync(page)
  const copies = await snapshot(page, copiedRoot)
  expect(copies.filter((o) => o.kind === 'board')).toHaveLength(3)
  expect(copies.some((o) => objects.some((original) => original.id === o.id))).toBe(false)
  expect(copies.find((o) => o.id === copiedRoot)?.parentId).toBeNull()
  const copiedNote = copies.find((o) => o.content?.md === 'Keep the source unchanged')!
  const copiedImage = copies.find((o) => o.type === 'image')!
  const copiedColumn = copies.find((o) => o.type === 'column')!
  expect(copiedNote.columnId).toBe(copiedColumn.id)
  expect(copiedImage.content.assetId).toBe(asset)
  expect(copies.find((o) => o.kind === 'connection')).toMatchObject({ from: copiedNote.id, to: copiedImage.id })
  expect(copies.find((o) => o.type === 'board' && o.content.boardId === unrelated)).toBeTruthy()
  expect(copies.some((o) => o.kind === 'comment')).toBe(false)
  expect((await page.request.get(`/api/shares?boardId=${copiedRoot}`)).ok()).toBe(true)
  expect(await (await page.request.get(`/api/shares?boardId=${copiedRoot}`)).json()).toMatchObject({ shares: [], members: [] })
  // A second account in the legacy shared source cannot see the new private root.
  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    expect((await other.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
    expect((await other.request.get(`/api/boards/${copiedRoot}/copy-source`)).status()).toBe(403)
  } finally { await other.close() }
  await cardByText(page, 'Keep the source unchanged').dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await expect(page.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.press(`${MOD}+a`); await page.keyboard.type('Copy-only change'); await page.keyboard.press('Escape')
  await waitForSync(page)
  expect((await snapshot(page, source)).find((o) => o.id === note)?.content.md).toBe('Keep the source unchanged')
  await page.reload()
  await expect(cardByText(page, 'Copy-only change')).toBeVisible()
  await expect(page.getByTestId('card-image')).toBeVisible()
})

for (const [id, title] of [['research', 'Research'], ['moodboard', 'Moodboard'], ['project-brief', 'Project brief']]) {
  test(`${title} creates independent boards repeatedly and one Undo reverses each graph`, async ({ page }) => {
    await freshBoard(page)
    const origin = boardOf(page)
    await action(page, 'open-templates')
    await page.getByTestId(`template-${id}`).click()
    await page.getByTestId('create-from-template').click()
    await expect(page.getByTestId('board-name')).toHaveText(title)
    const one = boardOf(page)
    await waitForSync(page)
    const first = await snapshot(page, one)
    expect(first.filter((o) => o.kind === 'card').length).toBeGreaterThan(2)
    await page.keyboard.press(`${MOD}+z`)
    await expect(page).toHaveURL(new RegExp(origin))
    await waitForSync(page)
    const { objects } = await pullAllObjects(page.request)
    expect(objects.filter((o: Record<string, unknown>) => first.some((x) => x.id === o.id)).every((o: Record<string, unknown>) => o.purged)).toBe(true)
    await page.keyboard.press(`${MOD}+Shift+z`)
    await waitForSync(page)
    await action(page, 'open-templates')
    await page.getByTestId(`template-${id}`).click()
    await page.getByTestId('create-from-template').click()
    await expect(page.getByTestId('board-name')).toHaveText(title)
    expect(boardOf(page)).not.toBe(one)
    await waitForSync(page)
    const second = await snapshot(page, boardOf(page))
    expect(second.some((o) => first.some((old) => o.id === old.id))).toBe(false)
  })
}

test('personal layout snapshots survive reload; long names, empty layouts and removal remain forgiving', async ({ page }) => {
  await freshBoard(page)
  const longName = `Personal ${crypto.randomUUID()} ` + 'Long useful layout name '.repeat(4)
  await action(page, 'save-template')
  await page.getByTestId('template-name').fill(longName)
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
  await waitForSync(page)
  await page.reload()
  await action(page, 'open-templates')
  const layout = page.getByTestId('personal-template').filter({ hasText: longName })
  await expect(layout).toBeVisible()
  await layout.click()
  await page.getByTestId('template-name').fill('Empty but independent')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Empty but independent')
  await expect(page.getByTestId('card')).toHaveCount(0)
  await action(page, 'open-templates')
  await page.getByRole('button', { name: `Remove layout ${longName}`, exact: true }).click()
  await expect(layout).toHaveCount(0)
  await page.getByRole('button', { name: 'Close templates' }).click()
  await page.keyboard.press(`${MOD}+z`)
  await action(page, 'open-templates')
  await expect(layout).toBeVisible()
})

for (const viewport of [{ width: 360, height: 900 }, { width: 720, height: 480 }]) {
  test(`long personal library keeps name and creation controls visible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await freshBoard(page, 'Long library source')
    const prefix = `Library ${crypto.randomUUID()}`
    for (let index = 0; index < 8; index++) {
      await action(page, 'save-template')
      await page.getByTestId('template-name').fill(`${prefix} ${index} — reusable research sources and open questions`)
      await page.getByTestId('create-from-template').click()
      await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
      await waitForSync(page)
    }
    await page.reload()
    await action(page, 'open-templates')
    const dialog = page.getByTestId('templates-dialog')
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    // Check initial geometry before locator clicks/fill can auto-scroll an offscreen form.
    const controlsFit = async () => {
      const bounds = await dialog.boundingBox()
      expect(bounds).toBeTruthy()
      for (const control of [page.getByTestId('template-name'), page.getByTestId('create-from-template')]) {
        const box = await control.boundingBox()
        expect(box).toBeTruthy()
        expect(box!.x).toBeGreaterThanOrEqual(Math.max(0, bounds!.x))
        expect(box!.x + box!.width).toBeLessThanOrEqual(Math.min(viewport.width, bounds!.x + bounds!.width) + 1)
        expect(box!.y).toBeGreaterThanOrEqual(Math.max(0, bounds!.y))
        expect(box!.y + box!.height).toBeLessThanOrEqual(Math.min(viewport.height, bounds!.y + bounds!.height) + 1)
      }
    }
    await controlsFit()
    // Selecting a distant saved layout scrolls only the choices, keeping actions available.
    await page.getByTestId('personal-template').filter({ hasText: `${prefix} 0 —` }).click()
    await controlsFit()
    await page.getByTestId('template-name').fill('Independent long-library creation')
    await page.getByTestId('create-from-template').click()
    await expect(page.getByTestId('board-name')).toHaveText('Independent long-library creation')
    await waitForSync(page)
    await page.reload()
    await expect(page.getByTestId('board-name')).toHaveText('Independent long-library creation')
  })
}

test('copy failures and cancellation leave no partial graph and restore keyboard focus', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'Original stays safe')
  await waitForSync(page)
  const originalBoard = boardOf(page)
  const before = (await snapshot(page, originalBoard)).map((o) => o.id).sort()
  const canceledName = `Canceled independent copy ${crypto.randomUUID()}`
  await page.route('**/copy-source', (route) => route.fulfill({ status: 403, json: { error: 'The complete board tree is not available to copy. No copy was created.' } }))
  await action(page, 'duplicate-board')
  await page.getByTestId('template-name').fill(canceledName)
  await page.getByTestId('create-from-template').click()
  await expect(page.getByRole('alert')).toContainText('No copy was created')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
  await expect(page.getByTestId('board-more')).toBeFocused()
  await page.unroute('**/copy-source')
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/copy-source', async (route) => { await held; await route.abort().catch(() => {}) })
  await action(page, 'duplicate-board')
  await page.getByTestId('template-name').fill(canceledName)
  await page.getByTestId('create-from-template').click()
  await expect(page.getByRole('status').filter({ hasText: 'Checking the complete board tree' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  release()
  await page.unroute('**/copy-source')
  await expect(cardByText(page, 'Original stays safe')).toBeVisible()
  expect((await snapshot(page, originalBoard)).map((o) => o.id).sort()).toEqual(before)
  expect((await pullAllObjects(page.request)).objects.some((o: { title?: string }) => o.title === canceledName)).toBe(false)
})

test('canceling a copy waiting for sync immediately permits a local starter without a late canceled creation', async ({ page }) => {
  await freshBoard(page, 'Sync interruption source')
  await addNote(page, 'Original after canceled preflight')
  await waitForSync(page)
  const originalBoard = boardOf(page)
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const intercepted = new Promise<void>((resolve) => { entered = resolve })
  await page.route('**/api/sync?*', async (route) => { entered(); await held; await route.continue().catch(() => {}) })
  const canceledName = `Canceled sync copy ${crypto.randomUUID()}`
  try {
    await action(page, 'duplicate-board')
    await page.getByTestId('template-name').fill(canceledName)
    await page.getByTestId('create-from-template').click()
    await intercepted
    await expect(page.getByRole('status').filter({ hasText: 'Checking the complete board tree' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await action(page, 'open-templates')
    await expect(page.getByTestId('template-research')).toBeEnabled()
    await page.getByTestId('template-research').click()
    await page.getByTestId('template-name').fill('Local research after cancellation')
    await page.getByTestId('create-from-template').click()
    await expect(page.getByTestId('board-name')).toHaveText('Local research after cancellation')
  } finally {
    release()
    await page.unroute('**/api/sync?*')
  }
  await waitForSync(page)
  expect((await pullAllObjects(page.request)).objects.some((o: { title?: string }) => o.title === canceledName)).toBe(false)
  expect((await snapshot(page, originalBoard)).some((o) => o.content?.md === 'Original after canceled preflight')).toBe(true)
})


test('Templates Escape restores More focus and one subsequent Escape clears the canvas selection', async ({ page }) => {
  await freshBoard(page, 'Templates keyboard return')
  await addNote(page, 'Keep this selected research note unchanged')
  await waitForSync(page)
  const root = boardOf(page)
  const before = (await snapshot(page, root)).filter((object) => object.kind === 'card').map((object) => ({ id: object.id, content: object.content }))
  const selected = page.locator('.card.selected')
  const more = page.getByTestId('board-more')
  await expect(selected).toHaveCount(1)
  await action(page, 'open-templates')
  // A modal owns its first Escape; it must not also clear the canvas selection.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
  await expect(more).toBeFocused()
  await expect(selected).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(selected).toHaveCount(0)
  await expect(more).toBeFocused()
  // Select All remains a canvas command while the restored topbar button owns focus.
  await page.keyboard.press(`${MOD}+a`)
  await expect(selected).toHaveCount(1)
  await expect(more).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(selected).toHaveCount(0)
  await expect(more).toBeFocused()
  expect((await snapshot(page, root)).filter((object) => object.kind === 'card').map((object) => ({ id: object.id, content: object.content }))).toEqual(before)
})
