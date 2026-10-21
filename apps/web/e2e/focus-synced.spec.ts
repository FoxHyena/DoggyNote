import { expect, test, type Browser, type Page } from '@playwright/test'
import { AUTH_FILE } from '../playwright.config.ts'
import { MOD, addNote, cardByText, freshBoard, openParentBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

async function openFocus(page: Page, text: string) {
  await cardByText(page, text).click()
  await page.getByTestId('focus-note').click()
  const surface = page.getByTestId('focus-surface')
  await expect(surface).toBeVisible()
  return surface
}
async function sync(page: Page) {
  await page.getByTestId('sync-status').click()
  await waitForSync(page)
  await page.keyboard.press('Escape')
}
async function expectNoRecovery(page: Page) {
  await expect(page.getByTestId('sync-status')).not.toHaveAccessibleName('Save status: Review edits')
}
async function person(admin: Page, browser: Browser) {
  const username = `focus_${crypto.randomUUID().slice(0, 8)}`
  expect((await admin.request.post('/api/users', { data: { username, password: 'focusedwriting123' } })).status()).toBe(201)
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '2' } })
  expect((await context.request.post('/api/auth/login', { data: { username, password: 'focusedwriting123' } })).ok()).toBe(true)
  const access = await (await context.request.get('/api/access')).json()
  return { username, context, home: access.homeBoardId as string }
}

