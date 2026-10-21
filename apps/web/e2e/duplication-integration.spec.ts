import { expect, test, type Page } from '@playwright/test'
import { inkBounds } from '@doggynote/core'
import { MOD, cardByText, freshBoard, postSync, waitForSync } from './helpers.ts'

const boardOf = (page: Page) => decodeURIComponent(page.url().split('#/b/')[1])
async function source(page: Page, id: string) {
  const response = await page.request.get(`/api/boards/${id}/copy-source`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).objects as Record<string, any>[]
}
async function menu(page: Page, action: string) {
  await page.getByTestId('board-more').click()
  await page.getByTestId(action).click()
}

test('saved layouts preserve actual locks, collapsed members, image attribution, labels, swatches and independent synced groups', async ({ page }) => {
  test.setTimeout(90_000)
  await freshBoard(page, 'Integrated reusable layout source')
  const root = boardOf(page)
  const child = crypto.randomUUID(), col = crypto.randomUUID(), a = crypto.randomUUID(), b = crypto.randomUUID(), group = crypto.randomUUID(), swatch = crypto.randomUUID(), image = crypto.randomUUID(), tile = crypto.randomUUID()
  const label = 'b'.repeat(32), asset = crypto.randomUUID(), now = Date.now()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  for (const size of ['thumb', 'small', 'medium', 'full']) expect((await page.request.put(`/api/assets/${asset}/${size}`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  const card = (id: string, type: string, content: unknown, x: number, y: number, extra = {}) => ({ id, kind: 'card', type, boardId: root, x, y, w: 260, h: 100, z: 1, color: 'none', content, createdAt: now, ...extra })
  const objects = [
    { id: root, [`labelName${label}`]: 'Lighting references', [`labelColor${label}`]: 'sky' },
    { id: child, kind: 'board', parentId: root, title: 'Linked brief context', icon: 'paw', color: 'sky', createdAt: now },
    card(col, 'column', { title: 'Collapsed but complete' }, 0, 0, { w: 280, h: 250, collapsed: true }),
    card(a, 'note', { md: 'Shared original brief' }, 0, 0, { noteGroupId: group, columnId: col, order: 2, [`label${label}`]: true }),
    card(b, 'note', { md: 'Shared original brief' }, 0, 0, { noteGroupId: group, boardId: child }),
    card(swatch, 'swatch', {}, 340, 0, { swatchHex: '#2F5D50', swatchName: 'Forest', swatchCaption: 'Primary packaging', swatchHexDraft: '#2F' }),
    card(image, 'image', { assetId: asset, width: 1, height: 1, sizes: ['thumb', 'small', 'medium', 'full'] }, 0, 340, { positionLocked: true, imageCaption: 'Warm side lighting; use for the opening scene', imageSourceUrl: 'https://example.com/original-photo' }),
    card(tile, 'board', { boardId: child }, 340, 340, { w: 120, h: 120 }),
  ]
  const written = await postSync(page.request, { data: { changes: objects.map((o) => ({ id: o.id, patch: o })) } })
  expect(written.ok(), await written.text()).toBe(true)
  await page.reload()
  await expect(page.getByTestId('column-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('image-caption')).toContainText('Warm side lighting')
  await menu(page, 'save-template')
  const layoutName = `Reusable research ${crypto.randomUUID().slice(0, 6)}`
  await page.getByTestId('template-name').fill(layoutName)
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
  await waitForSync(page)
  await menu(page, 'open-templates')
  await page.getByTestId('personal-template').filter({ hasText: layoutName }).click()
  await page.getByTestId('template-name').fill('Fresh independent research')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Fresh independent research')
  const reused = boardOf(page)
  await waitForSync(page)
  const graph = await source(page, reused)
  const copiedRoot = graph.find((o) => o.id === reused)!
  expect(copiedRoot[`labelName${label}`]).toBe('Lighting references')
  expect(copiedRoot.templateName).toBeUndefined()
  expect(graph.find((o) => o.type === 'column')).toMatchObject({ collapsed: true })
  expect(graph.find((o) => o.type === 'swatch')).toMatchObject({ swatchHex: '#2F5D50', swatchHexDraft: '#2F', swatchName: 'Forest', swatchCaption: 'Primary packaging' })
  expect(graph.find((o) => o.type === 'image')).toMatchObject({ positionLocked: true, imageCaption: 'Warm side lighting; use for the opening scene', imageSourceUrl: 'https://example.com/original-photo', content: { assetId: asset } })
  const notes = graph.filter((o) => o.noteGroupId)
  expect(notes).toHaveLength(2)
  expect(notes[0].noteGroupId).toBe(notes[1].noteGroupId)
  expect(notes[0].noteGroupId).not.toBe(group)
  expect(notes.find((o) => o.boardId === reused)?.[`label${label}`]).toBe(true)
  await page.getByTestId('column-toggle').click()
  await cardByText(page, 'Shared original brief').locator('.note-body').dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await expect(page.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.press(`${MOD}+a`); await page.keyboard.type('Only the reused group changes'); await page.keyboard.press('Escape')
  await waitForSync(page)
  expect((await source(page, reused)).filter((o) => o.content?.md === 'Only the reused group changes')).toHaveLength(2)
  expect((await source(page, root)).filter((o) => o.content?.md === 'Shared original brief')).toHaveLength(2)
  await page.reload()
  await expect(cardByText(page, 'Only the reused group changes')).toBeVisible()
  await expect(page.getByTestId('image-source')).toHaveAttribute('href', 'https://example.com/original-photo')
})

test('a read-only board-only recipient gets a complete-copy error without inaccessible descendant names', async ({ page, browser }) => {
  await freshBoard(page)
  const root = boardOf(page), child = crypto.randomUUID()
  const added = await postSync(page.request, { data: { changes: [{ id: child, patch: { id: child, kind: 'board', parentId: root, title: 'Hidden descendant name must not leak', icon: 'paw', color: 'gold', createdAt: Date.now() } }] } })
  expect(added.ok()).toBe(true)
  // A private synthetic root prevents legacy membership from granting the child.
  const personal = await page.request.get('/api/access')
  const home = (await personal.json()).homeBoardId
  expect((await postSync(page.request, { data: { changes: [{ id: root, patch: { parentId: home } }] } })).ok()).toBe(true)
  expect((await page.request.post(`/api/boards/${root}/members`, { data: { username: 'fido', permission: 'view', includeChildren: false } })).status()).toBe(201)
  const viewer = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    expect((await viewer.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
    const tab = await viewer.newPage()
    await tab.goto(`/#/b/${root}`)
    await expect(tab.getByTestId('board-permission')).toHaveText('View only')
    await menu(tab, 'duplicate-board')
    await tab.getByTestId('create-from-template').click()
    await expect(tab.getByRole('alert')).toContainText('complete board tree')
    await expect(tab.getByTestId('templates-dialog')).not.toContainText('Hidden descendant name')
    await tab.keyboard.press('Escape')
    await expect(tab.getByTestId('board-more')).toBeFocused()
  } finally { await viewer.close() }
})

test('creative board copies keep editable annotation, sketch and ink owners through Undo and template reuse', async ({ page }) => {
  test.setTimeout(90_000)
  await freshBoard(page, 'Independent storyboard source')
  const root = boardOf(page), now = Date.now(), asset = crypto.randomUUID()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  expect((await page.request.put(`/api/assets/${asset}/full`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  const owners = [
    { type: 'image', content: { assetId: asset, width: 320, height: 240, sizes: ['full'] }, imageCaption: 'Opening frame lighting', imageSourceUrl: 'https://example.com/reference' },
    { type: 'sketch', content: { title: 'Opening frame', width: 320, height: 240, background: 'paper' } },
    { type: 'ink', content: { width: 320, height: 240 } },
  ].map((fields, i) => ({ id: crypto.randomUUID(), kind: 'card', boardId: root, x: i * 350, y: 0, w: 320, h: 240, z: i + 1, color: 'none', createdAt: now, ...fields }))
  const points = [{ x: 20, y: 30 }, { x: 120, y: 80 }, { x: 220, y: 180 }]
  const strokes = owners.map((c) => ({ id: crypto.randomUUID(), kind: 'stroke', boardId: root, cardId: c.id, tool: 'pen', color: '#245FE5', width: 6, opacity: 1, order: 1, points, bounds: inkBounds(points, 6), createdAt: now }))
  const seeded = await postSync(page.request, { data: { changes: [...owners, ...strokes].map((o) => ({ id: o.id, patch: o })) } })
  expect(seeded.ok(), await seeded.text()).toBe(true)
  await page.reload()
  await menu(page, 'duplicate-board')
  await page.getByTestId('template-name').fill('Independent storyboard alternative')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Independent storyboard alternative')
  const copiedRoot = boardOf(page)
  await waitForSync(page)
  const graph = await source(page, copiedRoot)
  const copiedStrokes = graph.filter((o) => o.kind === 'stroke')
  expect(copiedStrokes).toHaveLength(3)
  for (const type of ['image', 'sketch', 'ink']) {
    const owner = graph.find((o) => o.type === type)!
    const original = owners.find((o) => o.type === type)!
    expect(owner.id).not.toBe(original.id)
    expect(owner.content).toEqual(original.content)
    expect(copiedStrokes.find((o) => o.cardId === owner.id)).toMatchObject({ boardId: copiedRoot, points, color: '#245FE5' })
    await expect(page.locator(`[data-card-id="${owner.id}"] [data-stroke-id]`)).toHaveCount(1)
  }
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByTestId('board-name')).toHaveText('Independent storyboard source')
  await page.keyboard.press(`${MOD}+Shift+z`)
  await waitForSync(page)
  expect((await source(page, copiedRoot)).filter((o) => o.kind === 'stroke')).toHaveLength(3)
  await page.goto(`/#/b/${copiedRoot}`)
  const copiedSketch = graph.find((o) => o.type === 'sketch')!
  await page.locator(`[data-card-id="${copiedSketch.id}"]`).getByTestId('sketch-paper').dblclick()
  const editor = page.getByTestId('stroke-editor')
  await expect(editor).toBeVisible()
  const box = await editor.getByTestId('ink-surface').boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box!.x + box!.width * .2, box!.y + box!.height * .7)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * .8, box!.y + box!.height * .7, { steps: 10 })
  await page.mouse.up()
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page)
  expect((await source(page, copiedRoot)).filter((o) => o.kind === 'stroke' && o.cardId === copiedSketch.id)).toHaveLength(2)
  expect((await source(page, root)).filter((o) => o.kind === 'stroke')).toHaveLength(3)
  await menu(page, 'save-template')
  const layoutName = `Storyboard ${crypto.randomUUID().slice(0, 6)}`
  await page.getByTestId('template-name').fill(layoutName)
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
  await waitForSync(page)
  await menu(page, 'open-templates')
  await page.getByTestId('personal-template').filter({ hasText: layoutName }).click()
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
  await waitForSync(page)
  const reused = await source(page, boardOf(page))
  expect(reused.filter((o) => o.kind === 'stroke')).toHaveLength(4)
  expect(reused.every((o) => !graph.some((prior) => prior.id === o.id))).toBe(true)
})

for (const undoVia of ['keyboard', 'toast'] as const) test(`copy Undo via ${undoVia} preserves the whole graph after another session draws on a copied owner`, async ({ page, browser }) => {
  test.setTimeout(90_000)
  async function mark(tab: Page) {
    const editor = tab.getByTestId('stroke-editor')
    await expect(editor).toBeVisible()
    const box = await editor.getByTestId('ink-surface').boundingBox()
    expect(box).toBeTruthy()
    await tab.mouse.move(box!.x + box!.width * .2, box!.y + box!.height * .4)
    await tab.mouse.down()
    await tab.mouse.move(box!.x + box!.width * .8, box!.y + box!.height * .7, { steps: 10 })
    await tab.mouse.up()
    await editor.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await waitForSync(tab)
  }
  await freshBoard(page, 'Collaborative storyboard source')
  const original = boardOf(page)
  await page.getByTestId('tool-sketch').click()
  await mark(page)
  await menu(page, 'duplicate-board')
  await page.getByTestId('template-name').fill('Collaborative storyboard alternative')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Collaborative storyboard alternative')
  const copiedRoot = boardOf(page)
  await waitForSync(page)
  const copied = await source(page, copiedRoot)
  const owner = copied.find((o) => o.type === 'sketch')!
  const peer = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    expect((await peer.request.post('/api/auth/login', { data: { username: 'rex', password: 'goodboy123' } })).ok()).toBe(true)
    const tab = await peer.newPage()
    await tab.goto(`/#/b/${copiedRoot}`)
    await tab.locator(`[data-card-id="${owner.id}"]`).getByTestId('sketch-paper').dblclick()
    await mark(tab)
    await page.bringToFront()
    // The app polls every ten seconds; bringing a headless page forward does
    // not guarantee a window focus event. Use the same visible sync action as
    // a user, and observe its completed pull before checking copy history.
    const pulled = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/sync')
    await page.getByTestId('sync-status').click()
    await pulled
    await waitForSync(page)
    await page.keyboard.press('Escape')
    await expect(page.locator(`[data-card-id="${owner.id}"] [data-stroke-id]`)).toHaveCount(2)
    if (undoVia === 'toast') await page.getByTestId('toast-action').click()
    else await page.keyboard.press(`${MOD}+z`)
    await expect(page.getByTestId('toast')).toContainText('Cannot undo')
    await expect(page.getByTestId('board-name')).toHaveText('Collaborative storyboard alternative')
    await waitForSync(page)
    const kept = await source(page, copiedRoot)
    expect(copied.every((o) => kept.some((k) => k.id === o.id))).toBe(true)
    expect(kept.filter((o) => o.kind === 'stroke' && o.cardId === owner.id)).toHaveLength(2)
    expect((await source(page, original)).filter((o) => o.kind === 'stroke')).toHaveLength(1)
    await page.reload()
    await expect(page.locator(`[data-card-id="${owner.id}"] [data-stroke-id]`)).toHaveCount(2)
  } finally { await peer.close() }
})

test('600px floating toolbar exposes Duplicate and preserves collapsed column copies through one Undo', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 600, height: 900 })
  await freshBoard(page, 'Narrow reusable research layout')
  await menu(page, 'open-templates')
  await page.getByTestId('template-research').click()
  await page.getByTestId('template-name').fill('Research references at 600px')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Research references at 600px')
  await waitForSync(page)
  const root = boardOf(page)
  const initial = await source(page, root)
  const column = initial.find((object) => object.type === 'column')!
  const members = initial.filter((object) => object.columnId === column.id)
  expect(members.length).toBeGreaterThan(0)
  const originalIds = new Set(initial.map((object) => object.id))
  async function allActionsFit() {
    const bar = page.getByTestId('selection-bar')
    await expect(bar).not.toHaveClass(/docked/)
    // Before any locator click can auto-scroll, every visible action must fit
    // the floating bar and viewport at its current horizontal scroll position.
    await expect.poll(() => bar.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const controls = [...element.querySelectorAll('button,select')].filter((control) => control.getClientRects().length)
      return controls.length > 0 && controls.every((control) => {
        const r = control.getBoundingClientRect()
        return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
      })
    })).toBe(true)
    await expect(page.getByTestId('duplicate-selection')).toBeVisible()
  }
  const more = page.getByTestId('board-more')
  await expect(more).toBeFocused()
  await page.keyboard.press(`${MOD}+a`)
  await allActionsFit()
    await expect(more).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.card.selected')).toHaveCount(0)
  await expect(more).toBeFocused()
  const originalColumn = page.locator(`[data-card-id="${column.id}"]`)
  await originalColumn.locator('.column-head').click({ modifiers: ['Shift'] })
  await expect(originalColumn).toHaveClass(/selected/)
  await allActionsFit()
  await page.getByTestId('selection-column-toggle').click()
  await expect(originalColumn.getByTestId('column-toggle')).toHaveAttribute('aria-expanded', 'false')
  await allActionsFit()
  await page.getByTestId('duplicate-selection').click()
  await waitForSync(page)
  const after = await source(page, root)
  const added = after.filter((object) => !originalIds.has(object.id))
  const copiedColumn = added.find((object) => object.type === 'column')!
  expect(copiedColumn).toMatchObject({ collapsed: true, content: column.content })
  expect(added).toHaveLength(members.length + 1)
  expect(added.filter((object) => object.columnId === copiedColumn.id).map((object) => object.content)).toEqual(members.map((object) => object.content))
  await expect(page.locator(`[data-card-id="${copiedColumn.id}"]`).getByTestId('column-toggle')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.locator(`[data-card-id="${copiedColumn.id}"]`)).toHaveCount(0)
  await waitForSync(page)
  const undone = await source(page, root)
  expect(undone.every((object) => originalIds.has(object.id))).toBe(true)
  expect(undone.find((object) => object.id === column.id)).toMatchObject({ collapsed: true })
  expect(undone.filter((object) => object.columnId === column.id)).toHaveLength(members.length)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(page.locator(`[data-card-id="${copiedColumn.id}"]`).getByTestId('column-toggle')).toHaveAttribute('aria-expanded', 'false')
  await waitForSync(page)
  expect((await source(page, root)).filter((object) => !originalIds.has(object.id)).map((object) => object.id).sort()).toEqual(added.map((object) => object.id).sort())
})

test('Undo inside a copied nested board returns to its source and Redo restores the whole tree', async ({ page }) => {
  await freshBoard(page, 'Source before nested research copy')
  const original = boardOf(page)
  await menu(page, 'open-templates')
  await page.getByTestId('template-research').click()
  await page.getByTestId('template-name').fill('Nested research alternative')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Nested research alternative')
  await waitForSync(page)
  const copiedRoot = boardOf(page)
  const graph = await source(page, copiedRoot)
  await cardByText(page, 'Deeper research').locator('.board-tile').dblclick()
  await expect(page.getByTestId('board-name')).toHaveText('Deeper research')
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByTestId('board-name')).toHaveText('Source before nested research copy')
  expect(boardOf(page)).toBe(original)
  await waitForSync(page)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await waitForSync(page)
  const restored = await source(page, copiedRoot)
  expect(restored.map((object) => object.id).sort()).toEqual(graph.map((object) => object.id).sort())
  await page.goto(`/#/b/${copiedRoot}`)
  await expect(page.getByTestId('board-name')).toHaveText('Nested research alternative')
  await cardByText(page, 'Deeper research').locator('.board-tile').dblclick()
  await expect(page.getByTestId('board-name')).toHaveText('Deeper research')
})
