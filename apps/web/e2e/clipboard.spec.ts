import { expect, test, type Page } from '@playwright/test'
import { MOD, at, cardByText, cards, clickEmpty, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'
import { boardOf, note, seedCards } from './touch.ts'

// Copy, cut, paste and duplicate cards with the real keys. Pastes land under the
// mouse, keep their layout and connections, and are one undo step.

test.beforeEach(async ({ page, browserName }) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await freshBoard(page)
})

const left = (page: Page, text: string) => cardByText(page, text).evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }))
const connections = (page: Page) => page.locator('[data-connection-id]')

async function selectAllCards(page: Page) {
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+A`)
}

async function pasteAt(page: Page, fx: number, fy: number, keys = `${MOD}+V`) {
  const p = await at(page, fx, fy)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.press(keys)
}

test('copy two connected cards and paste them under the mouse: new cards, same layout, one undo', async ({ page }) => {
  const [a] = await seedCards(page, [note('Fetch the ball', 0, 0), note('Bring it back', 300, 120)])
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-card-id]')].map((e) => (e as HTMLElement).dataset.cardId))
  await postSync(page.request, { data: { changes: [{ id: 'conn-' + a, patch: { id: 'conn-' + a, kind: 'connection', boardId: boardOf(page), from: ids[0], to: ids[1], arrow: 'end', createdAt: Date.now() } }] } })
  await page.reload()
  await expect(connections(page)).toHaveCount(1)
  await selectAllCards(page)
  await page.keyboard.press(`${MOD}+C`)
  await pasteAt(page, 0.6, 0.75)
  await expect(cardByText(page, 'Fetch the ball').and(page.locator('.selected'))).toHaveCount(1)
  await expect(page.locator('[data-testid=card]', { hasText: 'Fetch the ball' })).toHaveCount(2)
  await expect(connections(page)).toHaveCount(2)
  // Same shape: the second card is still 300 right and 120 down from the first.
  const [p1, p2] = [await left(page, 'Fetch the ball'), await left(page, 'Bring it back')]
  expect([p2.x - p1.x, p2.y - p1.y]).toEqual([300, 120])
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+Z`)
  await expect(cards(page)).toHaveCount(2)
  await expect(connections(page)).toHaveCount(1)
})

test('the copy reaches other apps as markdown', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Reading the system clipboard back needs Chromium permissions')
  await seedCards(page, [note('# Walk\nTwice a day', 0, 0), { type: 'todo', x: 0, y: 200, w: 240, content: { title: 'Chores', items: [{ id: 'a', text: 'Brush', done: true }] } }])
  await selectAllCards(page)
  await page.keyboard.press(`${MOD}+C`)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('# Walk\nTwice a day\n\nChores\n- [x] Brush')
})

test('⌘D duplicates beside the original; a column brings its cards', async ({ page }) => {
  await seedCards(page, [{ type: 'column', x: 0, y: 0, w: 280, content: { title: 'Snacks' } }, note('Biscuits', 0, 0)])
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-card-id]')].map((e) => (e as HTMLElement).dataset.cardId!))
  // Put the note in the column.
  await postSync(page.request, { data: { changes: [{ id: ids[1], patch: { columnId: ids[0], order: 1 } }] } })
  await page.reload()
  await cardByText(page, 'Snacks').getByTestId('column-title').click()
  await page.keyboard.press(`${MOD}+D`)
  await expect(page.locator('[data-type=column]')).toHaveCount(2)
  await expect(page.locator('[data-type=note]', { hasText: 'Biscuits' })).toHaveCount(2)
  const columns = page.locator('[data-type=column]')
  expect(await columns.nth(1).evaluate((el) => (el as HTMLElement).style.left)).toBe('32px')
  await expect(columns.nth(1)).toHaveClass(/selected/)
})

test('the Duplicate button does the same', async ({ page }) => {
  await seedCards(page, [note('Good boy', 0, 0)])
  await selectAllCards(page)
  await page.getByTestId('duplicate-selection').click()
  await expect(page.locator('[data-testid=card]', { hasText: 'Good boy' })).toHaveCount(2)
})

