import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { cardByText, postSync, waitForSync } from './helpers.ts'

type Person = { id: string; username: string; context: BrowserContext; api: APIRequestContext; home: string }
async function person(admin: Page, browser: Browser, prefix: string): Promise<Person> {
  const username = `${prefix}_${crypto.randomUUID().slice(0, 8)}`
  const created = await admin.request.post('/api/users', { data: { username, password: 'privateboard123' } })
  expect(created.status()).toBe(201)
  const { user } = await created.json()
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
  expect((await context.request.post('/api/auth/login', { data: { username, password: 'privateboard123' } })).ok()).toBe(true)
  const access = await (await context.request.get('/api/access')).json()
  return { id: user.id, username, context, api: context.request, home: access.homeBoardId }
}
async function board(owner: Person, parentId = owner.home) {
  const id = crypto.randomUUID()
  const title = `Private ${id.slice(0, 8)}`
  const note = crypto.randomUUID()
  const response = await postSync(owner.api, { data: { changes: [
    { id, patch: { id, kind: 'board', parentId, title, icon: 'paw', color: 'gold', createdAt: Date.now() } },
    { id: note, patch: { id: note, kind: 'card', type: 'note', boardId: id, content: { md: `Secret ${id}` }, x: 0, y: 0, w: 260, h: 60, z: 1, color: 'none', createdAt: Date.now() } },
  ] } })
  expect(response.ok(), await response.text()).toBe(true)
  return { id, title, note }
}
async function grant(owner: Person, boardId: string, recipient: Person, includeChildren = true) {
  expect((await owner.api.post(`/api/boards/${boardId}/members`, { data: { username: recipient.username.toUpperCase(), permission: 'edit', includeChildren } })).status()).toBe(201)
}
async function pull(person: Person) { return (await person.api.get('/api/sync?since=0')).json() }

test('private boards and bytes stay private; related references and ownership cannot bypass access', async ({ page, browser }) => {
  const alice = await person(page, browser, 'owner')
  const bob = await person(page, browser, 'outsider')
  try {
    const privateBoard = await board(alice)
    const theirBoard = await board(bob)
    const body = await pull(bob)
    expect(JSON.stringify(body)).not.toContain(`Secret ${privateBoard.id}`)
    expect(body.objects.some((o: { id: string }) => o.id === privateBoard.id)).toBe(false)
    const denied = await bob.api.post('/api/sync', { data: { changes: [{ id: privateBoard.note, patch: { content: { md: 'stolen' } } }] } })
    expect(denied.status()).toBe(403)
    expect((await denied.json()).deniedIds).toContain(privateBoard.note)
    expect((await bob.api.post('/api/sync', { data: { changes: [{ id: privateBoard.id, patch: { ownerId: bob.id } }] } })).status()).toBe(403)
    expect((await bob.api.post('/api/shares', { data: { boardId: privateBoard.id } })).status()).toBe(403)
    const ref = crypto.randomUUID()
    expect((await bob.api.post('/api/sync', { data: { changes: [{ id: ref, patch: { kind: 'card', type: 'board', boardId: theirBoard.id, content: { boardId: privateBoard.id } } }] } })).status()).toBe(403)
    const newChild = crypto.randomUUID()
    expect((await bob.api.post('/api/sync', { data: { changes: [{ id: newChild, patch: { kind: 'board', parentId: privateBoard.id, title: 'intruder' } }] } })).status()).toBe(403)
    const assetId = crypto.randomUUID()
    expect((await alice.api.put(`/api/files/${assetId}?name=private.txt`, { data: Buffer.from('private bytes'), headers: { 'content-type': 'text/plain' } })).ok()).toBe(true)
    const file = crypto.randomUUID()
    expect((await postSync(alice.api, { data: { changes: [{ id: file, patch: { kind: 'card', type: 'file', boardId: privateBoard.id, content: { assetId, name: 'private.txt', size: 13, mime: 'text/plain' } } }] } })).ok()).toBe(true)
    expect((await bob.api.get(`/api/files/${assetId}`)).status()).toBe(403)
    const { share: publicView } = await (await alice.api.post('/api/shares', { data: { boardId: privateBoard.id, permission: 'view' } })).json()
    // A valid public capability works even while signed in to an account that
    // has no ordinary access to the private board.
    expect((await bob.api.get(`/api/files/${assetId}?share=${publicView.token}`)).status()).toBe(200)
    expect((await alice.api.delete(`/api/shares/${publicView.token}`)).ok()).toBe(true)
    expect((await bob.api.get(`/api/files/${assetId}?share=${publicView.token}`)).status()).toBe(401)
    // Adding a missing rendition must not let an attacker claim an existing ID.
    expect((await bob.api.put(`/api/assets/${assetId}/thumb`, { data: Buffer.from('forged'), headers: { 'content-type': 'image/png' } })).status()).toBe(403)
    const token = await (await bob.api.get('/api/assets/token')).json()
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
    expect((await anon.request.get(`/api/files/${assetId}?t=${encodeURIComponent(token.token)}`)).status()).toBe(403)
    await anon.close()
    expect((await bob.api.post('/api/sync', { data: { changes: [{ id: crypto.randomUUID(), patch: { kind: 'card', type: 'file', boardId: theirBoard.id, content: { assetId, name: 'stolen.txt' } } }] } })).status()).toBe(403)
  } finally { await alice.context.close(); await bob.context.close() }
})

