import { expect, test } from '@playwright/test'
import { clickEmpty, freshBoard, waitForSync } from './helpers.ts'
import { MOD, activeCell, addTable, bodyRows, cell, grid, headerCells, input, table } from './tables.ts'

// A table card: made from the toolbar, filled in by keyboard like a spreadsheet,
// and every action is one undo step.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

test('a new table starts with named columns and three empty rows, ready to type', async ({ page }) => {
  const card = await addTable(page)
  expect(await grid(page)).toEqual([['Name', 'Treats', 'Notes'], ['', '', ''], ['', '', ''], ['', '', '']])
  expect(await activeCell(page)).toEqual({ row: 0, col: 0 })
  await expect(card).toHaveClass(/editing/)
  await expect(card.getByTestId('table-grid')).toHaveAttribute('role', 'grid')
  await expect(card.getByTestId('table-grid')).toHaveAttribute('aria-rowcount', '4')
})

test('typing replaces a cell; Tab and Enter save and move on', async ({ page }) => {
  await addTable(page)
  await page.keyboard.type('Rex')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Bacon')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Good boy')
  await page.keyboard.press('Enter')
  expect(await activeCell(page)).toEqual({ row: 1, col: 2 })
  await page.keyboard.type('Wags')
  await page.keyboard.press('Enter')
  expect((await grid(page)).slice(1)).toEqual([['Rex', 'Bacon', 'Good boy'], ['', '', 'Wags'], ['', '', '']])
  // Typing over a filled cell replaces it.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('Fish')
  await page.keyboard.press('Tab')
  expect((await grid(page))[1]).toEqual(['Rex', 'Fish', 'Good boy'])
})

