import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { postSync } from './helpers.ts'
import { WEB_PORT } from './ports.ts'

// Two fresh accounts per test, so other specs' comments never land in the count.

export type Person = { id: string; username: string; context: BrowserContext; page: Page; home: string }

export async function person(admin: Page, browser: Browser, prefix: string): Promise<Person> {
  const username = `${prefix}_${crypto.randomUUID().slice(0, 8)}`
  const password = 'unread-dots-123'
  const created = await admin.request.post('/api/users', { data: { username, password } })
  expect(created.status()).toBe(201)
  const { user } = await created.json()
  const context = await browser.newContext({ ...test.info().project.use, baseURL: `http://localhost:${WEB_PORT}`, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  expect((await context.request.post('/api/auth/login', { data: { username, password } })).ok()).toBe(true)
  const access = await (await context.request.get('/api/access')).json()
  return { id: user.id, username, context, page: await context.newPage(), home: access.homeBoardId }
}

/** A board inside the owner's Doghouse (with a board card for it there), two notes on it, shared with `friend`. */
export async function sharedBoard(owner: Person, friend: Person) {
  const id = crypto.randomUUID(), tile = crypto.randomUUID()
  const title = `Walkies ${id.slice(0, 5)}`
  const notes = [`Ball ${id.slice(0, 5)}`, `Stick ${id.slice(0, 5)}`]
  const noteIds = notes.map(() => crypto.randomUUID())
  const response = await postSync(owner.context.request, { data: { changes: [
    { id, patch: { id, kind: 'board', parentId: owner.home, title, icon: 'ball', color: 'sky', createdAt: Date.now() } },
    { id: tile, patch: { id: tile, kind: 'card', type: 'board', boardId: owner.home, content: { boardId: id }, x: 0, y: 0, w: 120, h: 120, z: 1, color: 'none', createdAt: Date.now() } },
    ...notes.map((md, i) => ({ id: noteIds[i], patch: { id: noteIds[i], kind: 'card', type: 'note', boardId: id, content: { md }, x: i * 320, y: 200, w: 260, h: 60, z: 1, color: 'none', createdAt: Date.now() } })),
  ] } })
  expect(response.ok(), await response.text()).toBe(true)
  expect((await owner.context.request.post(`/api/boards/${id}/members`, { data: { username: friend.username, permission: 'edit', includeChildren: true } })).status()).toBe(201)
  return { id, title, notes, noteIds }
}

/** Open a board and wait until read marks have loaded, so "new" starts now. */
export async function openWithReadMarks(p: Person, boardId: string) {
  const loaded = p.page.waitForResponse((r) => r.url().includes('/api/seen') && r.request().method() === 'GET')
  await p.page.goto(`/#/b/${boardId}`)
  await expect(p.page.getByTestId('canvas')).toBeVisible()
  expect((await loaded).ok()).toBe(true)
}

/** A comment through the API, for setups where typing it isn't the point. */
export async function commentVia(p: Person, boardId: string, cardId: string, text: string) {
  const id = crypto.randomUUID()
  const response = await postSync(p.context.request, { data: { changes: [{ id, patch: { id, kind: 'comment', boardId, cardId, authorId: p.id, author: p.username, text, createdAt: Date.now() } }] } })
  expect(response.ok(), await response.text()).toBe(true)
}
