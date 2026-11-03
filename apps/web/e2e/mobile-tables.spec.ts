import { expect, test } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'
import { closeKeyboard, fakeKeyboard, seedCards, tap, tapOn } from './touch.ts'
import { activeCell, cell, grid, headerCells, input, table, tableFields } from './tables.ts'

// Phones: a table is tapped to select, tapped again to edit, and walked with the
// dock's ‹ › (the keyboard has no Tab). The field is 16px so iOS never zooms,
// but the card's own text keeps its size.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
  const { fields } = tableFields(['Pup', 'Treat', 'Age'], [['Rex', 'Bacon', '4'], ['Mochi', 'Cheese', '7'], ['', '', '']])
  // Clear of the left edge, so the row grips outside the card are on screen.
  await seedCards(page, [{ type: 'table', x: 70, y: 140, w: 300, content: { title: 'The pack' }, fields }])
})

test('a tap selects the table, a second tap edits the cell under the finger and opens the dock', async ({ page }) => {
  await tapOn(page, cell(page, 1, 1), { x: 20, y: 10 })
  await expect(table(page)).toHaveClass(/selected/)
  await expect(input(page)).toHaveCount(0)
  await expect(page.getByTestId('table-dock')).toHaveCount(0)
  await tapOn(page, cell(page, 1, 1), { x: 20, y: 10 })
  await expect(input(page)).toBeFocused()
  await expect(page.getByTestId('table-dock')).toBeVisible()
  expect(await activeCell(page)).toEqual({ row: 1, col: 1 })
  // 16px so iOS doesn't zoom, scaled to the card's 14px; the card's own text is untouched.
  const field = await input(page).evaluate((el) => { const s = getComputedStyle(el); return { size: s.fontSize, scale: new DOMMatrix(s.transform).a } })
  expect(field.size).toBe('16px')
  expect(field.scale).toBeCloseTo(0.875, 3)
  expect(await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px')
})

test('the dock walks the cells without closing the keyboard, and › on the last cell adds a row', async ({ page }) => {
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await expect(input(page)).toBeFocused()
  await page.keyboard.type('Rexy')
  const next = page.getByTestId('dock-next')
  await next.tap()
  await expect(input(page)).toBeFocused()
  expect(await activeCell(page)).toEqual({ row: 0, col: 1 })
  expect((await grid(page))[1]![0]).toBe('Rexy')
  await page.getByTestId('dock-prev').tap()
  expect(await activeCell(page)).toEqual({ row: 0, col: 0 })
  // Walk to the very last cell, then one more.
  for (let i = 0; i < 8; i++) await next.tap()
  expect(await activeCell(page)).toEqual({ row: 2, col: 2 })
  await next.tap()
  await expect(table(page).locator('tbody tr')).toHaveCount(4)
  expect(await activeCell(page)).toEqual({ row: 3, col: 0 })
  await waitForSync(page)
  await page.reload()
  await expect(table(page)).toBeVisible()
  expect((await grid(page))[1]![0]).toBe('Rexy')
  expect(await table(page).locator('tbody tr').count()).toBe(4)
})

test('the active cell stays above the keyboard, and the dock fits a 360px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await fakeKeyboard(page, true)
  const next = page.getByTestId('dock-next')
  for (let i = 0; i < 7; i++) await next.tap()
  expect(await activeCell(page)).toEqual({ row: 2, col: 1 })
  await expect.poll(async () => {
    const box = await input(page).boundingBox()
    const dock = await page.getByTestId('edit-dock').boundingBox()
    const view = await page.evaluate(() => visualViewport!.height)
    return !!box && !!dock && box.y >= 0 && box.y + box.height <= Math.min(dock.y, view)
  }).toBe(true)
  const dock = (await page.getByTestId('edit-dock').boundingBox())!
  expect(dock.x).toBeGreaterThanOrEqual(0)
  expect(dock.x + dock.width).toBeLessThanOrEqual(360)
  for (const id of ['dock-prev', 'dock-next', 'dock-table-more']) {
    const b = (await page.getByTestId(id).boundingBox())!
    expect(b.width).toBeGreaterThan(43.9)
    expect(b.height).toBeGreaterThan(43.9)
    expect(b.x + b.width).toBeLessThanOrEqual(360)
  }
})

