import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshBoard, cardByText, addNote, MOD, waitForSync, postSync, pullAllObjects, setAccountAppearance } from './helpers.ts'
const appRoot = fileURLToPath(new URL('../../../', import.meta.url))
async function openProposals(page: Page) {
  await page.getByTestId('board-more').click()
  await page.getByTestId('agent-proposals').click()
}
async function capture(page: Page, info: TestInfo, name: string) {
  const bytes = await page.screenshot({ path: info.outputPath(name), fullPage: true })
  const directory = join(tmpdir(), 'doggynote-mcp-qa')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${info.project.name}-${name}`), bytes)
}

test('a real stdio MCP client stages a board layout, a person previews/approves it, and reverses it safely', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await freshBoard(page, 'MCP review board')
  await page.getByTestId('sync-status').click()
  await waitForSync(page)
  const boardId = new URL(page.url()).hash.split('/').at(-1)!
  const response = await page.request.post('/api/agent-connections', { data: { name: 'Real MCP client', mode: 'propose', boardIds: [boardId], expiresInDays: 90 } })
  expect(response.status()).toBe(201)
  const { token, id: connectionId } = await response.json()
  const result = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', `${appRoot}/apps/mcp/src/client-smoke.ts`], { cwd: appRoot, env: { ...process.env, DOGGYNOTE_URL: new URL(page.url()).origin, DOGGYNOTE_TOKEN: token, DOGGYNOTE_SMOKE_BOARD: boardId }, timeout: 20_000, encoding: 'utf8' })) as { proposalId: string; label: string; noteId: string }
  const built = 'A note built through the MCP client'
  await expect(cardByText(page, built)).toHaveCount(0)
  await openProposals(page)
  await page.getByTestId('agent-review').getByRole('button', { name: new RegExp(result.label) }).click()
  await expect(page.getByTestId('agent-change-list')).toContainText(built.slice(0, 20))
  await page.getByTestId('preview-on-board').click()
  // The proposal on the real board, drawn by the real cards, each marked.
  const banner = page.getByTestId('proposal-banner')
  await expect(banner).toContainText(result.label)
  const note = page.locator('[data-testid="canvas"] [data-type=note]', { hasText: built })
  await expect(note).toHaveAttribute('data-preview', 'added')
  await expect(note.getByTestId('preview-chip')).toHaveText('New')
  await expect(note.locator('.rich p').first()).toBeVisible()
  await expect(page.locator('[data-type=todo][data-preview=added]', { hasText: 'Review checklist' }).locator('.todo-check')).not.toHaveCount(0)
  await expect(page.locator('[data-type=column][data-preview=added]')).toHaveCount(1)
  // Read-only while previewing: no tools, and nothing is saved or queued.
  await expect(page.getByTestId('tool-note')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+z`)
  await expect(note).toBeVisible()
  // On this board only: the same test in another browser may have approved its own copy.
  const board = new URL(page.url()).hash.split('/').at(-1)
  const stored = await page.evaluate(([text, board]) => new Promise<string>((resolve) => {
    const request = indexedDB.open('doggynote')
    request.onsuccess = () => { const q = request.result.transaction('objects', 'readonly').objectStore('objects').getAll(); q.onsuccess = () => resolve(JSON.stringify(q.result.find((o) => o.boardId === board && !o.deletedAt && !o.purged && o.content?.md?.includes(text)) ?? null)) }
  }), [built, board] as const)
  expect(stored).toBe('null')
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', '0')
  await capture(page, testInfo, 'proposal-dark.png')
  // Current shows the board as it is; Proposed brings the proposal back.
  await page.getByTestId('proposal-show-before').click()
  await expect(note).toHaveCount(0)
  await expect(page.locator('[data-preview]')).toHaveCount(0)
  await page.getByTestId('proposal-show-after').click()
  await expect(note).toBeVisible()
  // Next change says where it is and marks the card it lands on.
  await page.getByTestId('proposal-next').click()
  await expect(page.getByTestId('proposal-step')).toHaveText(/^1 of \d+$/)
  await expect(page.locator('[data-preview-current]')).toHaveCount(1)
  // It wears a tinted band in both themes (the light theme's card shadow once replaced it).
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
    await expect(page.locator('[data-preview-current]')).toHaveCSS('box-shadow', /0px 0px 0px 5px/)
  }
  // Escape leaves the preview, and the live board is untouched.
  await page.keyboard.press('Escape')
  await expect(banner).toHaveCount(0)
  await expect(cardByText(page, built)).toHaveCount(0)
  await expect(page.getByTestId('tool-note')).toBeVisible()
  // Phone-ish width, light: the banner fits.
  await setAccountAppearance(page, 'Light')
  await page.setViewportSize({ width: 600, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openProposals(page)
  // A lone proposal opens already selected (its list row is hidden on narrow screens).
  await expect(page.getByTestId('agent-review').getByRole('heading', { name: result.label })).toBeVisible()
  await page.getByTestId('preview-on-board').click()
  const bounds = (await banner.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(600)
  await capture(page, testInfo, 'proposal-light-narrow.png')
  // Approve from the banner: the cards land on the live board, unmarked.
  await page.getByTestId('proposal-approve').click()
  await expect(banner).toHaveCount(0)
  await expect(cardByText(page, built)).toBeVisible()
  await expect(cardByText(page, built)).not.toHaveAttribute('data-preview', /.+/)
  await openProposals(page)
  // A lone proposal opens already selected (its list row is hidden on narrow screens).
  await expect(page.getByTestId('agent-review').getByRole('heading', { name: result.label })).toBeVisible()
  await expect(page.getByTestId('reverse-agent-proposal')).toBeVisible()
  await page.getByTestId('reverse-agent-proposal').click()
  await expect(page.getByTestId('agent-review')).toContainText('reversed')
  await expect(cardByText(page, 'A note built through the MCP client')).toHaveCount(0)
  await page.getByTestId('agent-review').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByTestId('account').click()
  await page.getByTestId('manage-agents').click()
  await expect(page.getByTestId('agent-connections')).toContainText('Real MCP client')
  await capture(page, testInfo, 'connections.png')
  await page.request.delete(`/api/agent-connections/${connectionId}`)
  expect((await page.request.get('/api/agent/boards', { headers: { authorization: `Bearer ${token}` } })).status()).toBe(401)
})

test('agent scope, read-only mode, session isolation, stale approval and newer-edit reversal conflicts are enforced', async ({ page }) => {
  await freshBoard(page, 'MCP conflict board')
  await addNote(page, 'Human original')
  await page.getByTestId('sync-status').click()
  await waitForSync(page)
  const boardId = new URL(page.url()).hash.split('/').at(-1)!
  const connection = await page.request.post('/api/agent-connections', { data: { name: 'Scoped agent', mode: 'propose', boardIds: [boardId] } })
  expect(connection.status()).toBe(201)
  const { token } = await connection.json(), headers = { authorization: `Bearer ${token}` }
  expect((await page.request.get('/api/agent/boards/home', { headers })).status()).toBe(404)
  expect((await page.request.post('/api/sync', { headers, data: { changes: [] } })).status()).toBe(401)
  const read = await (await page.request.get(`/api/agent/boards/${boardId}`, { headers })).json()
  const row = read.objects.find((r: { object: { type?: string } }) => r.object.type === 'note')
  const proposed = { ...row.object, content: { md: 'Agent replacement' } }
  const request = { idempotencyKey: `conflict-${crypto.randomUUID()}`, label: 'Replace the note', operations: [{ action: 'replace', object: proposed, expectedRevision: row.revision }] }
  const staged = await page.request.post('/api/agent/proposals', { headers, data: request })
  expect(staged.status(), await staged.text()).toBe(201)
  const { id } = await staged.json()
  expect((await page.request.post(`/api/agent-proposals/${id}/approve`, { headers, data: {} })).status()).toBe(401)
  const note = cardByText(page, 'Human original')
  await note.click(); await expect(page.getByTestId('note-editor')).toBeVisible(); await page.keyboard.press(`${MOD}+a`); await page.keyboard.type('New human edit'); await page.keyboard.press('Escape')
  await page.getByTestId('sync-status').click()
  await expect.poll(async () => (await (await page.request.get(`/api/agent/boards/${boardId}`, { headers })).json()).objects.find((r: { object: { id: string } }) => r.object.id === row.object.id).object.content.md).toBe('New human edit')
  expect((await page.request.post(`/api/agent-proposals/${id}/approve`, { data: {} })).status()).toBe(409)
  await expect(cardByText(page, 'New human edit')).toBeVisible()
  await waitForSync(page)
  const latestRead = await (await page.request.get(`/api/agent/boards/${boardId}`, { headers })).json()
  const latest = latestRead.objects.find((r: { object: { id: string } }) => r.object.id === row.object.id)
  const approved = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `approved-${crypto.randomUUID()}`, label: 'Approved then revised', operations: [{ action: 'replace', object: { ...latest.object, content: { md: 'Approved agent edit' } }, expectedRevision: latest.revision }] } })
  expect(approved.status()).toBe(201)
  const approvedId = (await approved.json()).id
  expect((await page.request.post(`/api/agent-proposals/${approvedId}/approve`, { data: {} })).status()).toBe(200)
  await page.getByTestId('sync-status').click(); await waitForSync(page)
  await expect(cardByText(page, 'Approved agent edit')).toBeVisible()
  await cardByText(page, 'Approved agent edit').click(); await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.press(`${MOD}+a`); await page.keyboard.type('New edit after approval'); await page.keyboard.press('Escape')
  await page.getByTestId('sync-status').click(); await waitForSync(page)
  expect((await page.request.post(`/api/agent-proposals/${approvedId}/reverse`, { data: {} })).status()).toBe(409)
  await expect(cardByText(page, 'New edit after approval')).toBeVisible()
  const reader = await (await page.request.post('/api/agent-connections', { data: { name: 'Reader', mode: 'read', boardIds: [boardId] } })).json()
  expect((await page.request.post('/api/agent/proposals', { headers: { authorization: `Bearer ${reader.token}` }, data: request })).status()).toBe(403)
  expect((await page.request.post(`/api/agent-proposals/${id}/reject`, { data: {} })).status()).toBe(200)
})

