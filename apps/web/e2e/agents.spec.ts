import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshBoard, cardByText, addNote, MOD, waitForSync, postSync } from './helpers.ts'
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
  await expect(cardByText(page, 'A note built through the MCP client')).toHaveCount(0)
  await openProposals(page)
  await page.getByTestId('agent-review').getByRole('button', { name: new RegExp(result.label) }).click()
  await expect(page.getByTestId('agent-board-preview')).toContainText('A note built through the MCP client')
  expect(await page.getByTestId('agent-board-preview').locator('.rich p').first().evaluate((paragraph) => getComputedStyle(paragraph).color === getComputedStyle(paragraph.closest('.agents-preview-card')!).color)).toBe(true)
  const columnHeading = await page.locator('.agents-preview-column > .agents-preview-text').boundingBox()
  const todoPreview = await page.locator('.agents-preview-card').filter({ hasText: 'Review checklist' }).boundingBox()
  expect(todoPreview!.y).toBeGreaterThanOrEqual(columnHeading!.y + columnHeading!.height)
  await capture(page, testInfo, 'proposal-dark.png')
  await page.getByTestId('agent-review').getByRole('button', { name: 'Current board', exact: true }).click()
  await expect(page.getByTestId('agent-board-preview')).not.toContainText('A note built through the MCP client')
  await page.getByTestId('agent-review').getByRole('button', { name: 'Proposed board', exact: true }).click()
  await page.getByTestId('agent-review').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByTestId('account').click()
  await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('radio', { name: 'Light', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 600, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openProposals(page)
  await page.getByTestId('agent-review').getByRole('button', { name: new RegExp(result.label) }).click()
  await expect(page.getByTestId('agent-board-preview')).toContainText('A note built through the MCP client')
  await expect.poll(() => page.getByTestId('agent-board-preview').evaluate((el) => {
    const edge = el.getBoundingClientRect().right
    return [...el.querySelectorAll('.agents-preview-card')].every((card) => card.getBoundingClientRect().right <= edge + 1)
  })).toBe(true)
  await capture(page, testInfo, 'proposal-light-narrow.png')
  const reviewBounds = (await page.getByTestId('agent-review').boundingBox())!
  expect(reviewBounds.x).toBeGreaterThanOrEqual(0)
  expect(reviewBounds.x + reviewBounds.width).toBeLessThanOrEqual(600)
  // A preview does not install the proposal as the live document.
  await expect(page.locator('[data-testid="canvas"] [data-testid="card"]').filter({ hasText: 'A note built through the MCP client' })).toHaveCount(0)
  await page.getByTestId('approve-agent-proposal').click()
  await expect(page.getByTestId('reverse-agent-proposal')).toBeVisible()
  await expect(cardByText(page, 'A note built through the MCP client')).toBeVisible()
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
  expect(staged.status()).toBe(201)
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
  await expect(page.getByTestId('agent-review')).toContainText('Could not load proposals.')
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
  await expect(page.getByRole('button', { name: 'Retry preview', exact: true })).toBeVisible()
  await page.unroute(path)
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await expect(page.getByTestId('agent-board-preview')).toContainText('Retry succeeds')
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
    ...[image, file, outside].map((object) => ({ id: object.id, patch: object })),
  ] } })).ok()).toBe(true)
  const connection = await (await page.request.post('/api/agent-connections', { data: { name: 'Scoped assets', mode: 'propose', boardIds: [boardId] } })).json()
  const headers = { authorization: `Bearer ${connection.token}` }
  const staged = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `assets-${crypto.randomUUID()}`, label: 'Reuse authorized assets', operations: [image, file].map((object, index) => ({ action: 'create', object: { ...object, id: crypto.randomUUID(), x: 360, y: 40 + index * 180 } })) } })
  expect(staged.status()).toBe(201)
  const proposalId = (await staged.json()).id
  await openProposals(page)
  await page.getByTestId('agent-review').getByRole('button', { name: /Reuse authorized assets/ }).click()
  const preview = page.getByTestId('agent-board-preview')
  await expect(preview).toContainText('reference.txt')
  await expect.poll(() => preview.getByAltText('Proposed image').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(16)
  expect((await page.request.post(`/api/agent-proposals/${proposalId}/approve`, { data: {} })).status()).toBe(200)
  const forbidden = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `outside-${crypto.randomUUID()}`, label: 'Forbidden outside asset', operations: [{ action: 'create', object: { ...file, id: crypto.randomUUID(), content: { ...file.content, assetId: outsideAsset } } }] } })
  expect(forbidden.status()).toBe(409)
  expect((await forbidden.json()).error).toContain('asset already visible')
})
