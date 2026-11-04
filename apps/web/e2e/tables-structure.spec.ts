import { expect, test } from '@playwright/test'
import { clickEmpty, freshBoard, waitForSync } from './helpers.ts'
import { MOD, bodyRows, cell, centerOf, columnGrip, dragMouse, grid, headerCells, input, openEditing, rowGrip, seedTable, table } from './tables.ts'

// Rows and columns as things: grips outside the card pick and move them, a
// column's menu, resizing at the header's boundaries, Alt+Shift moves. Each
// action is one undo step.

const PACK = [['Rex', '4', 'Bacon'], ['Mochi', '7', 'Cheese'], ['Biscuit', '2', 'Roast chicken'], ['Fido', '9', 'Kibble']]
const COLS = ['Pup', 'Age', 'Treat']

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const names = async (page: import('@playwright/test').Page) => (await grid(page)).slice(1).map((r) => r[0])

test('grips sit outside the table being edited only, and edit mode moves nothing', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await expect(page.getByTestId('table-row-grip')).toHaveCount(0)
  const rest = (await table(page).boundingBox())!
  await openEditing(page)
  await expect(page.getByTestId('table-row-grip')).toHaveCount(4)
  await expect(page.getByTestId('table-column-grip')).toHaveCount(3)
  const card = (await table(page).boundingBox())!
  expect(Math.abs(card.height - rest.height)).toBeLessThan(1)
  const first = (await rowGrip(page, 0).boundingBox())!
  expect(first.x + first.width).toBeLessThanOrEqual(card.x)
  expect(first.width).toBe(24)
  const col = (await columnGrip(page, 0).boundingBox())!
  expect(col.y + col.height).toBeLessThanOrEqual(card.y)
  // Each row grip is as tall as its row.
  const row = (await bodyRows(page).nth(2).boundingBox())!
  const g = (await rowGrip(page, 2).boundingBox())!
  expect(Math.abs(g.y - row.y)).toBeLessThan(1.5)
  expect(Math.abs(g.height - row.height)).toBeLessThan(1.5)
  await clickEmpty(page)
  await expect(page.getByTestId('table-row-grip')).toHaveCount(0)
})

test('a row grip selects the whole row and the bar switches to row actions', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  await expect(page.getByTestId('table-clear')).toBeVisible()
  await rowGrip(page, 1).click()
  const range = (await page.getByTestId('table-range').boundingBox())!
  const a = (await cell(page, 1, 0).boundingBox())!, b = (await cell(page, 1, 2).boundingBox())!
  expect(Math.abs(range.x - a.x)).toBeLessThan(2)
  expect(Math.abs(range.x + range.width - (b.x + b.width))).toBeLessThan(2)
  expect(Math.abs(range.height - a.height)).toBeLessThan(2)
  const bar = page.getByTestId('table-bar')
  await expect(bar).toHaveAttribute('data-kind', 'rows')
  await expect(page.getByTestId('table-clear')).toHaveCount(0)
  await expect(page.getByTestId('table-row-below')).toBeVisible()
  await expect(page.getByTestId('table-delete')).toBeVisible()
  expect(await bar.locator('button').count()).toBeLessThanOrEqual(4)
  expect((await page.locator('.selection-bar').boundingBox())!.width).toBeLessThanOrEqual(220)
  // Shift-click stretches the selection; the bar counts them.
  await rowGrip(page, 3).click({ modifiers: ['Shift'] })
  await page.getByTestId('table-more').click()
  await expect(page.getByTestId('table-delete-rows')).toContainText('Delete 3 rows')
  await page.keyboard.press('Escape')
  // Delete takes the selected rows, in one step.
  await page.getByTestId('table-delete').click()
  expect(await names(page)).toEqual(['Rex'])
  await page.keyboard.press(`${MOD}+z`)
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit', 'Fido'])
})