test('arrows move, shift extends a range, the modifier jumps to the edge, Home and End run along the row', async ({ page }) => {
  await addTable(page)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  expect(await activeCell(page)).toEqual({ row: 1, col: 1 })
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByTestId('table-range')).toBeVisible()
  const box = await page.getByTestId('table-range').boundingBox()
  const a = await cell(page, 1, 1).boundingBox(), b = await cell(page, 2, 2).boundingBox()
  expect(Math.abs(box!.x - a!.x)).toBeLessThan(2)
  expect(Math.abs(box!.y - a!.y)).toBeLessThan(2)
  expect(Math.abs(box!.x + box!.width - (b!.x + b!.width))).toBeLessThan(2)
  expect(Math.abs(box!.y + box!.height - (b!.y + b!.height))).toBeLessThan(2)
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('table-range')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+ArrowDown`)
  expect(await activeCell(page)).toEqual({ row: 2, col: 0 })
  await page.keyboard.press(`${MOD}+ArrowUp`)
  expect(await activeCell(page)).toEqual({ row: -1, col: 0 })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  expect(await activeCell(page)).toEqual({ row: 0, col: 2 })
  await page.keyboard.press('Home')
  expect(await activeCell(page)).toEqual({ row: 0, col: 0 })
  await page.keyboard.press(`${MOD}+a`)
  await expect(page.getByTestId('table-range')).toBeVisible()
  await page.keyboard.type('x')
  // Typing after select-all replaces only the active cell.
  await page.keyboard.press('Enter')
  expect((await grid(page))[1]![0]).toBe('x')
})

test('Enter or F2 edits in place, Escape drops the draft, a second Escape leaves the table', async ({ page }) => {
  await addTable(page)
  await page.keyboard.type('Rex')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(input(page)).toHaveValue('Rex')
  await page.keyboard.type(' the dog')
  await page.keyboard.press('Escape')
  await expect(input(page)).toHaveValue('')
  expect((await grid(page))[1]![0]).toBe('Rex')
  await page.keyboard.press('F2')
  await page.keyboard.type('!')
  await page.keyboard.press('Tab')
  expect((await grid(page))[1]![0]).toBe('Rex!')
  await page.keyboard.press('Escape')
  await expect(table(page)).not.toHaveClass(/editing/)
})

test('Shift+Enter and Alt+Enter make a new line in a cell', async ({ page }) => {
  await addTable(page)
  await page.keyboard.type('one')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('two')
  await page.keyboard.press('Alt+Enter')
  await page.keyboard.type('three')
  await page.keyboard.press('Tab')
  expect((await grid(page))[1]![0]).toBe('one\ntwo\nthree')
  // The row grows to fit it.
  expect((await cell(page, 0, 0).boundingBox())!.height).toBeGreaterThan(60)
})

test('Tab on the last cell and Enter on the last row add a row', async ({ page }) => {
  await addTable(page)
  await page.keyboard.press(`${MOD}+End`)
  expect(await activeCell(page)).toEqual({ row: 2, col: 2 })
  await page.keyboard.type('end')
  await page.keyboard.press('Tab')
  await expect(bodyRows(page)).toHaveCount(4)
  expect(await activeCell(page)).toEqual({ row: 3, col: 0 })
  await page.keyboard.type('a')
  await page.keyboard.press('Enter')
  await expect(bodyRows(page)).toHaveCount(5)
  expect(await activeCell(page)).toEqual({ row: 4, col: 0 })
  // One undo takes back the cell and the row it added together.
  await page.keyboard.press(`${MOD}+z`)
  await expect(bodyRows(page)).toHaveCount(4)
  expect((await grid(page))[4]![0]).toBe('')
  expect((await grid(page))[3]![2]).toBe('end')
})

test('"+ row" and "+ column" sit outside the card and never change its height', async ({ page }) => {
  const card = await addTable(page)
  const before = (await card.boundingBox())!
  const row = (await page.getByTestId('table-add-row').boundingBox())!
  const column = (await page.getByTestId('table-add-column').boundingBox())!
  expect(row.y).toBeGreaterThanOrEqual(before.y + before.height)
  expect(column.x).toBeGreaterThanOrEqual(before.x + before.width)
  await page.getByTestId('table-add-column').click()
  await expect(headerCells(page)).toHaveCount(4)
  // The new column's name is ready to type.
  expect(await activeCell(page)).toEqual({ row: -1, col: 3 })
  await page.keyboard.type('Toys')
  await page.keyboard.press('Enter')
  await page.getByTestId('table-add-row').click()
  await expect(bodyRows(page)).toHaveCount(4)
  expect((await grid(page))[0]).toEqual(['Name', 'Treats', 'Notes', 'Toys'])
  const after = (await card.boundingBox())!
  expect(after.height).toBeGreaterThan(before.height)
  expect(Math.abs(after.height - (before.height + 32))).toBeLessThan(2)
  expect(Math.abs(after.width - before.width)).toBeLessThan(1)
})

test('renaming a header, the title, and clearing a range with Delete', async ({ page }) => {
  await addTable(page)
  await page.keyboard.type('a')
  await page.keyboard.press('Tab')
  await page.keyboard.type('b')
  await page.keyboard.press('Tab')
  await page.keyboard.type('c')
  await page.keyboard.press('Enter')
  await page.keyboard.press(`${MOD}+ArrowUp`)
  expect(await activeCell(page)).toEqual({ row: -1, col: 2 })
  await page.keyboard.type('Remarks')
  await page.keyboard.press('Enter')
  expect((await grid(page))[0]).toEqual(['Name', 'Treats', 'Remarks'])
  // Up from the header is the title.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.type('Pack')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('table-title')).toHaveText('Pack')
  // Enter on the title goes to the first cell.
  expect(await activeCell(page)).toEqual({ row: 0, col: 0 })
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.press('Delete')
  expect((await grid(page)).slice(1)).toEqual([['', '', ''], ['', '', ''], ['', '', '']])
  await page.keyboard.press(`${MOD}+z`)
  expect((await grid(page))[1]).toEqual(['a', 'b', 'c'])
})

test('rows and columns are added and deleted from the bar menu', async ({ page }) => {
  await addTable(page)
  await page.keyboard.type('keep')
  await page.keyboard.press('Enter')
  // The bar holds the cell actions only: Bold, Align, Fill and the menu for everything else.
  const bar = page.getByTestId('selection-bar')
  await expect(bar.getByTestId('table-bar')).toBeVisible()
  expect((await bar.boundingBox())!.width).toBeLessThanOrEqual(220)
  await bar.getByTestId('table-more').click()
  await page.getByTestId('table-menu-row-below').click()
  await expect(bodyRows(page)).toHaveCount(4)
  expect(await activeCell(page)).toEqual({ row: 2, col: 0 })
  await bar.getByTestId('table-more').click()
  await page.getByTestId('table-row-above').click()
  await expect(bodyRows(page)).toHaveCount(5)
  await page.keyboard.press('Shift+ArrowDown')
  await bar.getByTestId('table-more').click()
  await expect(page.getByTestId('table-delete-rows')).toHaveText('Delete 2 rows')
  await page.getByTestId('table-delete-rows').click()
  await expect(bodyRows(page)).toHaveCount(3)
  await bar.getByTestId('table-more').click()
  await page.getByTestId('table-column-left').click()
  await expect(headerCells(page)).toHaveCount(4)
  await bar.getByTestId('table-more').click()
  await page.getByTestId('table-delete-columns').click()
  await expect(headerCells(page)).toHaveCount(3)
  expect((await grid(page))[0]).toEqual(['Name', 'Treats', 'Notes'])
  expect((await grid(page))[1]![0]).toBe('keep')
})

test('undo and redo step through table actions', async ({ page }) => {
  await addTable(page)
  await page.keyboard.type('one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  await page.keyboard.press('Enter')
  expect((await grid(page)).slice(1).map((r) => r[0])).toEqual(['one', 'two', ''])
  await page.keyboard.press(`${MOD}+z`)
  expect((await grid(page)).slice(1).map((r) => r[0])).toEqual(['one', '', ''])
  await page.keyboard.press(`${MOD}+z`)
  expect((await grid(page)).slice(1).map((r) => r[0])).toEqual(['', '', ''])
  await page.keyboard.press(`${MOD}+Shift+z`)
  await page.keyboard.press(`${MOD}+Shift+z`)
  expect((await grid(page)).slice(1).map((r) => r[0])).toEqual(['one', 'two', ''])
})

test('the table survives a reload, and clicking a selected table edits the cell under the pointer', async ({ page }) => {
  await addTable(page)
  await page.keyboard.type('Rex')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Bacon')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await waitForSync(page)
  await page.reload()
  await expect(table(page)).toBeVisible()
  expect((await grid(page)).slice(1)[0]).toEqual(['Rex', 'Bacon', ''])
  await clickEmpty(page)
  // First click selects; the second edits the cell that was clicked.
  await cell(page, 1, 1).click()
  await expect(table(page)).toHaveClass(/selected/)
  await expect(input(page)).toHaveCount(0)
  await cell(page, 1, 1).click()
  await expect(input(page)).toBeVisible()
  expect(await activeCell(page)).toEqual({ row: 1, col: 1 })
  // The card does not move or change height as it opens for editing.
  await cell(page, 0, 1).dblclick()
  await expect(input(page)).toHaveValue('Bacon')
})

test('dragging across cells selects a range, and the same card height holds in edit mode', async ({ page }) => {
  const card = await addTable(page)
  await page.keyboard.type('x')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  const rest = (await card.boundingBox())!
  await card.click()
  await card.click({ position: { x: 100, y: 90 } })
  const editing = (await card.boundingBox())!
  expect(Math.abs(editing.height - rest.height)).toBeLessThan(1)
  const a = (await cell(page, 0, 0).boundingBox())!, b = (await cell(page, 1, 1).boundingBox())!
  await page.mouse.move(a.x + 20, a.y + 10)
  await page.mouse.down()
  await page.mouse.move(b.x + 20, b.y + 10, { steps: 6 })
  await page.mouse.up()
  const range = (await page.getByTestId('table-range').boundingBox())!
  expect(Math.abs(range.height - (a.height + b.height))).toBeLessThan(2)
  await page.keyboard.press('Shift+ArrowRight')
  const wider = (await page.getByTestId('table-range').boundingBox())!
  expect(wider.width).toBeGreaterThan(range.width)
})

test('a new table left untouched disappears when you leave it', async ({ page }) => {
  await addTable(page)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-type=table]')).toHaveCount(0)
  // One with something in it stays.
  await addTable(page)
  await page.keyboard.type('x')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-type=table]')).toHaveCount(1)
})

test('zoomed out, a table is drawn on the overview canvas and has no DOM', async ({ page }) => {
  await addTable(page)
  await page.keyboard.type('Rex')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 80)
  await page.keyboard.up('Control')
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  await expect(page.locator('[data-type=table]')).toHaveCount(0)
  await expect(page.getByTestId('table-grid')).toHaveCount(0)
  // Something was drawn: not every pixel is clear.
  const painted = await page.getByTestId('lod-layer').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < data.length; i += 4) if (data[i]) return true
    return false
  })
  expect(painted).toBe(true)
})

test('a brand-new table shows one quiet hint outside the card, gone at the first change and never again', async ({ page }) => {
  const card = await addTable(page)
  const hint = page.getByTestId('table-hint')
  await expect(hint).toBeVisible()
  await expect(hint).toHaveText('Type to fill · Tab for the next cell · drag ⋮⋮ to reorder')
  // Muted 12px, below the card and its "+ row" pill, and the card does not grow to make room.
  const box = (await card.boundingBox())!, h = (await hint.boundingBox())!, pill = (await page.getByTestId('table-add-row').boundingBox())!
  expect(h.y).toBeGreaterThanOrEqual(box.y + box.height)
  expect(h.y).toBeGreaterThanOrEqual(pill.y + pill.height - 1)
  expect(await hint.evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px')
  expect(await hint.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
  // The card does not grow to make room: taking the hint away changes nothing.
  await hint.evaluate((el) => { (el as HTMLElement).style.display = 'none' })
  expect(Math.abs((await card.boundingBox())!.height - box.height)).toBeLessThan(0.5)
  await hint.evaluate((el) => { (el as HTMLElement).style.display = '' })
  // It is only a hint: moving around does not end it, filling a cell does.
  await page.keyboard.press('ArrowRight')
  await expect(hint).toBeVisible()
  await page.keyboard.type('Rex')
  await page.keyboard.press('Enter')
  await expect(hint).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  // Seen: not again, for this table or the next, or after a reload.
  await addTable(page)
  await expect(page.getByTestId('table-hint')).toHaveCount(0)
  await page.reload()
  await expect(table(page)).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('doggynote.tableHint'))).toBe('3')
})

test('someone who never fills a new table sees the hint three times, and an old table never shows it', async ({ page }) => {
  for (let i = 0; i < 4; i++) {
    await addTable(page)
    await expect(page.getByTestId('table-hint')).toHaveCount(i < 3 ? 1 : 0)
    // Left alone, the table is discarded.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-type=table]')).toHaveCount(0)
  }
  await page.evaluate(() => localStorage.removeItem('doggynote.tableHint'))
  // A table that was not just made has nothing to teach.
  await addTable(page)
  await page.keyboard.type('Rex')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.evaluate(() => localStorage.removeItem('doggynote.tableHint'))
  await cell(page, 0, 0).click()
  await cell(page, 0, 0).click()
  await expect(input(page)).toBeFocused()
  await expect(page.getByTestId('table-hint')).toHaveCount(0)
})