test('a board card copies the board inside it', async ({ page }) => {
  const inner = crypto.randomUUID()
  const kennel = `Kennel ${inner.slice(0, 6)}`
  const innerNote = crypto.randomUUID()
  await postSync(page.request, { data: { changes: [
    { id: inner, patch: { id: inner, kind: 'board', parentId: boardOf(page), title: kennel, icon: 'bone', color: 'gold', createdAt: Date.now() } },
    { id: innerNote, patch: { id: innerNote, kind: 'card', type: 'note', boardId: inner, x: 0, y: 0, w: 200, h: 60, z: 1, color: 'none', content: { md: 'Blanket inside' }, createdAt: Date.now() } },
  ] } })
  await seedCards(page, [{ type: 'board', x: 0, y: 0, w: 140, content: { boardId: inner } }])
  await selectAllCards(page)
  await page.keyboard.press(`${MOD}+C`)
  await pasteAt(page, 0.6, 0.6)
  await expect(page.locator('[data-type=board]')).toHaveCount(2)
  await waitForSync(page)
  const { objects } = await pullAllObjects(page.request)
  const kennels = objects.filter((o: { kind: string; title?: string }) => o.kind === 'board' && o.title === kennel)
  expect(kennels).toHaveLength(2)
  const copy = kennels.find((b: { id: string }) => b.id !== inner)
  expect(objects.some((o: { boardId?: string; content?: { md?: string } }) => o.boardId === copy.id && o.content?.md === 'Blanket inside')).toBe(true)
})

test('cut then paste on another board moves the very same card, comments and all', async ({ page }) => {
  const [id] = await seedCards(page, [note('Moving day', 0, 0)])
  const comment = crypto.randomUUID()
  expect((await postSync(page.request, { data: { changes: [{ id: comment, patch: { id: comment, kind: 'comment', boardId: boardOf(page), cardId: id, text: 'Bring boxes', createdAt: Date.now() } }] } })).ok()).toBe(true)
  await page.reload()
  // The comment arrives with the first pull after the reload, which can lag under load.
  await expect(cardByText(page, 'Moving day').getByTestId('comment-badge')).toHaveText('1', { timeout: 15_000 })
  await selectAllCards(page)
  await page.keyboard.press(`${MOD}+X`)
  await expect(cards(page)).toHaveCount(0)
  // freshBoard reloads the page; let the burial land first.
  await waitForSync(page)
  await freshBoard(page, 'New kennel')
  await pasteAt(page, 0.5, 0.5)
  await expect(cardByText(page, 'Moving day')).toBeVisible()
  await expect(cardByText(page, 'Moving day').getByTestId('comment-badge')).toHaveText('1')
  await waitForSync(page)
  const { objects } = await pullAllObjects(page.request)
  const moved = objects.find((o: { id: string }) => o.id === id)
  expect(moved).toMatchObject({ boardId: boardOf(page), deletedAt: null })
  expect(objects.find((o: { id: string }) => o.id === comment)).toMatchObject({ boardId: boardOf(page) })
  // A second paste is a copy.
  await pasteAt(page, 0.3, 0.3)
  await expect(page.locator('[data-testid=card]', { hasText: 'Moving day' })).toHaveCount(2)
})

test('pasting over a column drops the cards into it', async ({ page }) => {
  await seedCards(page, [{ type: 'column', x: 400, y: 0, w: 280, content: { title: 'Ideas' } }, note('Squeaky toy', 0, 0)])
  await cardByText(page, 'Squeaky toy').dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('note-editor')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+C`)
  const body = (await cardByText(page, 'Ideas').getByTestId('column-body').boundingBox())!
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2)
  await page.keyboard.press(`${MOD}+V`)
  await expect(cardByText(page, 'Ideas').getByTestId('column-body').getByTestId('card')).toHaveText(['Squeaky toy'])
})

test('⌘⇧V pastes words as a plain note, without a link preview', async ({ page }) => {
  // Test browsers don't run "paste and match style" for ⌘⇧V; real ones do. Press the
  // real keys, then hand the focused paste target what the browser would.
  const paste = (text: string) => page.evaluate((text) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
  const p = await at(page, 0.5, 0.5)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.press(`${MOD}+Shift+V`)
  // Linux browsers fire their own (empty) paste for the keys first.
  await paste('')
  await paste('https://example.com/dogs')
  await expect(page.locator('[data-type=note]', { hasText: 'https://example.com/dogs' })).toBeVisible()
  await expect(page.locator('[data-type=link]')).toHaveCount(0)
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+V`)
  await paste('https://example.com/cats')
  await expect(page.locator('[data-type=link]')).toHaveCount(1)
})

test('click into a note, shift-click another: both are selected and ⌘D duplicates them', async ({ page }) => {
  await seedCards(page, [note('First bone', 0, 0), note('Second bone', 300, 0)])
  await cardByText(page, 'First bone').dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await cardByText(page, 'Second bone').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('note-editor')).toHaveCount(0)
  await expect(page.locator('.card.selected')).toHaveCount(2)
  await page.keyboard.press(`${MOD}+D`)
  await expect(cards(page)).toHaveCount(4)
})
