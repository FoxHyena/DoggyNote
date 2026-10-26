import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MOD, at, cardByText, cards, clickEmpty, freshBoard, openCardMenu, postSync, pullAllObjects, runCardAction, waitForSync } from './helpers.ts'
import { boardOf, note, seedCards } from './touch.ts'

// Synced copies of a note: one text on several cards, on any boards. Made from
// the card's right-click menu, moved with cut and paste, listed in the small
// dropdown behind the synced marker, and never into a Toy box.

const contexts = new Set<BrowserContext>()
test.afterEach(async () => { await Promise.all([...contexts].map((c) => c.close())); contexts.clear() })

async function fido(browser: Browser, boardId: string, url: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
  contexts.add(context)
  expect((await context.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  const page = await context.newPage()
  await page.goto(url)
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('board-name')).not.toHaveText('')
  void boardId
  return page
}
async function share(page: Page, boardId: string) {
  const grant = await page.request.post(`/api/boards/${boardId}/members`, { data: { username: 'fido', permission: 'edit', includeChildren: true } })
  expect(grant.ok(), await grant.text()).toBe(true)
}
async function live(page: Page) {
  await page.getByTestId('collaborators').click()
  await expect(page.getByTestId('live-status')).toHaveText('Live')
  await page.keyboard.press('Escape')
}
/** Edit a card in place and put the caret at the end of its text. */
async function editAtEnd(page: Page, text: string) {
  await page.bringToFront()
  await cardByText(page, text).dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.getByTestId('note-editor').focus()
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.press('ArrowRight')
}
async function makeSyncedCopy(page: Page, text: string) {
  await cardByText(page, text).click()
  await openCardMenu(page)
  await page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Make a synced copy' }).click()
  await expect(page.locator('[data-testid="card"]', { hasText: text })).toHaveCount(2)
  await expect(page.locator('[data-testid="card"]', { hasText: text }).getByTestId('synced-marker')).toHaveCount(2)
}
async function pasteAt(page: Page, fx: number, fy: number) {
  const p = await at(page, fx, fy)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.press(`${MOD}+V`)
}

test('a synced copy on another board follows a friend’s edits live, lists both copies and goes to each', async ({ page, browser }) => {
  await freshBoard(page, 'Walks')
  const walks = boardOf(page), walksUrl = page.url()
  const [original] = await seedCards(page, [note('Walk at 6', 0, 0)])
  await makeSyncedCopy(page, 'Walk at 6')
  // The copy is picked. Cut and paste moves that very card, still synced.
  await page.keyboard.press(`${MOD}+X`)
  await expect(cards(page)).toHaveCount(1)
  await waitForSync(page)
  await freshBoard(page, 'Vet')
  const vet = boardOf(page)
  await pasteAt(page, 0.5, 0.5)
  const copy = cardByText(page, 'Walk at 6')
  await expect(copy.getByTestId('synced-marker')).toBeVisible()
  await waitForSync(page)

  // The dropdown lists both copies by board, this one first.
  await clickEmpty(page)
  await copy.getByTestId('synced-marker').click()
  const menu = page.getByTestId('synced-menu')
  await expect(menu.getByTestId('synced-copy')).toHaveText([/Vet.*This copy/, /Walks.*Go to/])
  // Beside the card, on the board: never over the note or the tool rail.
  const [m, c, board] = [(await menu.boundingBox())!, (await copy.boundingBox())!, (await page.getByTestId('canvas').boundingBox())!]
  expect(m.x >= c.x + c.width || m.x + m.width <= c.x || m.y >= c.y + c.height).toBe(true)
  expect(m.x).toBeGreaterThanOrEqual(board.x)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // fido can edit both boards and has Walks open; rex types in the copy on Vet.
  await share(page, walks)
  await share(page, vet)
  const friend = await fido(browser, walks, walksUrl)
  await expect(cardByText(friend, 'Walk at 6')).toBeVisible()
  await live(page); await live(friend)
  await editAtEnd(page, 'Walk at 6')
  await page.keyboard.type(' sharp')
  await expect(cardByText(friend, 'Walk at 6 sharp')).toBeVisible()
  await page.keyboard.press('Escape')
  // And fido's edit to the original reaches rex's copy.
  await editAtEnd(friend, 'Walk at 6 sharp')
  await friend.keyboard.type(', bring the ball')
  await expect(cardByText(page, 'Walk at 6 sharp, bring the ball')).toBeVisible()
  await friend.keyboard.press('Escape')
  await waitForSync(friend)

  // Go to opens the other board with that copy picked.
  await page.bringToFront()
  await copy.getByTestId('synced-marker').click()
  await menu.getByRole('menuitem', { name: 'Go to Walks' }).click()
  await expect(page.getByTestId('board-name')).toHaveText('Walks')
  await expect(page.locator(`[data-card-id="${original}"]`)).toHaveClass(/selected/)

  // Reload keeps the text and the link.
  await page.reload()
  await expect(cardByText(page, 'Walk at 6 sharp, bring the ball').getByTestId('synced-marker')).toBeVisible()
})

test('an independent copy keeps its text and stops following', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Kibble: 2 scoops', 0, 0)])
  await makeSyncedCopy(page, 'Kibble: 2 scoops')
  const copyId = await page.locator('[data-testid="card"].selected').getAttribute('data-card-id')
  await clickEmpty(page)
  await page.locator(`[data-card-id="${copyId}"]`).getByTestId('synced-marker').click()
  await page.getByTestId('synced-menu').getByTestId('make-independent').click()
  // Neither card has another copy now, so neither shows the marker.
  await expect(page.getByTestId('synced-marker')).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('goes its own way')
  const originalCard = page.locator('[data-testid="card"]:not([data-card-id="' + copyId + '"])', { hasText: 'Kibble' })
  await originalCard.dblclick()
  await page.getByTestId('note-editor').focus()
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.type('Kibble: 3 scoops')
  await page.keyboard.press('Escape')
  await waitForSync(page)
  await page.reload()
  await expect(page.locator(`[data-card-id="${copyId}"]`)).toHaveText('Kibble: 2 scoops')
  await expect(cardByText(page, 'Kibble: 3 scoops')).toBeVisible()
})

