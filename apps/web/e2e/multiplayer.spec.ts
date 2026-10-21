import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MOD, addNote, camera, cardByText, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

const contexts = new Set<BrowserContext>()
async function focusEditor(page: Page) { await page.bringToFront(); await page.getByTestId('note-editor').focus() }
async function start(page: Page) { await focusEditor(page); await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('ArrowLeft') }
async function end(page: Page) { await focusEditor(page); await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('ArrowRight') }
test.afterEach(async () => { await Promise.all([...contexts].map((c) => c.close())); contexts.clear() })
async function friend(browser: Browser, owner: Page, permission = 'edit') {
  const id = owner.url().split('/b/')[1]!
  const grant = await owner.request.post(`/api/boards/${id}/members`, { data: { username: 'fido', permission, includeChildren: true } })
  expect(grant.ok(), await grant.text()).toBe(true)
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
  contexts.add(context)
  expect((await context.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  const page = await context.newPage()
  await page.goto(owner.url())
  await expect(page.getByTestId('canvas')).toBeVisible()
  return page
}
async function live(page: Page) {
  await page.getByTestId('collaborators').click()
  await expect(page.getByTestId('live-status')).toHaveText('Live')
  await page.keyboard.press('Escape')
}

test('members, live cursors, selections, pings and following work without manual refresh', async ({ page, browser }) => {
  await freshBoard(page, 'Multiplayer studio')
  await addNote(page, 'A place for shared ideas')
  await waitForSync(page)
  const other = await friend(browser, page)
  await live(page); await live(other)
  await page.getByTestId('collaborators').click()
  await expect(page.getByTestId('participant')).toHaveCount(2)
  await expect(page.getByTestId('participant').filter({ hasText: 'fido' })).toContainText('Can edit')
  await page.keyboard.press('Escape')
  const box = (await other.getByTestId('canvas').boundingBox())!
  await other.bringToFront()
  await other.mouse.move(box.x + 100, box.y + 100)
  await expect(page.getByTestId('remote-cursor')).toBeVisible()
  await cardByText(other, 'A place for shared ideas').click()
  await expect(page.getByTestId('remote-selection')).toBeVisible()
  await other.keyboard.press('Escape')
  await other.getByTestId('collaborators').click()
  await other.getByRole('button', { name: 'Look here', exact: true }).click()
  await expect(page.getByTestId('remote-ping')).toBeVisible()
  await expect(page.getByTestId('remote-ping')).toHaveCount(0, { timeout: 5000 })
  await page.getByTestId('collaborators').click()
  await page.getByRole('button', { name: 'Follow fido', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop following' })).toBeVisible()
  await other.mouse.move(box.x + 150, box.y + 150)
  await other.mouse.wheel(0, 200)
  await expect.poll(async () => Math.abs((await camera(page)).ty - (await camera(other)).ty)).toBeLessThan(2)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Stop following' })).toHaveCount(0)
})

test('two authors type in one note, merge within one second, and undo only their own typing', async ({ page, browser }) => {
  await freshBoard(page)
  await addNote(page, 'Shared')
  await waitForSync(page)
  const other = await friend(browser, page)
  await live(page); await live(other)
  await cardByText(page, 'Shared').dblclick(); await end(page)
  await cardByText(other, 'Shared').dblclick(); await end(other)
  await page.keyboard.type(' from rex')
  await expect(other.getByTestId('note-editor')).toContainText('from rex', { timeout: 1000 })
  await end(other); await other.keyboard.type(' from fido')
  await expect(page.getByTestId('note-editor')).toContainText('from fido', { timeout: 1000 })
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByTestId('note-editor')).not.toContainText('from rex')
  await expect(page.getByTestId('note-editor')).toContainText('from fido')
  await page.keyboard.press('Escape'); await other.keyboard.press('Escape')
  await waitForSync(page); await waitForSync(other)
  await page.reload()
  await expect(cardByText(page, 'from fido')).toBeVisible()
})

test('offline edits survive reload and merge with an online author', async ({ page, context, browser }) => {
  await freshBoard(page)
  await addNote(page, 'Offline baseline')
  await waitForSync(page)
  const other = await friend(browser, page)
  await context.setOffline(true)
  await cardByText(page, 'Offline baseline').dblclick(); await end(page); await page.keyboard.type(' offline addition'); await expect(page.getByTestId('note-editor')).toContainText('offline addition'); await page.keyboard.press('Escape')
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', /[1-9]/)
  // Reload with network restored but hold sync writes: recovery must come from IndexedDB.
  await page.route('**/api/sync', (route) => route.abort('internetdisconnected'))
  await context.setOffline(false)
  await page.reload()
  await expect(cardByText(page, 'offline addition')).toBeVisible()
  await cardByText(other, 'Offline baseline').dblclick(); await start(other); await other.keyboard.type('online addition '); await other.keyboard.press('Escape')
  await waitForSync(other)
  await page.unroute('**/api/sync')
  await page.getByTestId('sync-status').click(); await page.getByTestId('sync-now').click()
  await expect(cardByText(page, 'online addition')).toContainText('offline addition')
  await expect(cardByText(other, 'online addition')).toContainText('offline addition')
})

test('live drag previews clear on commit and committed changes arrive within one second', async ({ page, browser }) => {
  await freshBoard(page)
  const note = await addNote(page, 'Move together')
  await waitForSync(page)
  const other = await friend(browser, page)
  await live(page); await live(other)
  const box = (await note.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 140, box.y + 80, { steps: 8 })
  await expect(other.getByTestId('remote-preview')).toBeVisible()
  await page.mouse.up()
  await expect(other.getByTestId('remote-preview')).toHaveCount(0)
  await expect.poll(async () => Math.abs((await cardByText(other, 'Move together').boundingBox())!.x - (await note.boundingBox())!.x), { timeout: 1000 }).toBeLessThan(2)
})

test('viewers can follow and ping, while forged edit presence and writes are refused', async ({ page, browser }) => {
  await freshBoard(page)
  const board = page.url().split('/b/')[1]!
  expect((await postSync(page.request, { data: { changes: [{ id: board, patch: { parentId: null } }] } })).ok()).toBe(true)
  await addNote(page, 'Viewers are welcome')
  await waitForSync(page)
  const other = await friend(browser, page, 'view')
  await live(page); await live(other)
  await expect(other.getByTestId('board-permission')).toHaveText('View only')
  await expect(other.getByTestId('tool-note')).toHaveCount(0)
  await cardByText(other, 'Viewers are welcome').dblclick()
  await expect(other.getByTestId('note-editor')).toHaveCount(0)
  await other.getByTestId('collaborators').click()
  await other.getByRole('button', { name: 'Follow rex', exact: true }).click()
  await expect(other.getByRole('button', { name: 'Stop following' })).toBeVisible()
  await other.getByRole('button', { name: 'Stop following' }).click()
  await other.getByTestId('collaborators').click()
  await other.getByRole('button', { name: 'Look here', exact: true }).click()
  await expect(page.getByTestId('remote-ping')).toBeVisible()
  const note = await cardByText(other, 'Viewers are welcome').getAttribute('data-card-id')
  const response = await postSync(other.request, { data: { changes: [{ id: note, patch: { x: 99 } }] } })
  expect(response.status()).toBe(403)
  const ticket = await (await other.request.post(`/api/boards/${board}/live-ticket`, { data: {} })).json()
  const responseMembers = await other.evaluate(async ({ board, ticket, note }) => {
    const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/api/boards/${board}/live`)
    return await new Promise<{ userId: string; username: string; canEdit: boolean; editing: string | null; previews: unknown[] }[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No presence response')), 5000)
      let ready = false
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket }))
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.type === 'ready') {
          ready = true
          ws.send(JSON.stringify({ type: 'presence', userId: 'forged', username: 'forged', canEdit: true, pointer: { x: 0, y: 0 }, selection: [], editing: note, camera: { x: 0, y: 0, zoom: 1 }, width: 800, height: 600, previews: [{ id: note, x: 0, y: 0 }], caret: null }))
        }
        if (ready && data.type === 'members' && data.members.some((m: { pointer: unknown }) => m.pointer)) { clearTimeout(timer); resolve(data.members); ws.close() }
      }
    })
  }, { board, ticket: ticket.ticket, note })
  expect(responseMembers.some((m) => m.username === 'forged' || m.userId === 'forged')).toBe(false)
  expect(responseMembers.filter((m) => m.username === 'fido').every((m) => !m.canEdit && !m.editing && !m.previews.length)).toBe(true)
})

test('presence groups sessions and leaves the board after navigation or session revocation', async ({ page, browser }) => {
  await freshBoard(page)
  const other = await friend(browser, page)
  const extra = await other.context().newPage()
  await extra.goto(page.url()); await live(extra)
  await page.getByTestId('collaborators').click()
  await expect(page.getByTestId('participant')).toHaveCount(2)
  await expect(page.getByTestId('participant').filter({ hasText: 'fido' })).toContainText('multiple sessions')
  const access = await (await other.request.get('/api/access')).json()
  await extra.goto(`/#/b/${access.homeBoardId}`)
  await expect(page.getByTestId('participant').filter({ hasText: 'fido' })).not.toContainText('multiple sessions')
  await page.getByRole('button', { name: 'Follow fido', exact: true }).click()
  expect((await other.request.post('/api/auth/logout', { data: {} })).ok()).toBe(true)
  // A live notification forces session revalidation for all recipients.
  await page.getByTestId('collaborators').click(); await page.getByRole('button', { name: 'Look here', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop following' })).toHaveCount(0)
  await page.getByTestId('collaborators').click()
  await expect(page.getByTestId('participant')).toHaveCount(1)
})

test('concurrent unicode inserts and formatting converge without moving the other author’s caret', async ({ page, browser }) => {
  await freshBoard(page)
  await addNote(page, 'Top\nBottom'); await waitForSync(page)
  const other = await friend(browser, page)
  await live(page); await live(other)
  let release!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  const holdPush = async (route: import('@playwright/test').Route) => { if (route.request().method() === 'POST') await hold; await route.continue() }
  await page.route('**/api/sync', holdPush); await other.route('**/api/sync', holdPush)
  await cardByText(page, 'Top').dblclick(); await start(page)
  await page.keyboard.insertText('日本語 ')
  await cardByText(other, 'Bottom').dblclick(); await end(other)
  await other.keyboard.insertText(' café')
  release()
  await expect(page.getByTestId('note-editor')).toContainText('café')
  await expect(other.getByTestId('note-editor')).toContainText('日本語')
  await start(page)
  for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.getByTestId('fmt-bold').click()
  await focusEditor(other)
  await other.keyboard.insertText('!')
  await page.keyboard.press('Escape'); await other.keyboard.press('Escape')
  await waitForSync(page); await waitForSync(other)
  const { objects } = await pullAllObjects(page.request)
  const note = objects.find((o) => o.kind === 'card' && o.boardId === page.url().split('/b/')[1] && o.type === 'note')!
  expect(note.content.md).toContain('**日本語 Top**')
  expect(note.content.md).toContain('Bottom café!')
})

test('IME composition survives a remote edit before committing', async ({ page, context, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Real IME composition is driven through Chromium CDP')
  await freshBoard(page); await addNote(page, 'Compose'); await waitForSync(page)
  const other = await friend(browser, page)
  await live(page); await live(other)
  let release!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  await other.route('**/api/sync', async (route) => { if (route.request().method() === 'POST') await hold; await route.continue() })
  await cardByText(other, 'Compose').dblclick(); await start(other)
  const queued = other.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/sync')
  await other.keyboard.insertText('Friend ')
  await queued
  await cardByText(page, 'Compose').dblclick(); await end(page)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 })
  release()
  await waitForSync(other)
  await cdp.send('Input.insertText', { text: '日本語' })
  await expect(page.getByTestId('note-editor')).toContainText('Compose日本語')
  await expect(other.getByTestId('note-editor')).toContainText('Compose日本語')
  await page.keyboard.press('Escape'); await waitForSync(page)
  const { objects } = await pullAllObjects(page.request)
  expect(objects.find((o) => o.type === 'note' && o.boardId === page.url().split('/b/')[1])!.content.md).toBe('Friend Compose日本語')
})

test('HTTP sync keeps collaborative text working when the live room is unavailable', async ({ page, browser }) => {
  await page.route('**/api/boards/*/live-ticket', (route) => route.fulfill({ status: 503, json: { error: 'Live temporarily unavailable' } }))
  await freshBoard(page); await addNote(page, 'Fallback'); await waitForSync(page)
  const other = await friend(browser, page)
  await cardByText(page, 'Fallback').dblclick(); await end(page); await page.keyboard.insertText(' still saves'); await page.keyboard.press('Escape')
  await waitForSync(page)
  await expect(cardByText(other, 'Fallback still saves')).toBeVisible()
  await page.getByTestId('collaborators').click()
  await expect(page.getByTestId('live-status')).not.toHaveText('Live')
  await page.keyboard.press('Escape')
})

test('removing a note during typing closes its editor and retains the latest draft', async ({ page, browser }) => {
  await freshBoard(page); await addNote(page, 'Remove while editing'); await waitForSync(page)
  const other = await friend(browser, page)
  await live(page); await live(other)
  const noteId = (await cardByText(other, 'Remove while editing').getAttribute('data-card-id'))!
  await other.route('**/api/sync', (route) => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue())
  await cardByText(other, 'Remove while editing').dblclick(); await end(other); await other.keyboard.insertText(' saved as recovery')
  expect((await postSync(page.request, { data: { changes: [{ id: noteId, patch: { deletedAt: Date.now() } }] } })).ok()).toBe(true)
  await expect(other.getByTestId('note-editor')).toHaveCount(0)
  await expect(cardByText(other, 'Remove while editing')).toHaveCount(0)
  await other.getByTestId('sync-status').click()
  const download = other.waitForEvent('download')
  await other.getByTestId('download-recovery').click()
  const { readFile } = await import('node:fs/promises')
  expect(await readFile((await (await download).path())!, 'utf8')).toContain('saved as recovery')
})

test('competing drags and a resize converge, while cancellation and deletion clear previews', async ({ page, browser }) => {
  await freshBoard(page); const note = await addNote(page, 'Shared geometry'); await waitForSync(page)
  const id = (await note.getAttribute('data-card-id'))!, other = await friend(browser, page)
  await live(page); await live(other)
  const a = (await note.boundingBox())!, b = (await cardByText(other, 'Shared geometry').boundingBox())!
  await page.bringToFront()
  await page.mouse.move(a.x + 20, a.y + 12); await page.mouse.down(); await page.mouse.move(a.x + 100, a.y + 52, { steps: 6 })
  await expect(other.getByTestId('remote-preview')).toBeVisible()
  await other.bringToFront()
  await other.mouse.move(b.x + 20, b.y + 12); await other.mouse.down(); await other.mouse.move(b.x + 180, b.y + 82, { steps: 6 })
  await expect(page.getByTestId('remote-preview')).toBeVisible()
  await page.mouse.up(); await waitForSync(page); await other.mouse.up(); await waitForSync(other)
  await expect.poll(async () => Math.abs((await note.boundingBox())!.x - (await cardByText(other, 'Shared geometry').boundingBox())!.x)).toBeLessThan(2)
  await expect(page.getByTestId('remote-preview')).toHaveCount(0); await expect(other.getByTestId('remote-preview')).toHaveCount(0)
  await page.bringToFront()
  const h = (await page.getByTestId('resize-handle').boundingBox())!, width = (await note.boundingBox())!.width
  await page.mouse.move(h.x + 5, h.y + 5); await page.mouse.down(); await page.mouse.move(h.x + 95, h.y + 5, { steps: 6 })
  await expect(other.getByTestId('remote-preview')).toBeVisible(); await page.mouse.up()
  await expect.poll(async () => (await cardByText(other, 'Shared geometry').boundingBox())!.width, { timeout: 1000 }).toBeCloseTo(width + 90, 0)
  const before = (await note.boundingBox())!
  await page.mouse.move(before.x + 20, before.y + 12); await page.mouse.down(); await page.mouse.move(before.x + 150, before.y + 70, { steps: 6 })
  await expect(other.getByTestId('remote-preview')).toBeVisible(); await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(other.getByTestId('remote-preview')).toHaveCount(0)
  expect((await note.boundingBox())!.x).toBeCloseTo(before.x, 0)
  await page.mouse.move(before.x + 20, before.y + 12); await page.mouse.down(); await page.mouse.move(before.x + 130, before.y + 70, { steps: 6 })
  await expect(other.getByTestId('remote-preview')).toBeVisible()
  expect((await postSync(other.request, { data: { changes: [{ id, patch: { deletedAt: Date.now() } }] } })).ok()).toBe(true)
  await expect(other.getByTestId('remote-preview')).toHaveCount(0)
  await page.mouse.up(); await expect(note).toHaveCount(0)
})

test('keyboard ping restores focus and an off-screen ping is visible and announced without moving the camera', async ({ page, browser }) => {
  await freshBoard(page); await addNote(page, 'A named destination'); await waitForSync(page)
  const other = await friend(browser, page)
  await live(page); await live(other)
  const box = (await other.getByTestId('canvas').boundingBox())!
  await other.bringToFront()
  await other.mouse.move(box.x + 100, box.y + 100); await other.mouse.wheel(0, 3000)
  const before = await camera(page)
  await other.getByTestId('collaborators').click()
  await other.getByRole('button', { name: 'Look here', exact: true }).focus(); await other.keyboard.press('Enter')
  await expect(other.getByTestId('collaborators')).toBeFocused()
  const ping = page.getByTestId('remote-ping')
  await expect(ping).toHaveAttribute('data-offscreen', 'true')
  const p = (await ping.boundingBox())!, canvas = (await page.getByTestId('canvas').boundingBox())!
  expect(p.x).toBeGreaterThanOrEqual(canvas.x); expect(p.y + p.height).toBeLessThanOrEqual(canvas.y + canvas.height)
  await expect(page.getByRole('log')).toContainText('fido pointed to a location on this board')
  expect(await camera(page)).toEqual(before)
  await page.getByTestId('collaborators').click(); await page.getByRole('button', { name: 'Follow fido', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(page.getByTestId('collaborators')).toBeFocused()
  await page.getByRole('button', { name: 'Stop following' }).focus(); await page.keyboard.press('Enter')
  await expect(page.getByTestId('collaborators')).toBeFocused()
})

test('an older queued note replacement becomes a recovery draft instead of overwriting collaborative text', async ({ page }) => {
  await freshBoard(page); const note = await addNote(page, 'Canonical shared text'); await waitForSync(page)
  const id = (await note.getAttribute('data-card-id'))!
  // Fixture represents protocol-2 IndexedDB after an app upgrade.
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('doggynote'); r.onsuccess = () => resolve(r.result) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite'); tx.objectStore('outbox').put({ content: { md: 'Older unsent replacement' } }, id)
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    }); db.close()
  }, id)
  await page.reload(); await expect(cardByText(page, 'Canonical shared text')).toBeVisible()
  await page.getByTestId('sync-status').click()
  const downloaded = page.waitForEvent('download'); await page.getByTestId('download-recovery').click()
  const { readFile } = await import('node:fs/promises')
  expect(await readFile((await (await downloaded).path())!, 'utf8')).toContain('Older unsent replacement')
  const { objects } = await pullAllObjects(page.request)
  expect(objects.find((o) => o.id === id)!.content.md).toBe('Canonical shared text')
})

test('room access revocation, hostile origins and private Inbox moves do not leak presence or note state', async ({ page, browser }) => {
  await freshBoard(page); const board = page.url().split('/b/')[1]!
  expect((await postSync(page.request, { data: { changes: [{ id: board, patch: { parentId: null } }] } })).ok()).toBe(true)
  const note = await addNote(page, 'Keep private moves private'); await waitForSync(page)
  const id = (await note.getAttribute('data-card-id'))!, other = await friend(browser, page)
  await live(page); await live(other)
  const { user } = await (await other.request.get('/api/me')).json(), inbox = `toybox:${user.id}`
  expect((await page.request.post(`/api/boards/${encodeURIComponent(inbox)}/live-ticket`, { data: {} })).status()).toBe(403)
  expect((await page.request.get(`/api/boards/${board}/live`, { headers: { origin: 'https://hostile.invalid', upgrade: 'websocket' } })).status()).toBe(403)
  await cardByText(other, 'Keep private moves private').click()
  await expect(page.getByTestId('remote-selection')).toBeVisible()
  expect((await postSync(other.request, { data: { changes: [{ id, patch: { boardId: inbox } }] } })).ok()).toBe(true)
  await expect(note).toHaveCount(0); await expect(page.getByTestId('remote-selection')).toHaveCount(0)
  const pull = await pullAllObjects(page.request)
  expect(pull.objects.find((o) => o.id === id)?.content).toBeUndefined()
  const list = await (await page.request.get(`/api/shares?boardId=${board}`)).json()
  expect((await page.request.delete(`/api/boards/${board}/members/${list.members.find((m: { username: string }) => m.username === 'fido').id}`)).ok()).toBe(true)
  // A fresh authorized room event revalidates every subscriber before sending.
  await page.getByTestId('collaborators').click(); await page.getByRole('button', { name: 'Look here', exact: true }).click()
  await page.getByTestId('collaborators').click(); await expect(page.getByTestId('participant')).toHaveCount(1)
  expect((await other.request.post(`/api/boards/${board}/live-ticket`, { data: {} })).status()).toBe(403)
})

test('redo restores a created note after its undo was durably acknowledged', async ({ page }) => {
  await freshBoard(page); const note = await addNote(page, 'A durable redo'); const id = (await note.getAttribute('data-card-id'))!; await waitForSync(page)
  await page.getByTestId('undo').click(); await expect(cardByText(page, 'A durable redo')).toHaveCount(0); await waitForSync(page)
  await page.getByTestId('redo').click(); await expect(cardByText(page, 'A durable redo')).toBeVisible(); await waitForSync(page)
  const { objects } = await pullAllObjects(page.request)
  expect(objects.find((o) => o.id === id)!.purged).toBe(false)
  await page.reload(); await expect(cardByText(page, 'A durable redo')).toBeVisible()
})

test('concurrent deletion and insertion merge, and undo restores only the deleting author’s text', async ({ page, browser }) => {
  await freshBoard(page); await addNote(page, 'Remove this\nKeep that'); await waitForSync(page)
  const other = await friend(browser, page); await live(page); await live(other)
  let release!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  const holdPush = async (route: import('@playwright/test').Route) => { if (route.request().method() === 'POST') await hold; await route.continue() }
  await page.route('**/api/sync', holdPush); await other.route('**/api/sync', holdPush)
  await cardByText(page, 'Remove this').dblclick(); await start(page)
  for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Backspace')
  await cardByText(other, 'Keep that').dblclick(); await end(other); await other.keyboard.insertText(' and peer')
  release()
  await expect(page.getByTestId('note-editor')).toContainText('Keep that and peer')
  await expect(other.getByTestId('note-editor')).not.toContainText('Remove ')
  await focusEditor(page); await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press('Escape'); await other.keyboard.press('Escape'); await waitForSync(page)
  await expect(cardByText(other, 'Remove this')).toContainText('Keep that and peer')
})

test('reload retains the newest text even while an earlier local transaction is busy', async ({ page }) => {
  await freshBoard(page); await addNote(page, 'Busy local save'); await waitForSync(page)
  await page.route('**/api/sync', (route) => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue())
  await cardByText(page, 'Busy local save').dblclick(); await end(page)
  // Hold a real IDB transaction ahead of the text saves. New transactions must
  // already be queued in the database before this document is navigated away.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('doggynote'); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction(['objects', 'outbox'], 'readwrite'), until = Date.now() + 2000
    const pump = () => { const r = tx.objectStore('objects').get('save-blocker'); r.onsuccess = () => { if (Date.now() < until) pump() } }
    pump(); tx.oncomplete = () => db.close()
  })
  await page.keyboard.insertText(' first'); await page.keyboard.insertText(' newest')
  await expect(page.getByTestId('note-editor')).toContainText('Busy local save first newest')
  await page.reload()
  await expect(cardByText(page, 'Busy local save first newest')).toBeVisible()
  await page.unroute('**/api/sync'); await page.getByTestId('sync-status').click(); await page.getByTestId('sync-now').click(); await waitForSync(page)
  await page.reload(); await expect(cardByText(page, 'Busy local save first newest')).toBeVisible()
})

test('an inactive offline draft is retained when another editor moves its note into a private Inbox', async ({ page, context, browser }) => {
  await freshBoard(page); const note = await addNote(page, 'Moving draft'); await waitForSync(page)
  const id = (await note.getAttribute('data-card-id'))!, other = await friend(browser, page)
  await context.setOffline(true)
  await cardByText(page, 'Moving draft').dblclick(); await end(page); await page.keyboard.insertText(' unsent private-move recovery'); await page.keyboard.press('Escape')
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', /[1-9]/)
  const { user } = await (await other.request.get('/api/me')).json()
  expect((await postSync(other.request, { data: { changes: [{ id, patch: { boardId: `toybox:${user.id}` } }] } })).ok()).toBe(true)
  await context.setOffline(false); await expect(note).toHaveCount(0)
  await page.getByTestId('sync-status').click()
  const downloaded = page.waitForEvent('download'); await page.getByTestId('download-recovery').click()
  const { readFile } = await import('node:fs/promises')
  expect(await readFile((await (await downloaded).path())!, 'utf8')).toContain('unsent private-move recovery')
})

test('right-clicking the canvas opens a compact Look here menu at the pointer', async ({ page }) => {
  await freshBoard(page)
  // The menu only offers Look here once the board's live room is connected.
  await live(page)
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  const at = { x: canvas.x + canvas.width / 3, y: canvas.y + canvas.height / 3 }
  await page.mouse.click(at.x, at.y, { button: 'right' })
  const menu = page.locator('.canvas-ping-menu')
  await expect(menu.getByRole('button', { name: 'Look here', exact: true })).toBeFocused()
  const box = (await menu.boundingBox())!
  expect(Math.abs(box.x - at.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y - at.y)).toBeLessThanOrEqual(1)
  expect(box.width).toBeLessThan(200)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})
