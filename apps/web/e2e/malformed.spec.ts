import { expect, test } from '@playwright/test'
import { MOD, at, cardByText, freshBoard, postSync } from './helpers.ts'
import { seedCards } from './touch.ts'
import { cellKey, colKey, grid, rowKey, tableFields, typedFields } from './tables.ts'

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

// Values of the wrong type for their column: a word in a tick column, an option that doesn't exist,
// nine paws, a colour that is no preset. Each draws as an empty cell (or muted text), never as a crash or
// as the colour it asked for.
test('a typed table with wrong-typed values still draws, and nothing injected reaches the page', async ({ page }) => {
  await freshBoard(page)
  const t = typedFields(
    [{ n: 'Pup' }, { n: 'Age', t: 'number' }, { n: 'Good', t: 'checkbox' }, { n: 'Day', t: 'date' }, { n: 'Mood', t: 'select', opts: [['Happy', 'ball']] }, { n: 'Paws', t: 'rating' }],
    [{ cells: ['Rex', 4, true, '2019-03-14', 'Happy', 5] }, { cells: ['Mochi', 7, false, '2019-11-02', 'Happy', 2] }, { cells: ['Fido', 1, true, '2019-01-01', 'Happy', 1] }],
  )
  const [id] = await seedCards(page, [{ type: 'table', x: 0, y: 0, w: 640, content: { title: 'Roster' }, fields: t.fields }])
  const [r1, r2, r3] = t.rows as [string, string, string]
  const [name, age, good, day, mood, paws] = t.cols as [string, string, string, string, string, string]
  const junk = {
    // A word in a tick column, a number in a date column, a tick in a number column.
    [cellKey(r1, good)]: 'maybe',
    [cellKey(r1, day)]: 20190314,
    [cellKey(r1, age)]: true,
    // An option that was never made, one that is the wrong type, nine paws, a fraction, a string of paws.
    [cellKey(r1, mood)]: 'zz99',
    [cellKey(r2, mood)]: { v: ['Happy'], bg: 'x,y' },
    [cellKey(r1, paws)]: 9,
    [cellKey(r2, paws)]: 2.5,
    [cellKey(r3, paws)]: '5',
    // Fills that are no preset, and styles of the wrong type.
    [cellKey(r2, name)]: { v: 'Painted', bg: '#ff0000', a: 'diagonal', b: 'bold' },
    [cellKey(r3, name)]: { v: 'Injected', bg: 'url(https://example.invalid/x.png)' },
    [rowKey(r3)]: { o: 3, bg: '#00ff00' },
    // A column whose options and alignment are junk.
    [colKey(mood)]: { n: 'Mood', o: 5, w: 1, t: 'select', a: 'upside-down', opts: [{ id: t.opts[4]![0]!.id, n: 'Happy', c: 'url(x)' }, { id: t.opts[4]![0]!.id, n: 'Dup', c: 'ball' }, { id: 7, n: 'Num', c: 'ball' }, { id: '2abc', n: 5, c: 'gold' }, 'nope', null] },
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
      for (const o of body.objects) if (o.id === id) Object.assign(o, junk)
      await route.fulfill({ response, json: body })
    } catch { /* the test ended with a pull in flight */ }
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()) })
  fromStart = true
  await page.reload()
  const card = page.locator(`[data-card-id="${id}"]`)
  await expect(card.getByTestId('table-grid')).toContainText('Injected')
  // Boxes: the word is no tick. Paws: 9, 2.5 and "5" are no paws. Options: unknown ids draw nothing.
  await expect(card.getByTestId('table-check').nth(0)).toHaveAttribute('aria-checked', 'false')
  await expect(card.getByTestId('table-rating').nth(0)).toHaveAttribute('data-n', '0')
  await expect(card.getByTestId('table-rating').nth(1)).toHaveAttribute('data-n', '0')
  await expect(card.getByTestId('table-rating').nth(2)).toHaveAttribute('data-n', '0')
  // The date and number columns draw something readable and not "[object Object]".
  const html = await card.innerHTML()
  expect(html).not.toMatch(/example\.invalid|#ff0000|#00ff00|\[object|upside|diagonal|url\(/)
  // Every fill and chip colour is one of the theme's own variables.
  const styles = await card.locator('[style]').evaluateAll((els) => els.map((el) => el.getAttribute('style') ?? ''))
  for (const style of styles) expect(style).not.toMatch(/#[0-9a-f]{3,6}|url\(|rgb/i)
  // The junk option colour is read as "no colour": a chip is there, in the neutral style.
  await expect(card.getByTestId('table-chip').first()).toHaveAttribute('data-none', '')
  // The same table zoomed out draws too, and opening a tag cell's picker doesn't throw.
  const p = await at(page, 0.5, 0.5)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down('Control')
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 80)
  await page.keyboard.up('Control')
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  await page.waitForTimeout(400)
  expect(errors).toEqual([])
})

test('a typed table can still be edited after wrong-typed values arrive: the junk is replaced by what is typed', async ({ page }) => {
  await freshBoard(page)
  const t = typedFields([{ n: 'Pup' }, { n: 'Good', t: 'checkbox' }, { n: 'Paws', t: 'rating' }], [{ cells: ['Rex', 'maybe', 9] }])
  await seedCards(page, [{ type: 'table', x: 100, y: 100, w: 480, content: { title: 'Roster' }, fields: t.fields }])
  const box = page.locator('[data-type=table]')
  await box.getByTestId('table-check').click()
  await box.getByTestId('table-check').click()
  await expect(box.getByTestId('table-check')).toHaveAttribute('aria-checked', 'true')
  await box.locator('td').first().click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('3')
  await expect(box.getByTestId('table-rating')).toHaveAttribute('data-n', '3')
})