test('a column grip selects the whole column, header included, with column actions', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  await columnGrip(page, 1).click()
  await expect(page.getByTestId('table-bar')).toHaveAttribute('data-kind', 'cols')
  const range = (await page.getByTestId('table-range').boundingBox())!
  const body = (await cell(page, 0, 1).boundingBox())!, last = (await cell(page, 3, 1).boundingBox())!
  expect(Math.abs(range.x - body.x)).toBeLessThan(2)
  expect(Math.abs(range.y + range.height - (last.y + last.height))).toBeLessThan(2)
  await columnGrip(page, 2).click({ modifiers: ['Shift'] })
  await page.getByTestId('table-more').click()
  await expect(page.getByTestId('table-delete-columns')).toContainText('Delete 2 columns')
  await page.keyboard.press('Escape')
  // Insert right of the selection: a new column after Treat, ready to be named.
  await page.getByTestId('table-column-right').click()
  await expect(headerCells(page)).toHaveCount(4)
  await expect(input(page)).toBeFocused()
  await page.keyboard.type('Walks')
  await page.keyboard.press('Enter')
  expect((await grid(page))[0]).toEqual(['Pup', 'Age', 'Treat', 'Walks'])
})

test('typing with a row picked does nothing; Escape steps back to the cell, then leaves', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  await rowGrip(page, 0).click()
  await page.keyboard.type('zzz')
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit', 'Fido'])
  await expect(input(page)).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('table-bar')).toHaveAttribute('data-kind', 'cells')
  await expect(input(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(input(page)).toHaveCount(0)
})

test('dragging a row grip moves the row with a drop line, as one undo step', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const from = await centerOf(rowGrip(page, 0))
  const to = await centerOf(rowGrip(page, 2))
  await dragMouse(page, from, { x: to.x, y: to.y + 4 }, { release: false })
  await expect(page.getByTestId('table-drop')).toBeVisible()
  const line = (await page.getByTestId('table-drop').boundingBox())!
  const under = (await cell(page, 2, 0).boundingBox())!
  expect(Math.abs(line.y - (under.y + under.height))).toBeLessThan(3)
  await page.mouse.up()
  await expect(page.getByTestId('table-drop')).toHaveCount(0)
  expect(await names(page)).toEqual(['Mochi', 'Biscuit', 'Rex', 'Fido'])
  // The moved row stays selected.
  await expect(page.getByTestId('table-bar')).toHaveAttribute('data-kind', 'rows')
  await page.keyboard.press(`${MOD}+z`)
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit', 'Fido'])
  await page.keyboard.press(`${MOD}+Shift+z`)
  expect(await names(page)).toEqual(['Mochi', 'Biscuit', 'Rex', 'Fido'])
  await waitForSync(page)
  await page.reload()
  await expect(table(page)).toBeVisible()
  expect(await names(page)).toEqual(['Mochi', 'Biscuit', 'Rex', 'Fido'])
})

test('a row dropped where it already is changes nothing', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const from = await centerOf(rowGrip(page, 1))
  await dragMouse(page, from, { x: from.x, y: from.y + 6 })
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit', 'Fido'])
})

test('dragging a column grip moves the column; cells go with it', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const from = await centerOf(columnGrip(page, 0))
  const to = await centerOf(columnGrip(page, 2))
  await dragMouse(page, from, { x: to.x + 20, y: to.y }, { release: false })
  await expect(page.getByTestId('table-drop')).toBeVisible()
  await page.mouse.up()
  expect(await grid(page)).toEqual([['Age', 'Treat', 'Pup'], ['4', 'Bacon', 'Rex'], ['7', 'Cheese', 'Mochi'], ['2', 'Roast chicken', 'Biscuit'], ['9', 'Kibble', 'Fido']])
  await page.keyboard.press(`${MOD}+z`)
  expect((await grid(page))[0]).toEqual(COLS)
})

test('dragging a selected block of rows moves them together', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  await rowGrip(page, 0).click()
  await rowGrip(page, 1).click({ modifiers: ['Shift'] })
  const from = await centerOf(rowGrip(page, 1))
  const to = await centerOf(rowGrip(page, 3))
  await dragMouse(page, from, { x: to.x, y: to.y + 8 })
  expect(await names(page)).toEqual(['Biscuit', 'Fido', 'Rex', 'Mochi'])
})

