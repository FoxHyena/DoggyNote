import { pullAllObjects } from './helpers.ts'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { MOD, cardByText, postSync } from './helpers.ts'

async function account(admin: Page, browser: Browser) {
  const username = `live_${crypto.randomUUID().slice(0, 8)}`
  expect((await admin.request.post('/api/users', { data: { username, password: 'liveaccess123' } })).ok()).toBe(true)
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '2' } })
  expect((await context.request.post('/api/auth/login', { data: { username, password: 'liveaccess123' } })).ok()).toBe(true)
  const access = await (await context.request.get('/api/access')).json()
  return { username, context, home: access.homeBoardId as string }
}

test('access revoked during typing preserves the latest text and leaves other boards usable', async ({ page, browser }) => {
  const owner = await account(page, browser), recipient = await account(page, browser)
  try {
    const boardId = crypto.randomUUID(), noteId = crypto.randomUUID()
    const created = await postSync(owner.context.request, { data: { changes: [
      { id: boardId, patch: { id: boardId, kind: 'board', parentId: owner.home, title: 'Live access review', icon: 'paw', color: 'gold', createdAt: Date.now() } },
      { id: noteId, patch: { id: noteId, kind: 'card', type: 'note', boardId, x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', content: { md: 'Before revocation' }, createdAt: Date.now() } },
    ] } })
    expect(created.ok(), await created.text()).toBe(true)
    expect((await owner.context.request.post(`/api/boards/${boardId}/members`, { data: { username: recipient.username, permission: 'edit', includeChildren: true } })).ok()).toBe(true)
    const member = await recipient.context.newPage()
    await member.goto(`/#/b/${boardId}`)
    await expect(cardByText(member, 'Before revocation')).toBeVisible()
    // Prevent the pending edit reaching the server, while permission refreshes remain online.
    await member.route('**/api/sync', (route) => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue())
    await cardByText(member, 'Before revocation').click()
    await member.keyboard.press(`${MOD}+a`)
    await member.keyboard.type('Latest private typing must survive')
    const list = await (await owner.context.request.get(`/api/shares?boardId=${boardId}`)).json()
    expect((await owner.context.request.delete(`/api/boards/${boardId}/members/${list.members[0].id}`)).ok()).toBe(true)
    await member.getByTestId('sync-status').click()
    await expect(member.getByRole('heading', { name: 'This board is unavailable' })).toBeVisible()
    await member.unroute('**/api/sync')
    await member.getByTestId('sync-now').click()
    await expect(member.getByTestId('sync-status')).toHaveText('Review edits')
    const downloaded = member.waitForEvent('download')
    await member.getByTestId('download-recovery').click()
    const download = await downloaded
    const { readFile } = await import('node:fs/promises')
    expect(await readFile((await download.path())!, 'utf8')).toContain('Latest private typing must survive')
    await member.getByRole('button', { name: 'My Doghouse', exact: true }).click()
    await expect(member.getByTestId('canvas')).toBeVisible()
    await expect(member.getByTestId('tool-note')).toBeVisible()
    const remote = await pullAllObjects(owner.context.request)
    expect(remote.objects.find((object: { id: string }) => object.id === noteId).content.md).toBe('Before revocation')
  } finally { await owner.context.close(); await recipient.context.close() }
})