test('username sharing is visible in the app, inherits to children, and revokes queued writes', async ({ page, browser }) => {
  const alice = await person(page, browser, 'uiowner')
  const bob = await person(page, browser, 'uihelper')
  try {
    const root = await board(alice)
    const child = await board(alice, root.id)
    const ownerPage = await alice.context.newPage()
    await ownerPage.goto(`/#/b/${root.id}`)
    await expect(ownerPage.getByTestId('board-name')).toHaveText(root.title)
    await ownerPage.getByTestId('share').click()
    await ownerPage.getByRole('textbox', { name: 'Username to invite' }).fill(bob.username)
    await ownerPage.getByRole('button', { name: 'Invite', exact: true }).click()
    const recipient = ownerPage.getByTestId('share-member').filter({ hasText: bob.username })
    await expect(recipient).toContainText('Can edit')
    const recipientPage = await bob.context.newPage()
    await recipientPage.goto(`/#/b/${root.id}`)
    await expect(cardByText(recipientPage, `Secret ${root.id}`)).toBeVisible()
    await expect(recipientPage.getByTestId('share')).toHaveCount(0)
    expect((await bob.api.get('/api/shares?boardId=' + root.id)).status()).toBe(403)
    expect(JSON.stringify(await pull(bob))).toContain(`Secret ${child.id}`)
    // Shared roots may have a private ancestor; editing their title must work.
    expect((await postSync(bob.api, { data: { changes: [{ id: root.id, patch: { title: 'Collaboratively named' } }] } })).ok()).toBe(true)
    expect((await postSync(bob.api, { data: { changes: [{ id: root.note, patch: { content: { md: 'Collaborative edit' } } }] } })).ok()).toBe(true)
    const before = await (await bob.api.get('/api/access')).json()
    await recipient.getByRole('button', { name: `Remove access for ${bob.username}` }).click()
    await expect(recipient).toHaveCount(0)
    const denied = await bob.api.post('/api/sync', { data: { changes: [{ id: root.note, patch: { x: 44 } }] } })
    expect(denied.status()).toBe(403)
    const refreshed = await (await bob.api.get(`/api/sync?since=0&accessRevision=${before.revision}`)).json()
    expect(refreshed.reset).toBe(true)
    expect(refreshed.objects.some((o: { id: string }) => o.id === root.id)).toBe(false)
    expect(refreshed.objects.some((o: { id: string }) => o.id === child.id)).toBe(false)
  } finally { await alice.context.close(); await bob.context.close() }
})

