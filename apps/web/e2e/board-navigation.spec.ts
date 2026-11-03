import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { postSync, waitForSync } from './helpers.ts'

type Person = { id: string; username: string; context: BrowserContext; api: APIRequestContext; home: string }
async function person(admin: Page, browser: Browser, prefix: string): Promise<Person> {
  const username = `${prefix}_${crypto.randomUUID().slice(0, 8)}`
  const created = await admin.request.post('/api/users', { data: { username, password: 'boardsmenu123' } })
  expect(created.status()).toBe(201)
  const { user } = await created.json()
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  expect((await context.request.post('/api/auth/login', { data: { username, password: 'boardsmenu123' } })).ok()).toBe(true)
  const access = await (await context.request.get('/api/access')).json()
  return { id: user.id, username, context, api: context.request, home: access.homeBoardId }
}
/** Makes the boards in one sync: every board made bumps the server's access revision. */
async function boards(owner: Person, list: { title: string; parentId?: string }[]) {
  const ids = list.map(() => crypto.randomUUID())
  const response = await postSync(owner.api, { data: { changes: list.map(({ title, parentId = owner.home }, i) => ({ id: ids[i], patch: { id: ids[i], kind: 'board', parentId, title, icon: 'paw', color: 'gold', createdAt: Date.now() } })) } })
  expect(response.ok(), await response.text()).toBe(true)
  return ids
}
async function grant(owner: Person, boardId: string, recipient: Person, permission: 'view' | 'edit' = 'edit') {
  expect((await owner.api.post(`/api/boards/${boardId}/members`, { data: { username: recipient.username, permission, includeChildren: true } })).status()).toBe(201)
}
async function openMenu(page: Page) {
  await page.getByTestId('board-navigation').click()
  return page.getByTestId('board-navigation-menu')
}

test('Shared with me lists the top of each shared tree, newest first, with who shared it', async ({ page, browser }) => {
  const alice = await person(page, browser, 'sharer')
  const bob = await person(page, browser, 'friend')
  try {
    const [older, viewOnly, newer] = await boards(alice, [{ title: 'Older walk plans' }, { title: 'Look but no chew' }, { title: 'Newer treat ideas' }])
    await boards(alice, [{ title: 'Inner walk route', parentId: older }])
    await grant(alice, older, bob)
    await grant(alice, viewOnly, bob, 'view')
    await grant(alice, newer, bob)
    // Alice makes a board inside one of Bob's: Bob can already reach it from his own board.
    const [bobs] = await boards(bob, [{ title: 'Bob’s workshop' }])
    await grant(bob, bobs, alice)
    await boards(alice, [{ title: 'Alice’s bench in Bob’s workshop', parentId: bobs }])

    const bobPage = await bob.context.newPage()
    await bobPage.goto('/')
    await waitForSync(bobPage)
    const menu = await openMenu(bobPage)
    const rows = menu.getByTestId('shared-board-link')
    await expect(rows).toHaveCount(3)
    await expect(rows.locator('.nav-menu-label')).toHaveText(['Newer treat ideas', 'Look but no chew', 'Older walk plans'])
    await expect(rows.nth(0).locator('.nav-menu-meta')).toHaveText(alice.username)
    await expect(rows.nth(1).locator('.nav-menu-meta')).toHaveText(`${alice.username} · View only`)
    await expect(menu).not.toContainText('Inner walk route')
    await expect(menu).not.toContainText('Alice’s bench')
    await expect(menu).not.toContainText('Can edit')
  } finally { await alice.context.close(); await bob.context.close() }
})

test('Shared with me shows five boards until Show all, and Recent lists boards you were just on', async ({ page, browser }) => {
  const alice = await person(page, browser, 'manyshares')
  const bob = await person(page, browser, 'manyfriend')
  try {
    const titles = Array.from({ length: 7 }, (_, i) => `Shared pile ${i + 1}`)
    for (const id of await boards(alice, titles.map((title) => ({ title })))) await grant(alice, id, bob)

    const bobPage = await bob.context.newPage()
    await bobPage.goto('/')
    await waitForSync(bobPage)
    let menu = await openMenu(bobPage)
    const rows = menu.getByTestId('shared-board-link')
    await expect(rows).toHaveCount(5)
    await expect(rows.first()).toContainText('Shared pile 7')
    const more = menu.getByTestId('shared-show-all')
    await expect(more).toHaveText('Show all (7)')
    await more.click()
    await expect(rows).toHaveCount(7)
    await expect(more).toHaveCount(0)
    await expect(rows.nth(5)).toBeFocused()

    await rows.nth(6).click()
    await expect(bobPage.getByTestId('board-name')).toHaveText('Shared pile 1')
    menu = await openMenu(bobPage)
    // The list folds back to five each time the menu opens.
    await expect(menu.getByTestId('shared-board-link')).toHaveCount(5)
    await menu.getByTestId('shared-board-link').first().click()
    await expect(bobPage.getByTestId('board-name')).toHaveText('Shared pile 7')
    menu = await openMenu(bobPage)
    await expect(menu.getByTestId('recent-board').first()).toHaveText('Shared pile 1')
    await expect(menu.getByTestId('recent-board').filter({ hasText: 'Shared pile 7' })).toHaveCount(0)
  } finally { await alice.context.close(); await bob.context.close() }
})