test('failed agent lists and proposal previews keep the board usable and can be retried', async ({ page }) => {
  await freshBoard(page, 'Agent network errors')
  await waitForSync(page)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/agent-proposals?*', (route) => route.abort('failed'))
  await openProposals(page)
  await expect(page.getByTestId('agent-review')).toContainText('Could not refresh the list.')
  await page.getByTestId('agent-review').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.unroute('**/api/agent-proposals?*')

  await page.route('**/api/agent-connections', (route) => route.request().method() === 'GET' ? route.abort('failed') : route.continue())
  await page.getByTestId('account').click(); await page.getByTestId('manage-agents').click()
  await expect(page.getByTestId('agent-connections')).toContainText('Could not load connections.')
  await page.unroute('**/api/agent-connections')
  await page.getByTestId('agent-connections').getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByTestId('agent-connections').getByText('Could not load connections.', { exact: false })).toHaveCount(0)
  await page.getByTestId('agent-connections').getByRole('button', { name: 'Close', exact: true }).click()

  const boardId = new URL(page.url()).hash.split('/').at(-1)!
  const connection = await (await page.request.post('/api/agent-connections', { data: { name: 'Retry preview', mode: 'propose', boardIds: [boardId] } })).json()
  const staged = await (await page.request.post('/api/agent/proposals', { headers: { authorization: `Bearer ${connection.token}` }, data: { idempotencyKey: `retry-${crypto.randomUUID()}`, label: 'Retry this preview', operations: [{ action: 'create', object: { id: crypto.randomUUID(), kind: 'card', type: 'note', boardId, x: 40, y: 40, w: 260, h: 80, z: 1, color: 'none', content: { md: 'Retry succeeds' }, createdAt: Date.now() } }] } })).json()
  const path = `**/api/agent-proposals/${staged.id}`
  await page.route(path, (route) => route.abort('failed'))
  await openProposals(page)
  await page.getByTestId('agent-review').getByRole('button', { name: /Retry this preview/ }).click()
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await page.unroute(path)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByTestId('agent-change-list')).toContainText('Retry succeeds')
  await page.getByTestId('agent-review').getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(page.getByTestId('agent-review')).toContainText('rejected')
  expect(errors).toEqual([])
})