test('edit links require accounts, respect board-only scope, and preserve independent username access after revocation', async ({ page, browser }) => {
  const alice = await person(page, browser, 'linkowner')
  const bob = await person(page, browser, 'linkhelper')
  try {
    const root = await board(alice)
    const child = await board(alice, root.id)
    const result = await alice.api.post('/api/shares', { data: { boardId: root.id, permission: 'edit', includeChildren: false } })
    expect(result.status()).toBe(201)
    const { share } = await result.json()
    expect(share.allowSignup).toBe(false)
    expect(share.expiresAt - share.createdAt).toBe(7 * 86_400_000)
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
    const meta = await (await anon.request.get(`/api/share/${share.token}`)).json()
    expect(meta.permission).toBe('edit')
    expect(meta.objects).toBeUndefined()
    expect((await anon.request.post(`/api/shares/${share.token}/accept`, { data: {} })).status()).toBe(401)
    expect((await anon.request.post('/api/auth/signup', { data: { boardToken: share.token, username: `blocked_${crypto.randomUUID().slice(0,8)}`, password: 'privateboard123' } })).status()).toBe(410)
    const joinPage = await anon.newPage()
    await joinPage.goto(`/join/${share.token}`)
    await expect(joinPage.getByTestId('login-form')).toBeVisible()
    await expect(joinPage.getByRole('button', { name: 'Create an account' })).toHaveCount(0)
    expect((await bob.api.post(`/api/shares/${share.token}/accept`, { data: {} })).ok()).toBe(true)
    const visible = await pull(bob)
    expect(visible.objects.some((o: { id: string }) => o.id === root.id)).toBe(true)
    expect(visible.objects.some((o: { id: string }) => o.id === child.id)).toBe(false)
    await grant(alice, root.id, bob)
    expect((await alice.api.delete(`/api/shares/${share.token}`)).ok()).toBe(true)
    expect((await anon.request.get(`/api/share/${share.token}`)).status()).toBe(404)
    expect((await postSync(bob.api, { data: { changes: [{ id: root.note, patch: { x: 9 } }] } })).ok()).toBe(true)
    const members = await (await alice.api.get(`/api/shares?boardId=${root.id}`)).json()
    const direct = members.members.find((m: { viaLink: boolean; userId: string }) => !m.viaLink && m.userId === bob.id)
    expect((await alice.api.delete(`/api/boards/${root.id}/members/${direct.id}`)).ok()).toBe(true)
    expect((await bob.api.post('/api/sync', { data: { changes: [{ id: root.note, patch: { x: 19 } }] } })).status()).toBe(403)
    await anon.close()
  } finally { await alice.context.close(); await bob.context.close() }
})

test('owner-enabled board signup creates only scoped access, and turning off its link removes that access', async ({ page, browser }) => {
  const alice = await person(page, browser, 'signupowner')
  try {
    const root = await board(alice)
    const unrelated = await board(alice)
    const { share } = await (await alice.api.post('/api/shares', { data: { boardId: root.id, permission: 'edit', allowSignup: true } })).json()
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
    const join = await anon.newPage()
    await join.goto(`/join/${share.token}`)
    await join.getByRole('button', { name: 'Create an account' }).click()
    const username = `joined_${crypto.randomUUID().slice(0,8)}`
    await join.locator('input[name="username"]').fill(username)
    await join.locator('input[name="password"]').fill('privateboard123')
    await join.locator('input[name="confirm-password"]').fill('privateboard123')
    await join.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(join.getByTestId('board-name')).toHaveText(root.title)
    const access = await (await anon.request.get('/api/access')).json()
    expect(access.legacyShared).toBe(false)
    expect(access.boards.some((b: { id: string }) => b.id === unrelated.id)).toBe(false)
    expect((await alice.api.delete(`/api/shares/${share.token}`)).ok()).toBe(true)
    expect((await anon.request.post('/api/sync', { data: { changes: [{ id: root.note, patch: { x: 42 } }] } })).status()).toBe(403)
    await anon.close()
  } finally { await alice.context.close() }
})