test('focused writing edits shared body both ways across overview and research boards, including offline and Undo', async ({ page, context, browser }) => {
  test.setTimeout(120_000)
  await freshBoard(page, `Focused overview ${crypto.randomUUID().slice(0, 6)}`)
  const overviewUrl = page.url()
  await page.getByTestId('tool-board').click()
  await page.keyboard.type('Focused research')
  await page.keyboard.press('Enter')
  await cardByText(page, 'Focused research').locator('.board-tile').dblclick()
  const researchId = decodeURIComponent(page.url().split('/b/')[1]!)
  await openParentBoard(page)
  const note = await addNote(page, 'Short research note', 0.35, 0.65)
  const originalId = (await note.getAttribute('data-card-id'))!
  await page.getByTestId('note-copies').click()
  await page.getByRole('combobox', { name: 'Destination board' }).selectOption(researchId)
  await page.getByTestId('create-synced-copy').click()
  await expect(page.getByTestId('board-name')).toHaveText('Focused research')
  const researchNote = page.getByTestId('card')
  const researchNoteId = (await researchNote.getAttribute('data-card-id'))!
  const surface = await openFocus(page, 'Short research note')
  await expect(surface.getByTestId('focus-synced-hint')).toHaveText('Synced note · edits update linked notes')
  await expect(surface.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.type('# Project brief\n\nA substantial brief with [sources](https://example.com) and `code`.')
  await surface.getByTestId('focus-return').click()
  await waitForSync(page)
  await expectNoRecovery(page)
  const otherContext = await browser.newContext({ storageState: AUTH_FILE })
  try {
    const other = await otherContext.newPage()
    await other.goto(overviewUrl)
    await expect(other.locator(`[data-card-id="${originalId}"]`)).toContainText('Project brief')
    const otherSurface = await openFocus(other, 'Project brief')
    await expect(otherSurface.getByTestId('focus-synced-hint')).toBeVisible()
    await other.keyboard.press(`${MOD}+a`)
    await other.keyboard.type('Overview revision of the same brief.')
    await otherSurface.getByTestId('focus-return').click()
    await waitForSync(other)
    await expectNoRecovery(other)
    await sync(page)
    await expectNoRecovery(page)
    await expect(researchNote).toContainText('Overview revision')
    await openFocus(page, 'Overview revision')
    await context.setOffline(true)
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type('Offline focused revision.')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', /[1-9]/)
    await context.setOffline(false)
    await sync(page)
    await sync(other)
    await expectNoRecovery(page)
    await expectNoRecovery(other)
    await expect(other.locator(`[data-card-id="${originalId}"]`)).toContainText('Offline focused revision.')
    await page.keyboard.press(`${MOD}+z`)
    await expect(researchNote).toContainText('Overview revision')
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(researchNote).toContainText('Offline focused revision.')
    await waitForSync(page)
    await expectNoRecovery(page)
    const { objects } = await pullAllObjects(page.request)
    const original = objects.find((o: { id: string }) => o.id === originalId)
    const linked = objects.find((o: { id: string }) => o.id === researchNoteId)
    expect(original.noteGroupId).toBeTruthy()
    expect(original.noteGroupId).toBe(linked.noteGroupId)
    expect(original.content.md).toBe(linked.content.md)
    expect(original.content.md).toBe('Offline focused revision.')
    await page.reload()
    await openFocus(page, 'Offline focused revision.')
    await expect(page.getByTestId('note-editor')).toContainText('Offline focused revision.')
  } finally { await context.setOffline(false); await otherContext.close() }
})

test('focus respects read-only shared body without revealing hidden locations or granting edits', async ({ page, browser }) => {
  const owner = await person(page, browser), guest = await person(page, browser)
  try {
    const visibleBoard = crypto.randomUUID(), hiddenBoard = crypto.randomUUID(), note = crypto.randomUUID(), hiddenNote = crypto.randomUUID(), group = crypto.randomUUID()
    const hiddenTitle = `Hidden ${crypto.randomUUID()}`
    const response = await postSync(owner.context.request, { data: { changes: [
      { id: visibleBoard, patch: { id: visibleBoard, kind: 'board', parentId: owner.home, title: 'Accessible brief', icon: 'paw', color: 'none', createdAt: Date.now() } },
      { id: hiddenBoard, patch: { id: hiddenBoard, kind: 'board', parentId: owner.home, title: hiddenTitle, icon: 'paw', color: 'none', createdAt: Date.now() } },
      ...[[note, visibleBoard], [hiddenNote, hiddenBoard]].map(([id, boardId]) => ({ id, patch: { id, kind: 'card', type: 'note', boardId, x: 0, y: 0, w: 280, h: 80, z: 1, color: 'none', noteGroupId: group, content: { md: 'Shared protected brief' }, createdAt: Date.now() } })),
    ] } })
    expect(response.ok(), await response.text()).toBe(true)
    expect((await owner.context.request.post(`/api/boards/${visibleBoard}/members`, { data: { username: guest.username, permission: 'edit', includeChildren: false } })).status()).toBe(201)
    const view = await guest.context.newPage()
    await view.goto(`/#/b/${visibleBoard}`)
    await expect(view.getByTestId('board-permission')).toHaveText('Can edit')
    const surface = await openFocus(view, 'Shared protected brief')
    await expect(surface).toContainText('Focused reading')
    await expect(surface.getByTestId('focus-synced-hint')).toHaveText('Synced note · read-only body')
    await expect(surface.getByTestId('note-editor')).toHaveCount(0)
    await expect(surface).not.toContainText(hiddenTitle)
    await view.keyboard.type('unauthorized overwrite')
    await view.keyboard.press('Escape')
    expect((await guest.context.request.post('/api/sync', { data: { changes: [{ id: note, patch: { content: { md: 'unauthorized overwrite' } } }] } })).status()).toBe(403)
    const { objects } = await pullAllObjects(owner.context.request)
    expect(objects.find((o: { id: string }) => o.id === hiddenNote).content.md).toBe('Shared protected brief')
    expect(objects.find((o: { id: string }) => o.id === note).content.md).toBe('Shared protected brief')
  } finally { await Promise.all([owner.context.close(), guest.context.close()]) }
})

test('revoking access during focused typing preserves unsynced text for recovery and closes the protected surface', async ({ page, browser }) => {
  const owner = await person(page, browser), guest = await person(page, browser)
  try {
    const boardId = crypto.randomUUID(), noteId = crypto.randomUUID()
    expect((await postSync(owner.context.request, { data: { changes: [
      { id: boardId, patch: { id: boardId, kind: 'board', parentId: owner.home, title: 'Focused recovery QA', icon: 'paw', color: 'none', createdAt: Date.now() } },
      { id: noteId, patch: { id: noteId, kind: 'card', type: 'note', boardId, x: 0, y: 0, w: 280, h: 80, z: 1, color: 'none', content: { md: 'Original protected text' }, createdAt: Date.now() } },
    ] } })).ok()).toBe(true)
    expect((await owner.context.request.post(`/api/boards/${boardId}/members`, { data: { username: guest.username, permission: 'edit' } })).status()).toBe(201)
    const view = await guest.context.newPage()
    await view.goto(`/#/b/${boardId}`)
    await view.route('**/api/sync', (route) => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue())
    const surface = await openFocus(view, 'Original protected text')
    await expect(surface.getByTestId('note-editor')).toBeFocused()
    await view.keyboard.press(`${MOD}+a`)
    await view.keyboard.type('Last focused sentence before access changed.')
    const list = await (await owner.context.request.get(`/api/shares?boardId=${boardId}`)).json()
    const member = list.members.find((m: { username: string }) => m.username === guest.username)
    expect((await owner.context.request.delete(`/api/boards/${boardId}/members/${member.id}`)).ok()).toBe(true)
    await surface.getByTestId('sync-status').click()
    await expect(surface).toHaveCount(0)
    await expect(view.getByRole('heading', { name: 'This board is unavailable' })).toBeVisible()
    await expect(view.getByTestId('card')).toHaveCount(0)
    await view.unroute('**/api/sync')
    await view.getByTestId('sync-status').click()
    await expect(view.getByTestId('download-recovery')).toBeVisible()
    const downloaded = view.waitForEvent('download')
    await view.getByTestId('download-recovery').click()
    const download = await downloaded
    const { readFile } = await import('node:fs/promises')
    expect(await readFile((await download.path())!, 'utf8')).toContain('Last focused sentence before access changed.')
    const { objects } = await pullAllObjects(owner.context.request)
    expect(objects.find((o: { id: string }) => o.id === noteId).content.md).toBe('Original protected text')
  } finally { await Promise.all([owner.context.close(), guest.context.close()]) }
})

test('a focused note moved into a private Inbox preserves the draft and ends its old edit session', async ({ page, browser }) => {
  const owner = await person(page, browser), guest = await person(page, browser)
  let view: Page | undefined
  let resumePull = () => {}
  try {
    const { user } = await (await owner.context.request.get('/api/me')).json()
    const inbox = `toybox:${user.id}`
    const boardId = crypto.randomUUID(), noteId = crypto.randomUUID()
    const privateTitle = `Private Inbox ${crypto.randomUUID()}`
    const privateText = `Private owner revision ${crypto.randomUUID()}`
    const draft = 'My last focused sentence before the note moved.'
    expect((await postSync(owner.context.request, { data: { changes: [
      { id: boardId, patch: { id: boardId, kind: 'board', parentId: owner.home, title: 'Still editable shared board', icon: 'paw', color: 'none', createdAt: Date.now() } },
      { id: inbox, patch: { id: inbox, kind: 'board', parentId: null, title: privateTitle, icon: 'paw', color: 'none', createdAt: Date.now() } },
      { id: noteId, patch: { id: noteId, kind: 'card', type: 'note', boardId, x: 0, y: 0, w: 280, h: 80, z: 1, color: 'none', content: { md: 'Research before private move' }, createdAt: Date.now() } },
    ] } })).ok()).toBe(true)
    expect((await owner.context.request.post(`/api/boards/${boardId}/members`, { data: { username: guest.username, permission: 'edit' } })).status()).toBe(201)
    view = await guest.context.newPage()
    await view.goto(`/#/b/${boardId}`)
    await expect(view.getByTestId('board-permission')).toHaveText('Can edit')
    // Hold pulls until the explicit sync click so background sync cannot race
    // that click by removing its surface. The released pull uses the real API.
    const heldPull = new Promise<void>((resolve) => { resumePull = resolve })
    await view.route((url) => url.pathname === '/api/sync', async (route) => {
      if (route.request().method() === 'POST') return route.abort('internetdisconnected')
      await heldPull
      await route.continue()
    })
    const surface = await openFocus(view, 'Research before private move')
    await expect(surface.getByTestId('note-editor')).toBeFocused()
    await view.keyboard.press(`${MOD}+a`)
    await view.keyboard.insertText(draft)
    expect((await postSync(owner.context.request, { data: { changes: [{ id: noteId, patch: { boardId: inbox, content: { md: privateText } } }] } })).ok()).toBe(true)
    await surface.getByTestId('sync-status').click()
    resumePull()
    await expect(surface).toHaveCount(0)
    await expect(view.getByTestId('note-editor')).toHaveCount(0)
    await expect(view.locator(`[data-card-id="${noteId}"]`)).toHaveCount(0)
    await expect(view.getByTestId('board-permission')).toHaveText('Can edit')
    await expect(view.locator('body')).not.toContainText(privateText)
    await expect(view.locator('body')).not.toContainText(privateTitle)
    await view.getByTestId('sync-status').click()
    await expect(view.getByTestId('download-recovery')).toBeVisible()
    const downloaded = view.waitForEvent('download')
    await view.getByTestId('download-recovery').click()
    const download = await downloaded
    const { readFile } = await import('node:fs/promises')
    const recovery = await readFile((await download.path())!, 'utf8')
    expect(recovery).toContain(draft)
    expect(recovery).not.toContain(privateText)
    expect(recovery).not.toContain(privateTitle)
    await view.keyboard.press('Escape')
    await addNote(view, 'Can keep writing on this board')
    await view.unrouteAll({ behavior: 'wait' })
    await sync(view)
    await view.reload()
    await expect(view.getByTestId('card')).toHaveCount(1)
    await expect(view.getByTestId('card')).toContainText('Can keep writing on this board')
    const { objects } = await pullAllObjects(owner.context.request)
    expect(objects.find((o: { id: string }) => o.id === noteId)).toMatchObject({ boardId: inbox, content: { md: privateText } })
  } finally {
    resumePull()
    await view?.unrouteAll({ behavior: 'wait' })
    await Promise.all([owner.context.close(), guest.context.close()])
  }
})