test('Alt+Shift+arrows move the selected rows or columns, and stop at the edges', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  await rowGrip(page, 1).click()
  await page.keyboard.press('Alt+Shift+ArrowDown')
  expect(await names(page)).toEqual(['Rex', 'Biscuit', 'Mochi', 'Fido'])
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await page.keyboard.press('Alt+Shift+ArrowDown')
  expect(await names(page)).toEqual(['Rex', 'Biscuit', 'Fido', 'Mochi'])
  await page.keyboard.press('Alt+Shift+ArrowUp')
  expect(await names(page)).toEqual(['Rex', 'Biscuit', 'Mochi', 'Fido'])
  // Undo takes the last move back, one step at a time.
  await page.keyboard.press(`${MOD}+z`)
  expect(await names(page)).toEqual(['Rex', 'Biscuit', 'Fido', 'Mochi'])
  await columnGrip(page, 0).click()
  await page.keyboard.press('Alt+Shift+ArrowRight')
  expect((await grid(page))[0]).toEqual(['Age', 'Pup', 'Treat'])
  await page.keyboard.press('Alt+Shift+ArrowLeft')
  await page.keyboard.press('Alt+Shift+ArrowLeft')
  expect((await grid(page))[0]).toEqual(COLS)
  // Shift+arrow along a picked row stretches it.
  await rowGrip(page, 0).click()
  await page.keyboard.press('Shift+ArrowDown')
  await page.getByTestId('table-more').click()
  await expect(page.getByTestId('table-delete-rows')).toContainText('Delete 2 rows')
})

test('the column menu: rename, insert, move and delete, from the header ⋯ and from the grip', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const head = headerCells(page).nth(1)
  await expect(page.getByTestId('table-column-menu').nth(1)).toHaveCSS('opacity', '0')
  await head.hover()
  await expect(page.getByTestId('table-column-menu').nth(1)).toHaveCSS('opacity', '1')
  await page.getByTestId('table-column-menu').nth(1).click()
  const menu = page.getByTestId('table-column-menu-list')
  await expect(menu).toBeVisible()
  await menu.getByTestId('table-rename-column').click()
  await expect(input(page)).toHaveValue('Age')
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.type('Years')
  await page.keyboard.press('Enter')
  expect((await grid(page))[0]).toEqual(['Pup', 'Years', 'Treat'])
  // The grip's right-click opens the very same menu.
  await columnGrip(page, 1).click({ button: 'right' })
  await expect(page.getByTestId('table-column-menu-list')).toBeVisible()
  await page.getByTestId('table-move-right').click()
  expect((await grid(page))[0]).toEqual(['Pup', 'Treat', 'Years'])
  await columnGrip(page, 0).click({ button: 'right' })
  await page.getByTestId('table-column-left').click()
  await expect(headerCells(page)).toHaveCount(4)
  await columnGrip(page, 0).click({ button: 'right' })
  await page.getByTestId('table-delete-columns').click()
  expect((await grid(page))[0]).toEqual(['Pup', 'Treat', 'Years'])
  // The bar's ⋯ shows the column list when a column is picked.
  await columnGrip(page, 2).click()
  await page.getByTestId('table-more').click()
  await expect(page.getByTestId('table-more-menu').getByTestId('table-rename-column')).toBeVisible()
  await expect(page.getByTestId('table-more-menu').getByTestId('table-move-right')).toBeDisabled()
})

test('the row menu: insert above, move, duplicate and clear, from a right-click on the grip', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  await rowGrip(page, 1).click({ button: 'right' })
  const menu = page.getByTestId('table-row-menu')
  await expect(menu).toBeVisible()
  await menu.getByTestId('table-duplicate-rows').click()
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Mochi', 'Biscuit', 'Fido'])
  // The copy is the selection now: move it up, clear it.
  await page.getByTestId('table-more').click()
  await page.getByTestId('table-move-up').click()
  await rowGrip(page, 0).click({ button: 'right' })
  await page.getByTestId('table-menu-clear').click()
  expect((await grid(page))[1]).toEqual(['', '', ''])
  await rowGrip(page, 4).click({ button: 'right' })
  await page.getByTestId('table-row-above').click()
  await expect(bodyRows(page)).toHaveCount(6)
})