test('burying one copy leaves the other, and the buried one catches up when it comes back', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Bath on Sunday', 0, 0)])
  await makeSyncedCopy(page, 'Bath on Sunday')
  const copyId = await page.locator('[data-testid="card"].selected').getAttribute('data-card-id')
  await runCardAction(page, 'Bury', page.locator(`[data-card-id="${copyId}"]`))
  await expect(page.getByTestId('toast')).toContainText('Buried 1 card')
  await expect(cards(page)).toHaveCount(1)
  await expect(page.getByTestId('synced-marker')).toHaveCount(0)
  await editAtEnd(page, 'Bath on Sunday')
  await page.keyboard.type(' at noon')
  await page.keyboard.press('Escape')
  await waitForSync(page)
  // Dig it back up from Buried bones: it returns with the latest text.
  await page.getByTestId('tool-trash').click()
  await expect(page.getByTestId('trash-panel')).toContainText('Bath on Sunday')
  await page.getByTestId('restore').click()
  await expect(page.locator('[data-testid="card"]', { hasText: 'Bath on Sunday at noon' })).toHaveCount(2)
  await expect(page.getByTestId('synced-marker')).toHaveCount(2)
})

test('Toy box privacy: no synced copy goes in or out, and fido never sees rex’s private text', async ({ page, browser }) => {
  await freshBoard(page, 'Pack plans')
  const board = boardOf(page), url = page.url()
  await seedCards(page, [note('Park on Saturday', 0, 0)])
  await makeSyncedCopy(page, 'Park on Saturday')
  const copyId = (await page.locator('[data-testid="card"].selected').getAttribute('data-card-id'))!
  await waitForSync(page)
  const me = (await (await page.request.get('/api/me')).json()).user.id as string
  // Rex files the copy in his Toy box (as any app might), then writes there.
  expect((await postSync(page.request, { data: { changes: [{ id: copyId, patch: { boardId: `toybox:${me}` } }] } })).ok()).toBe(true)
  expect((await postSync(page.request, { data: { changes: [{ id: copyId, patch: { content: { md: 'Secret biscuit stash' } } }] } })).ok()).toBe(true)
  // It left the group, so the shared note kept its text.
  const { objects } = await pullAllObjects(page.request)
  expect(objects.find((o: { id: string }) => o.id === copyId)).toMatchObject({ syncId: null, content: { md: 'Secret biscuit stash' } })
  // A deliberate join into, or out of, the Toy box is refused.
  const original = objects.find((o: { boardId?: string; content?: { md?: string } }) => o.boardId === board && o.content?.md === 'Park on Saturday') as { id: string; syncId: string; noteState: string }
  const sneak = crypto.randomUUID()
  const joinIn = await page.request.post('/api/sync', { data: { changes: [{ id: sneak, patch: { id: sneak, kind: 'card', type: 'note', boardId: `toybox:${me}`, x: 0, y: 0, w: 240, h: 80, z: 1, color: 'none', createdAt: Date.now(), content: { md: 'Park on Saturday' }, noteUpdate: original.noteState, syncId: original.syncId, syncJoin: true } }] } })
  expect(joinIn.status()).toBe(403)
  const joinOut = await page.request.post('/api/sync', { data: { changes: [{ id: copyId, patch: { syncId: original.syncId, syncJoin: true } }] } })
  expect(joinOut.status()).toBe(403)

  await share(page, board)
  const friend = await fido(browser, board, url)
  await expect(cardByText(friend, 'Park on Saturday')).toBeVisible()
  await expect(friend.getByTestId('synced-marker')).toHaveCount(0)
  const seen = JSON.stringify(await pullAllObjects(friend.request))
  expect(seen).toContain('Park on Saturday')
  expect(seen).not.toContain('Secret biscuit')
  // In rex's app the shared note is plain again: its copy is private now.
  await page.reload()
  await expect(cardByText(page, 'Park on Saturday')).toBeVisible()
  await expect(page.getByTestId('synced-marker')).toHaveCount(0)
})

