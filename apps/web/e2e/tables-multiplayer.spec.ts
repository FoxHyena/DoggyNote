import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { clickEmpty, freshBoard, waitForSync } from './helpers.ts'
import { seedCards } from './touch.ts'
import { cell, cellKey, grid, input, table, tableFields } from './tables.ts'

// Every cell is a field of its own, so two people typing in one table don't
// overwrite each other, and editing a table never holds back what others write.

const contexts = new Set<BrowserContext>()
test.afterEach(async () => { await Promise.all([...contexts].map((c) => c.close())); contexts.clear() })

async function friend(browser: Browser, owner: Page) {
  const id = owner.url().split('/b/')[1]!
  const grant = await owner.request.post(`/api/boards/${id}/members`, { data: { username: 'fido', permission: 'edit', includeChildren: true } })
  expect(grant.ok(), await grant.text()).toBe(true)
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  contexts.add(context)
  expect((await context.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  const page = await context.newPage()
  await page.goto(owner.url())
  await expect(page.getByTestId('canvas')).toBeVisible()
  return page
}

/** Click a cell (twice, when the table isn't being edited yet), type, and save with Tab. */
async function type(page: Page, row: number, col: number, text: string) {
  await cell(page, row, col).click()
  if (!(await table(page).evaluate((el) => el.classList.contains('editing')))) await cell(page, row, col).click()
  await expect(input(page)).toBeFocused()
  await page.keyboard.type(text)
  await page.keyboard.press('Tab')
}

async function start(browser: Browser, page: Page) {
  await freshBoard(page)
  const { fields } = tableFields(['Pup', 'Treat', 'Age'], [['Rex', 'Bacon', '4'], ['Mochi', 'Cheese', '7'], ['Pip', 'Kibble', '1']])
  await seedCards(page, [{ type: 'table', x: 0, y: 0, w: 420, content: { title: 'The pack' }, fields }])
  const other = await friend(browser, page)
  await expect(table(other)).toBeVisible()
  return other
}

test('different cells edited at the same time both survive', async ({ page, browser }) => {
  const other = await start(browser, page)
  await type(page, 0, 0, 'Rexy')
  await type(other, 1, 1, 'Brie')
  await waitForSync(page)
  await waitForSync(other)
  for (const p of [page, other]) {
    await expect.poll(async () => { const g = await grid(p); return [g[1]![0], g[2]![1]] }, { timeout: 25_000 }).toEqual(['Rexy', 'Brie'])
  }
  // And again, the other way round, with both still editing.
  await page.keyboard.press('Escape')
  await other.keyboard.press('Escape')
  await type(page, 1, 2, '2')
  await type(other, 2, 0, 'Pipp')
  await waitForSync(page)
  await waitForSync(other)
  for (const p of [page, other]) await expect.poll(async () => { const g = await grid(p); return [g[3]![0], g[2]![2]] }, { timeout: 25_000 }).toEqual(['Pipp', '2'])
})

test('when two people save the same cell, the last save wins on both screens', async ({ page, browser }) => {
  const other = await start(browser, page)
  await type(page, 0, 1, 'first')
  await waitForSync(page)
  await expect.poll(async () => (await grid(other))[1]![1], { timeout: 25_000 }).toBe('first')
  await type(other, 0, 1, 'second')
  await waitForSync(other)
  for (const p of [page, other]) await expect.poll(async () => (await grid(p))[1]![1], { timeout: 25_000 }).toBe('second')
})

test('a remote edit shows up while you are typing in another cell, and your draft is untouched', async ({ page, browser }) => {
  await freshBoard(page)
  const { fields, rows, cols } = tableFields(['Pup', 'Treat', 'Age'], [['Rex', 'Bacon', '4'], ['Mochi', 'Cheese', '7'], ['Pip', 'Kibble', '1']])
  const [id] = await seedCards(page, [{ type: 'table', x: 0, y: 0, w: 420, content: { title: 'The pack' }, fields }])
  const other = await friend(browser, page)
  await expect(table(other)).toBeVisible()
  await cell(page, 0, 0).click()
  await cell(page, 0, 0).click()
  await expect(input(page)).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.type(' the dog')
  // Someone else writes a different cell of the same table.
  const res = await other.request.post('/api/sync', { data: { changes: [{ id, patch: { id, [cellKey(rows[1]!, cols[2]!)]: '9' } }] } })
  expect(res.ok(), await res.text()).toBe(true)
  // It lands in my table while my edit is open, and my half-typed cell is as I left it.
  await expect.poll(async () => (await grid(page))[2]![2], { timeout: 25_000 }).toBe('9')
  await expect(table(page)).toHaveClass(/editing/)
  await expect(input(page)).toHaveValue('Rex the dog')
  await page.keyboard.press('Tab')
  await waitForSync(page)
  for (const p of [page, other]) await expect.poll(async () => { const g = await grid(p); return [g[1]![0], g[2]![2]] }, { timeout: 25_000 }).toEqual(['Rex the dog', '9'])
})

test('a row deleted by one person stays deleted, whatever the other typed in the meantime', async ({ page, browser }) => {
  const other = await start(browser, page)
  await other.context().setOffline(true)
  // Offline: the other person fills in a cell of the row that is about to go, and another one.
  await type(other, 0, 1, 'Ham')
  await type(other, 2, 1, 'Dried liver')
  // Meanwhile the first person deletes row 1.
  await cell(page, 0, 0).click()
  await cell(page, 0, 0).click()
  await expect(input(page)).toBeFocused()
  await page.getByTestId('table-more').click()
  await page.getByTestId('table-delete-rows').click()
  await expect(table(page).locator('tbody tr')).toHaveCount(2)
  await waitForSync(page)
  await other.context().setOffline(false)
  await other.evaluate(() => window.dispatchEvent(new Event('online')))
  await waitForSync(other)
  for (const p of [page, other]) {
    await expect(table(p).locator('tbody tr')).toHaveCount(2, { timeout: 25_000 })
    await expect.poll(async () => (await grid(p)).slice(1).map((r) => r.join('|')), { timeout: 25_000 }).toEqual(['Mochi|Cheese|7', 'Pip|Dried liver|1'])
  }
  await clickEmpty(page)
  await page.reload()
  await expect(table(page)).toBeVisible()
  expect((await grid(page)).length).toBe(3)
})