test('a boundary strip resizes two columns, the card keeps its width, one drag is one undo', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const widths = async () => page.evaluate(() => [...document.querySelectorAll('[data-type=table] thead th')].map((th) => th.getBoundingClientRect().width))
  const before = await widths()
  const card = (await table(page).boundingBox())!
  const strip = page.getByTestId('table-resize').first()
  const at = await centerOf(strip)
  await dragMouse(page, at, { x: at.x + 60, y: at.y })
  const after = await widths()
  expect(after[0]! - before[0]!).toBeGreaterThan(50)
  expect(Math.abs(after[2]! - before[2]!)).toBeLessThan(1)
  expect(Math.abs(after.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0))).toBeLessThan(1)
  expect(Math.abs((await table(page).boundingBox())!.width - card.width)).toBeLessThan(1)
  await page.keyboard.press(`${MOD}+z`)
  const undone = await widths()
  expect(Math.abs(undone[0]! - before[0]!)).toBeLessThan(1)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await waitForSync(page)
  await page.reload()
  await expect(table(page)).toBeVisible()
  const reloaded = await widths()
  expect(Math.abs(reloaded[0]! - after[0]!)).toBeLessThan(1)
})

test('a column cannot be squeezed to nothing, and a double-click evens out two columns', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const widths = async () => page.evaluate(() => [...document.querySelectorAll('[data-type=table] thead th')].map((th) => th.getBoundingClientRect().width))
  const strip = page.getByTestId('table-resize').first()
  const at = await centerOf(strip)
  await dragMouse(page, at, { x: at.x - 400, y: at.y })
  const squeezed = await widths()
  expect(squeezed[0]!).toBeGreaterThan(20)
  expect(squeezed[0]!).toBeLessThan(squeezed[1]!)
  await page.getByTestId('table-resize').first().dblclick()
  const even = await widths()
  expect(Math.abs(even[0]! - even[1]!)).toBeLessThan(1.5)
})

test('a range tints every cell it covers, wrapped rows included (round 1 follow-up)', async ({ page }) => {
  await seedTable(page, ['Pup', 'Age', 'Favourite treat', 'Notes'], [
    ['Rex', '4', 'Bacon', 'Wags at the postman'],
    ['Biscuit', '2', 'Cheese', ''],
    ['Mochi', '7', 'Roast chicken, no skin please, and a lot of it so this wraps', 'Senior'],
  ], { w: 520 })
  await openEditing(page, 1, 2)
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  const check = async () => {
    const range = (await page.getByTestId('table-range').boundingBox())!
    for (const [r, c] of [[1, 2], [1, 3], [2, 2], [2, 3]] as const) {
      const b = (await cell(page, r, c).boundingBox())!
      expect(b.x, `cell ${r},${c} left`).toBeGreaterThanOrEqual(range.x - 1)
      expect(b.y, `cell ${r},${c} top`).toBeGreaterThanOrEqual(range.y - 1)
      expect(b.x + b.width, `cell ${r},${c} right`).toBeLessThanOrEqual(range.x + range.width + 1)
      expect(b.y + b.height, `cell ${r},${c} bottom`).toBeLessThanOrEqual(range.y + range.height + 1)
    }
    // ... and it covers nothing else: exactly the four cells.
    const tl = (await cell(page, 1, 2).boundingBox())!, br = (await cell(page, 2, 3).boundingBox())!
    expect(Math.abs(range.x - tl.x)).toBeLessThan(2)
    expect(Math.abs(range.y - tl.y)).toBeLessThan(2)
    expect(Math.abs(range.x + range.width - (br.x + br.width))).toBeLessThan(2)
    expect(Math.abs(range.y + range.height - (br.y + br.height))).toBeLessThan(2)
  }
  await check()
  // Text that wraps later, or a column that is narrowed, moves the cells: the tint follows.
  const strip = page.getByTestId('table-resize').nth(1)
  const at = await centerOf(strip)
  await dragMouse(page, at, { x: at.x - 70, y: at.y })
  await check()
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('Shift+ArrowDown')
  await check()
})

test('Shift+Space picks the row and Ctrl+Space the column, so the keyboard needs no grips', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 1, 1)
  await page.keyboard.press('Shift+Space')
  await expect(page.getByTestId('table-bar')).toHaveAttribute('data-kind', 'rows')
  await expect(input(page)).toHaveValue('')
  await page.keyboard.press('Alt+Shift+ArrowUp')
  expect(await names(page)).toEqual(['Mochi', 'Rex', 'Biscuit', 'Fido'])
  // Picking a column from a picked row starts at the row's first cell.
  await page.keyboard.press('Control+Space')
  await expect(page.getByTestId('table-bar')).toHaveAttribute('data-kind', 'cols')
  await page.keyboard.press('Alt+Shift+ArrowRight')
  expect((await grid(page))[0]).toEqual(['Age', 'Pup', 'Treat'])
})