test('image and file proposals reuse scoped assets and cannot borrow assets from another private root', async ({ page }) => {
  await freshBoard(page, 'MCP scoped assets')
  await waitForSync(page)
  const boardId = new URL(page.url()).hash.split('/').at(-1)!, imageId = crypto.randomUUID(), fileId = crypto.randomUUID(), outsideId = crypto.randomUUID(), outsideAsset = crypto.randomUUID()
  const png = Buffer.from(await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(16, 16), context = canvas.getContext('2d')!
    context.fillStyle = 'rgb(60 154 95)'; context.fillRect(0, 0, 16, 16)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    return btoa(String.fromCharCode(...bytes))
  }), 'base64')
  for (const size of ['thumb', 'small', 'medium', 'full']) expect((await page.request.put(`/api/assets/${imageId}/${size}`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  for (const id of [fileId, outsideAsset]) expect((await page.request.put(`/api/files/${id}?name=reference.txt`, { data: Buffer.from('An existing reference file'), headers: { 'content-type': 'text/plain' } })).ok()).toBe(true)
  const common = { kind: 'card', boardId, x: 40, y: 40, w: 260, h: 100, z: 1, color: 'none', createdAt: Date.now() }
  const image = { ...common, id: crypto.randomUUID(), type: 'image', content: { assetId: imageId, width: 16, height: 16, sizes: ['thumb', 'small', 'medium', 'full'] } }
  const file = { ...common, id: crypto.randomUUID(), type: 'file', y: 200, content: { assetId: fileId, name: 'reference.txt', size: 26, mime: 'text/plain', status: 'ok' } }
  const outside = { ...file, id: crypto.randomUUID(), boardId: outsideId, content: { ...file.content, assetId: outsideAsset } }
  expect((await postSync(page.request, { data: { changes: [
    { id: outsideId, patch: { id: outsideId, kind: 'board', parentId: null, title: 'Outside agent scope', icon: 'paw', color: 'gold', createdAt: Date.now() } },
    // Emptying trash clears image content. An unrelated cleared row must not
    // crash the asset-reference scan before it reaches this proposal's image.
    { id: 'cleared-image-' + boardId, patch: { ...image, id: 'cleared-image-' + boardId, content: null, purged: true } },
    ...[image, file, outside].map((object) => ({ id: object.id, patch: object })),
  ] } })).ok()).toBe(true)
  // Render and sync fixture card measurements before capturing the proposal's
  // revision. A later layout write must not invalidate this authorization test.
  await page.reload()
  await expect.poll(() => page.getByTestId('card-image').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(16)
  const measured = await page.getByTestId('card').evaluateAll((els) => els.map((el) => ({ id: (el as HTMLElement).dataset.cardId!, h: (el as HTMLElement).offsetHeight })))
  expect(measured).toHaveLength(2)
  // Height writes are debounced in layout.ts, so idle sync alone can precede
  // them. Wait until those actual measurements have reached the server.
  await expect.poll(async () => {
    const { objects } = await pullAllObjects(page.request)
    return measured.every(({ id, h }) => Math.abs((objects.find((o) => o.id === id)?.h ?? 0) - h) <= 1)
  }).toBe(true)
  await waitForSync(page)
  const connection = await (await page.request.post('/api/agent-connections', { data: { name: 'Scoped assets', mode: 'propose', boardIds: [boardId] } })).json()
  const headers = { authorization: `Bearer ${connection.token}` }
  const staged = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `assets-${crypto.randomUUID()}`, label: 'Reuse authorized assets', operations: [image, file].map((object, index) => ({ action: 'create', object: { ...object, id: crypto.randomUUID(), x: 360, y: 40 + index * 180 } })) } })
  expect(staged.status(), await staged.text()).toBe(201)
  const proposalId = (await staged.json()).id
  await openProposals(page)
  await page.getByTestId('agent-review').getByRole('button', { name: /Reuse authorized assets/ }).click()
  await page.getByTestId('preview-on-board').click()
  // The real image and file cards draw the proposed assets.
  await expect(page.locator('[data-type=file][data-preview=added]')).toContainText('reference.txt')
  await expect.poll(() => page.locator('[data-type=image][data-preview=added] img').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(16)
  await page.getByTestId('proposal-exit').click()
  const approved = await page.request.post(`/api/agent-proposals/${proposalId}/approve`, { data: {} })
  expect(approved.status(), await approved.text()).toBe(200)
  const forbidden = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `outside-${crypto.randomUUID()}`, label: 'Forbidden outside asset', operations: [{ action: 'create', object: { ...file, id: crypto.randomUUID(), content: { ...file.content, assetId: outsideAsset } } }] } })
  expect(forbidden.status()).toBe(409)
  expect((await forbidden.json()).error).toContain('asset already visible')
})