test('new public links follow canonical children and never publish a referenced private root', async ({ page, browser }) => {
  const alice = await person(page, browser, 'viewowner')
  try {
    const root = await board(alice)
    const child = await board(alice, root.id)
    const other = await board(alice)
    const references = [child, other].map((target) => ({ id: crypto.randomUUID(), patch: { kind: 'card', type: 'board', boardId: root.id, content: { boardId: target.id }, x: 20, y: 30, w: 120, h: 120 } }))
    expect((await postSync(alice.api, { data: { changes: references } })).ok()).toBe(true)
    const { share } = await (await alice.api.post('/api/shares', { data: { boardId: root.id, includeChildren: true } })).json()
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
    const data = await (await anon.request.get(`/api/share/${share.token}`)).json()
    expect(data.sharedBoards).toContain(child.id)
    expect(data.sharedBoards).not.toContain(other.id)
    expect(JSON.stringify(data)).toContain(`Secret ${child.id}`)
    expect(JSON.stringify(data)).not.toContain(`Secret ${other.id}`)
    expect(JSON.stringify(data)).not.toContain(other.title)
    expect(data.objects.find((o: { id: string }) => o.id === other.id).title).toBe('Board')
    const { share: only } = await (await alice.api.post('/api/shares', { data: { boardId: root.id, includeChildren: false } })).json()
    const scoped = await (await anon.request.get(`/api/share/${only.token}`)).json()
    expect(scoped.sharedBoards).toEqual([root.id])
    expect(JSON.stringify(scoped)).not.toContain(child.title)
    expect(JSON.stringify(scoped)).not.toContain(`Secret ${child.id}`)
    await anon.close()
  } finally { await alice.context.close() }
})


test('old clients receive an update requirement before sync can read or mutate private boards', async ({ page, browser }) => {
  const alice = await person(page, browser, 'compatowner')
  try {
    const root = await board(alice)
    const legacy = await request.newContext({ baseURL: test.info().project.use.baseURL, storageState: await alice.context.storageState(), extraHTTPHeaders: { 'x-doggynote-protocol': '1' } })
    try {
      expect((await legacy.get('/api/sync?since=0')).status()).toBe(426)
      const rejected = await legacy.post('/api/sync', { data: { changes: [{ id: root.note, patch: { content: { md: 'old client overwrite' } } }] } })
      expect(rejected.status()).toBe(426)
      expect((await rejected.json()).updateRequired).toBe(true)
      const current = await pull(alice)
      expect(current.objects.find((o: { id: string }) => o.id === root.note).content.md).toBe(`Secret ${root.id}`)
    } finally { await legacy.dispose() }
  } finally { await alice.context.close() }
})


test('image credentials stop working when their issuing session is signed out or revoked', async ({ page, browser }) => {
  const alice = await person(page, browser, 'assetowner')
  try {
    const root = await board(alice)
    const asset = crypto.randomUUID()
    expect((await alice.api.put(`/api/files/${asset}?name=private.txt`, { data: Buffer.from('session protected'), headers: { 'content-type': 'text/plain' } })).ok()).toBe(true)
    expect((await postSync(alice.api, { data: { changes: [{ id: crypto.randomUUID(), patch: { kind: 'card', type: 'file', boardId: root.id, content: { assetId: asset, name: 'private.txt', size: 17, mime: 'text/plain' } } }] } })).ok()).toBe(true)
    const first = await (await alice.api.get('/api/assets/token')).json()
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
    expect((await anon.request.get(`/api/files/${asset}?t=${encodeURIComponent(first.token)}`)).status()).toBe(200)
    expect((await alice.api.post('/api/auth/logout', { data: {} })).ok()).toBe(true)
    expect((await anon.request.get(`/api/files/${asset}?t=${encodeURIComponent(first.token)}`)).status()).toBe(401)
    expect((await alice.api.post('/api/auth/login', { data: { username: alice.username, password: 'privateboard123' } })).ok()).toBe(true)
    const second = await (await alice.api.get('/api/assets/token')).json()
    expect((await anon.request.get(`/api/files/${asset}?t=${encodeURIComponent(second.token)}`)).status()).toBe(200)
    expect((await page.request.delete(`/api/users/${alice.id}/sessions`)).ok()).toBe(true)
    expect((await anon.request.get(`/api/files/${asset}?t=${encodeURIComponent(second.token)}`)).status()).toBe(401)
    await anon.close()
  } finally { await alice.context.close() }
})