test('a friend who can’t edit every copy gets an independent copy, and the original is untouched', async ({ page, browser }) => {
  // A board of rex's own, outside the shared tree: fido can't see or edit it.
  const den = crypto.randomUUID()
  expect((await postSync(page.request, { data: { changes: [{ id: den, patch: { id: den, kind: 'board', parentId: null, title: 'Private den', icon: 'paw', color: 'gold', createdAt: Date.now() } }] } })).ok()).toBe(true)
  await freshBoard(page, 'Pack board')
  const board = boardOf(page), url = page.url()
  await seedCards(page, [note('Treats: 3 a day', 0, 0)])
  await makeSyncedCopy(page, 'Treats: 3 a day')
  // The copy goes to rex's private board, which fido can't see or edit.
  await page.keyboard.press(`${MOD}+X`)
  await waitForSync(page)
  await page.goto(`/#/b/${den}`)
  await expect(page.getByTestId('board-name')).toHaveText('Private den')
  await pasteAt(page, 0.5, 0.5)
  await expect(cardByText(page, 'Treats: 3 a day').getByTestId('synced-marker')).toBeVisible()
  await waitForSync(page)

  await share(page, board)
  const friend = await fido(browser, board, url)
  await editAtEnd(friend, 'Treats: 3 a day')
  await friend.keyboard.type(' (fido says 5)')
  await friend.keyboard.press('Escape')
  await waitForSync(friend)
  await expect(friend.getByTestId('toast')).toContainText('stopped syncing')
  // rex's copy kept its text; the pack board's note is now independent.
  await page.bringToFront()
  await page.reload()
  await expect(cardByText(page, 'Treats: 3 a day')).toHaveText('Treats: 3 a day')
  await expect(page.getByTestId('synced-marker')).toHaveCount(0)
})
