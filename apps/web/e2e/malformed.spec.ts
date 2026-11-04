import { expect, test } from '@playwright/test'
import { MOD, at, cardByText, freshBoard, postSync } from './helpers.ts'
import { seedCards } from './touch.ts'
import { cellKey, colKey, grid, rowKey, tableFields } from './tables.ts'

// Sync stores whatever a collaborator's device sends. A malformed object (by a
// bug or on purpose) must not break the board for everyone else who opens it.
test('a board with malformed objects still opens, and colours can’t inject CSS', async ({ page }) => {
  await freshBoard(page)
  const boardId = decodeURIComponent(new URL(page.url()).hash.replace('#/b/', ''))
  const id = () => crypto.randomUUID()
  const good = id()
  const child = id()
  const tile = { x: 0, y: 0, w: 260, h: 80, z: 1, createdAt: Date.now() }
  const changes = [
    { id: good, patch: { id: good, kind: 'card', type: 'note', boardId, color: 'none', content: { md: 'Still here' }, ...tile } },
    { id: child, patch: { id: child, kind: 'board', parentId: boardId, title: 5, icon: 'valueOf', color: 'nope', createdAt: Date.now() } },
    { id: id(), patch: { kind: 'card', type: 'board', boardId, content: { boardId: child }, color: 'none', ...tile, x: 300 } },
    { id: id(), patch: { kind: 'card', type: 'file', boardId, content: { assetId: id(), name: 1, mime: {}, size: 3 }, color: 'none', ...tile, y: 120 } },
    { id: id(), patch: { kind: 'card', type: 'todo', boardId, content: { title: 'Broken list', items: 'nope' }, color: 'none', ...tile, y: 240 } },
    { id: id(), patch: { kind: 'card', type: 'link', boardId, content: null, color: 'none', ...tile, y: 360 } },
    { id: id(), patch: { kind: 'card', type: 'image', boardId, content: null, color: 'none', ...tile, x: 300, y: 360 } },
    { id: id(), patch: { kind: 'card', type: 'note', boardId, content: { md: 'Painted' }, color: 'x,url(https://example.invalid/t.png)) /*', ...tile, x: 300, y: 240 } },
    { id: id(), patch: { kind: 'comment', boardId, cardId: good, text: 42, createdAt: Date.now() } },
  ]
  const response = await postSync(page.request, { data: { changes } })
  expect(response.ok(), await response.text()).toBe(true)

  await page.reload()
  await expect(cardByText(page, 'Still here')).toBeVisible()
  await expect(page.getByTestId('card-unreadable').first()).toBeVisible()
  await expect(page.getByTestId('board-name')).toBeVisible()

  // An unknown colour falls back to the plain card, not a CSS value from the object.
  const painted = cardByText(page, 'Painted')
  await expect(painted).toBeVisible()
  expect(await painted.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--c-bg'))).toBe('var(--dn-card-none-bg)')

  // The comment with non-text content opens without breaking the panel.
  await cardByText(page, 'Still here').getByTestId('comment-badge').click()
  await expect(page.getByTestId('comments-panel')).toBeVisible()
  await page.keyboard.press('Escape')

  // Search walks every card in the workspace, malformed ones included.
  await page.getByTestId('open-fetch').click()
  await page.getByTestId('fetch-input').fill('Still here')
  await expect(page.getByTestId('fetch-hit').filter({ hasText: 'Still here' }).first()).toBeVisible()
  await page.keyboard.press('Escape')

  // Zoomed out, cards are drawn on one canvas; malformed ones mustn't stop it drawing.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const p = await at(page, 0.5, 0.5)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 80)
  await page.keyboard.up('Control')
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  await page.waitForTimeout(300)
  expect(errors).toEqual([])
  await page.keyboard.press(`${MOD}+0`)
  await expect(cardByText(page, 'Still here')).toBeVisible()

  // Navigation and the malformed child board still work.
  await page.getByTestId('board-navigation').click()
  await expect(page.getByTestId('board-navigation-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto(`/#/b/${child}`)
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('board-name')).toHaveText('Untitled board')
})

// The server refuses a malformed table field, so these arrive the way a bug or an old
// client's leftovers would: in a pull. Whatever shape they have, the table still draws.
test('a table with wrong-typed rows, columns and cells still draws and zooms out', async ({ page }) => {
  await freshBoard(page)
  const { fields, rows, cols } = tableFields(['Pup', 'Treat', 'Age'], [['Rex', 'Bacon', '4'], ['Mochi', 'Cheese', '7'], ['Pip', 'Kibble', '1']])
  const [table, broken] = await seedCards(page, [
    { type: 'table', x: 0, y: 0, w: 420, content: { title: 'Roster' }, fields },
    { type: 'table', x: 0, y: 400, w: 420, content: { title: 'Broken' } },
  ])
  const junk = {
    [cellKey(rows[0]!, cols[1]!)]: 'Injected',
    [cellKey(rows[1]!, cols[0]!)]: ['not', 'a', 'cell'],
    [cellKey(rows[1]!, cols[1]!)]: { v: { deep: 1 }, b: 'yes', a: 'diagonal', bg: 'url(https://example.invalid/x.png)' },
    [cellKey(rows[1]!, cols[2]!)]: { v: 12, bg: 'x,y' },
    [cellKey(rows[2]!, cols[0]!)]: 42,
    [cellKey(rows[2]!, cols[1]!)]: false,
    [cellKey(rows[2]!, cols[2]!)]: null,
    [colKey(cols[2]!)]: { n: 5, o: 'x', w: -2, t: 'weird', opts: 'no' },
    [rowKey(rows[2]!)]: { o: 'later', bg: 7 },
    content: { title: 7 },
  }
  let fromStart = false
  await page.route('**/api/sync?*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    try {
      // The app keeps its pull cursor across a reload, so the first pull after it may skip the table. Ask that one from the start
      // (later pages carry on from there), so the table is in the answer however long ago it synced.
      const response = await route.fetch(fromStart ? { url: route.request().url().replace(/since=\d+/, 'since=0') } : {})
      fromStart = false
      const body = await response.json() as { objects: Record<string, unknown>[] }
      for (const o of body.objects) {
        if (o.id === table) Object.assign(o, junk)
        if (o.id === broken) o.content = null
      }
      await route.fulfill({ response, json: body })
    } catch { /* the test ended with a pull in flight */ }
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  fromStart = true
  await page.reload()
  await expect(page.getByTestId('table-grid').first()).toContainText('Injected')
  // The good cells show; the broken ones are empty, not crashes. The card with no content is the only one that can't be shown.
  const cells = await grid(page, page.locator(`[data-card-id="${table}"]`))
  // (The row with an order that isn't a number sorts first.)
  expect(cells.flat()).toEqual(expect.arrayContaining(['Rex', 'Injected', '4', '12', '42']))
  expect(cells.flat().join(' ')).not.toMatch(/deep|diagonal|example\.invalid|\[object/)
  await expect(page.locator(`[data-card-id="${table}"]`).getByTestId('card-unreadable')).toHaveCount(0)
  // Searching, and drawing zoomed out, walk the same fields.
  await page.getByTestId('open-fetch').click()
  await page.getByTestId('fetch-input').fill('Injected')
  await expect(page.getByTestId('fetch-hit').first()).toBeVisible()
  await page.keyboard.press('Escape')
  const p = await at(page, 0.5, 0.5)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down('Control')
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 80)
  await page.keyboard.up('Control')
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  await page.waitForTimeout(400)
  expect(errors).toEqual([])
})