test('view-only collaborators can capture privately while board placement stays disabled', async ({ page, browser }) => {
  const alice = await person(page, browser, 'readonlyowner')
  const bob = await person(page, browser, 'readonlyguest')
  try {
    const root = await board(alice)
    expect((await alice.api.post(`/api/boards/${root.id}/members`, { data: { username: bob.username, permission: 'view' } })).status()).toBe(201)
    const viewer = await bob.context.newPage()
    await viewer.goto(`/#/b/${root.id}`)
    await expect(viewer.getByTestId('board-name')).toHaveText(root.title)
    await expect(viewer.locator('.toolbar')).toHaveCount(0)
    await expect(viewer.getByTestId('undo')).toHaveCount(0)
    await expect(viewer.getByTestId('snap-toggle')).toHaveCount(0)
    await expect(viewer.getByTestId('board-permission')).toHaveText('View only')
    expect((await viewer.getByTestId('canvas').boundingBox())!.width).toBeGreaterThan(1000)
    await expect(viewer.getByTestId('zoom')).toBeVisible()
    await viewer.getByTestId('toybox-button').click()
    await viewer.getByTestId('toybox-input').fill('My private reminder')
    await viewer.getByTestId('toybox-input').press('Enter')
    const item = viewer.getByTestId('toybox-item').filter({ hasText: 'My private reminder' })
    await expect(item).toBeVisible()
    await expect(item.getByTestId('toybox-place')).toBeDisabled()
    await expect(viewer.locator('#toybox-move-hint')).toContainText('editing access')
    await waitForSync(viewer)
    const stored = await pull(bob)
    expect(stored.objects.some((o: { boardId?: string; content?: { md?: string } }) => o.boardId === `toybox:${bob.id}` && o.content?.md === 'My private reminder')).toBe(true)
    expect(JSON.stringify(await pull(alice))).not.toContain('My private reminder')
  } finally { await alice.context.close(); await bob.context.close() }
})

test('admins manage accounts, not other people’s private boards', async ({ page, browser }) => {
  const alice = await person(page, browser, 'adminproof')
  try {
    const privateBoard = await board(alice)
    // page is signed in as rex, an admin.
    const body = await (await page.request.get('/api/sync?since=0', { headers: { 'x-doggynote-protocol': '3' } })).json()
    expect(JSON.stringify(body)).not.toContain(`Secret ${privateBoard.id}`)
    const access = await (await page.request.get('/api/access')).json()
    expect(access.boards.some((b: { id: string }) => b.id === privateBoard.id || b.id === alice.home)).toBe(false)
    expect((await page.request.get(`/api/shares?boardId=${privateBoard.id}`)).status()).toBe(403)
    expect((await page.request.post('/api/shares', { data: { boardId: privateBoard.id, permission: 'view' } })).status()).toBe(403)
    expect((await page.request.post(`/api/boards/${privateBoard.id}/members`, { data: { username: 'rex' } })).status()).toBe(403)
    const write = await page.request.post('/api/sync', { headers: { 'x-doggynote-protocol': '3' }, data: { changes: [{ id: privateBoard.note, patch: { content: { md: 'admin edit' } } }] } })
    expect(write.status()).toBe(403)
    // Opening it by URL shows nothing of it.
    await page.goto(`/#/b/${privateBoard.id}`)
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByText(`Secret ${privateBoard.id}`)).toHaveCount(0)
    // Once alice shares it, rex sees it like anyone else.
    expect((await alice.api.post(`/api/boards/${privateBoard.id}/members`, { data: { username: 'rex', permission: 'view' } })).status()).toBe(201)
    const after = await (await page.request.get('/api/access')).json()
    expect(after.boards.find((b: { id: string }) => b.id === privateBoard.id)).toMatchObject({ canEdit: false, canManage: false })
  } finally { await alice.context.close() }
})