test('a preview spans boards, keeps remote edits underneath, flags a stale proposal, and a failed poll keeps Review changes', async ({ page }) => {
  await freshBoard(page, 'Preview home')
  const home = new URL(page.url()).hash.split('/').at(-1)!
  const other = crypto.randomUUID(), here = crypto.randomUUID(), there = crypto.randomUUID()
  const card = (id: string, boardId: string, md: string, x = 40) => ({ id, kind: 'card', type: 'note', boardId, x, y: 40, w: 240, h: 60, z: 1, color: 'none', content: { md }, createdAt: Date.now() })
  expect((await postSync(page.request, { data: { changes: [
    { id: other, patch: { id: other, kind: 'board', parentId: home, title: 'Second board', icon: 'bone', color: 'sky', createdAt: Date.now() } },
    { id: here, patch: card(here, home, 'Keep me') },
    { id: there, patch: card(there, other, 'Over there') },
  ] } })).ok()).toBe(true)
  await page.reload()
  await waitForSync(page)
  const { token } = await (await page.request.post('/api/agent-connections', { data: { name: 'Two boards', mode: 'propose', boardIds: [home, other] } })).json()
  const headers = { authorization: `Bearer ${token}` }
  const read = await (await page.request.get(`/api/agent/boards/${other}`, { headers })).json()
  const row = read.objects.find((r: { object: { id: string } }) => r.object.id === there)
  expect((await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `two-${crypto.randomUUID()}`, label: 'Across two boards', operations: [
    { action: 'create', object: card(crypto.randomUUID(), home, 'New on the first board', 340) },
    { action: 'replace', expectedRevision: row.revision, object: { ...row.object, content: { md: 'Edited over there' } } },
  ] } })).status()).toBe(201)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  // One pending proposal: Review changes goes straight to the board.
  await page.getByTestId('review-changes').click()
  const banner = page.getByTestId('proposal-banner')
  await expect(banner).toBeVisible()
  await expect(page.locator('[data-preview=added]', { hasText: 'New on the first board' })).toBeVisible()
  const boards = page.getByTestId('proposal-board')
  await expect(boards.locator('option')).toHaveCount(2)
  await boards.selectOption(other)
  await expect(page.locator('[data-preview=changed]', { hasText: 'Edited over there' })).toBeVisible()
  // Someone edits the card while you look: it lands underneath, and the proposal is now stale.
  expect((await postSync(page.request, { data: { changes: [{ id: there, patch: { content: { md: 'Someone else got here first' } } }] } })).ok()).toBe(true)
  await page.getByTestId('sync-status').click()
  await waitForSync(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-preview=changed]', { hasText: 'Edited over there' })).toBeVisible()
  await page.getByTestId('proposal-exit').click()
  await expect(banner).toHaveCount(0)
  await expect(page.getByTestId('board-name')).toHaveText('Preview home')
  // A failed poll keeps the button where it was.
  await expect(page.getByTestId('review-changes')).toBeVisible()
  await page.route('**/api/agent-proposals?*', (route) => route.abort('failed'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(500)
  await expect(page.getByTestId('review-changes')).toBeVisible()
  await page.unroute('**/api/agent-proposals?*')
  await page.getByTestId('review-changes').click()
  await expect(banner).toContainText('edited after the agent read them')
  await page.getByTestId('proposal-approve').click()
  await expect(banner.getByRole('alert')).toBeVisible()
  await expect(banner).toBeVisible()
  await page.getByTestId('proposal-reject').click()
  await expect(banner).toHaveCount(0)
})