test('the dock menu inserts a row, and tapping a cell then the same cell edits it in place', async ({ page }) => {
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await page.getByTestId('dock-table-more').tap()
  await page.getByTestId('table-menu-row-below').tap()
  await expect(table(page).locator('tbody tr')).toHaveCount(4)
  expect(await activeCell(page)).toEqual({ row: 1, col: 0 })
  // The edit is still going on: the table is not closed by the menu.
  await expect(table(page)).toHaveClass(/editing/)
  // A tap on another cell selects it; a tap on the selected one edits it in place.
  await tapOn(page, cell(page, 2, 0), { x: 20, y: 10 })
  expect(await activeCell(page)).toEqual({ row: 2, col: 0 })
  await expect(input(page)).toHaveValue('')
  await tapOn(page, cell(page, 2, 0), { x: 20, y: 10 })
  await expect(input(page)).toHaveValue('Mochi')
  await closeKeyboard(page)
  await expect(table(page)).not.toHaveClass(/editing/)
  expect((await grid(page))[3]![0]).toBe('Mochi')
})

test('"+ row" and "+ column" are finger-sized', async ({ page }) => {
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  // The board glides to bring the cell above the keyboard: measure once it has settled.
  await page.waitForTimeout(500)
  expect((await page.getByTestId('table-add-row').boundingBox())!.height).toBeGreaterThan(43.9)
  expect((await page.getByTestId('table-add-column').boundingBox())!.width).toBeGreaterThan(43.9)
  await tap(page, await page.getByTestId('table-add-row').boundingBox().then((b) => ({ x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 })))
  await expect(table(page).locator('tbody tr')).toHaveCount(4)
})

test('the dock is laid out in three places: ‹ › left, the selection\'s buttons in the middle, ⋯ right', async ({ page }) => {
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  const dock = (await page.getByTestId('table-dock').boundingBox())!
  const prev = (await page.getByTestId('dock-prev').boundingBox())!
  const next = (await page.getByTestId('dock-next').boundingBox())!
  const more = (await page.getByTestId('dock-table-more').boundingBox())!
  // 12px gutters, ‹ › together on the left, ⋯ against the right edge.
  expect(prev.x - dock.x).toBeGreaterThanOrEqual(11.5)
  expect(next.x).toBeGreaterThan(prev.x)
  expect(next.x - (prev.x + prev.width)).toBeLessThanOrEqual(9)
  expect(dock.x + dock.width - (more.x + more.width)).toBeGreaterThanOrEqual(11.5)
  expect(dock.x + dock.width - (more.x + more.width)).toBeLessThanOrEqual(14)
  expect(more.x - (next.x + next.width)).toBeGreaterThan(100)
  await expect(page.getByTestId('dock-slots')).toHaveCount(1)
})

test('a row grip selects the row and the dock shows its buttons; the column ⋯ opens a sheet', async ({ page }) => {
  await tapOn(page, cell(page, 1, 0), { x: 20, y: 10 })
  await tapOn(page, cell(page, 1, 0), { x: 20, y: 10 })
  await page.waitForTimeout(400)
  await page.getByTestId('table-row-grip').nth(1).tap()
  await expect(page.getByTestId('table-dock')).toHaveAttribute('data-kind', 'rows')
  await expect(page.getByTestId('dock-row-below')).toBeVisible()
  expect((await page.getByTestId('dock-row-below').boundingBox())!.width).toBeGreaterThan(43.9)
  await page.getByTestId('dock-row-below').tap()
  await expect(table(page).locator('tbody tr')).toHaveCount(4)
  // A column header on a phone: tap it, and its ⋯ shows (the grips above may sit under the top bar).
  await tapOn(page, headerCells(page).nth(1), { x: 20, y: 10 })
  await page.waitForTimeout(300)
  await page.getByTestId('table-column-menu').nth(1).tap()
  await expect(page.getByTestId('table-dock')).toHaveAttribute('data-kind', 'cols')
  const sheet = page.getByTestId('table-column-menu-list')
  await expect(sheet).toBeVisible()
  // A bottom sheet on a phone.
  const b = (await sheet.boundingBox())!
  expect(b.y + b.height).toBeGreaterThan((page.viewportSize()!.height) - 4)
  await sheet.getByTestId('table-move-right').tap()
  expect((await grid(page))[0]).toEqual(['Pup', 'Age', 'Treat'])
})
