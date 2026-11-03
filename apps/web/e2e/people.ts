import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { postSync } from './helpers.ts'

// Extra accounts for sharing and multi-device tests. Each context is one
// signed-in device, using the running project's device settings.
export type Person = { id: string; username: string; context: BrowserContext; api: APIRequestContext; home: string }
const PASSWORD = 'boardsmenu123'

export async function signIn(browser: Browser, username: string): Promise<BrowserContext> {
  const context = await browser.newContext({ ...test.info().project.use, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  expect((await context.request.post('/api/auth/login', { data: { username, password: PASSWORD } })).ok()).toBe(true)
  return context
}
export async function person(admin: Page, browser: Browser, prefix: string): Promise<Person> {
  const username = `${prefix}_${crypto.randomUUID().slice(0, 8)}`
  const created = await admin.request.post('/api/users', { data: { username, password: PASSWORD } })
  expect(created.status()).toBe(201)
  const { user } = await created.json()
  const context = await signIn(browser, username)
  const access = await (await context.request.get('/api/access')).json()
  return { id: user.id, username, context, api: context.request, home: access.homeBoardId }
}
/** Makes the boards in one sync: every board made bumps the server's access revision. */
export async function boards(owner: Person, list: { title: string; parentId?: string }[]) {
  const ids = list.map(() => crypto.randomUUID())
  const response = await postSync(owner.api, { data: { changes: list.map(({ title, parentId = owner.home }, i) => ({ id: ids[i], patch: { id: ids[i], kind: 'board', parentId, title, icon: 'paw', color: 'gold', createdAt: Date.now() } })) } })
  expect(response.ok(), await response.text()).toBe(true)
  return ids
}
export async function grant(owner: Person, boardId: string, recipient: Person, permission: 'view' | 'edit' = 'edit') {
  expect((await owner.api.post(`/api/boards/${boardId}/members`, { data: { username: recipient.username, permission, includeChildren: true } })).status()).toBe(201)
}