test('a card re-measured since the agent read it can still be approved, keeping its new height', async ({ page }) => {
  await freshBoard(page, 'Re-measured')
  await waitForSync(page)
  const boardId = new URL(page.url()).hash.split('/').at(-1)!
  const id = crypto.randomUUID()
  const note = { id, kind: 'card', type: 'note', boardId, x: 0, y: 0, w: 240, h: 60, z: 1, color: 'none', content: { md: 'Walk at noon' }, createdAt: Date.now() }
  expect((await postSync(page.request, { data: { changes: [{ id, patch: note }] } })).ok()).toBe(true)
  const { token } = await (await page.request.post('/api/agent-connections', { data: { name: 'Mover', mode: 'propose', boardIds: [boardId] } })).json()
  const headers = { authorization: `Bearer ${token}` }
  const read = await (await page.request.get(`/api/agent/boards/${boardId}`, { headers })).json()
  const row = read.objects.find((o: { object: { id: string } }) => o.object.id === id)
  const staged = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `move-${crypto.randomUUID()}`, label: 'Move it', operations: [{ action: 'replace', expectedRevision: row.revision, object: { ...row.object, x: 400 } }] } })
  expect(staged.status(), await staged.text()).toBe(201)
  // Another device measures the card: only its height changes.
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { h: 74 } }] } })).ok()).toBe(true)
  const approved = await page.request.post(`/api/agent-proposals/${(await staged.json()).id}/approve`, { data: {} })
  expect(approved.status(), await approved.text()).toBe(200)
  const { objects } = await pullAllObjects(page.request)
  expect(objects.find((o: { id: string }) => o.id === id)).toMatchObject({ x: 400, h: 74 })
})
