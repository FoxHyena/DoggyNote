import { expect, test } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'
import { closeKeyboard, fakeKeyboard, seedCards, tap, tapOn } from './touch.ts'
import { activeCell, cell, checkOf, grid, headerCells, input, ratingOf, seedTyped, table, tableFields } from './tables.ts'

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

// ---- column types, formatting and sort on a phone --------------------------------

const TYPED = [{ n: 'Pup' }, { n: 'Done', t: 'checkbox' as const }, { n: 'Status', t: 'select' as const, opts: [['Walked', 'ball'], ['Fed', 'gold']] as [string, 'ball'][] }, { n: 'Paws', t: 'rating' as const }]
const TYPED_ROWS = [
  { cells: ['Rex', true, 'Walked', 4] },
  { cells: ['Mochi', false, 'Fed', 2] },
  { cells: ['Biscuit', null, null, null] },
]
/** A fresh board with a typed table (the file's own seeded table is on the board it left). */
async function typedTable(page: import('@playwright/test').Page, cols = TYPED, rows = TYPED_ROWS) {
  await freshBoard(page)
  return seedTyped(page, cols, rows, { x: 70, y: 140, w: 300 })
}
const centerOf = async (loc: import('@playwright/test').Locator) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
/** Select the table, then tap a cell's left edge again to edit it, clear of any tick or paws. */
async function editCell(page: import('@playwright/test').Page, row: number, col: number) {
  await tapOn(page, cell(page, row, col), { x: 6, y: 10 })
  await tapOn(page, cell(page, row, col), { x: 6, y: 10 })
  await expect(table(page)).toHaveClass(/editing/)
  await page.waitForTimeout(400)
}

test('the dock puts three buttons for the selection in its middle: cells, rows and columns each their own', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await typedTable(page)
  await editCell(page, 0, 0)
  const dock = page.getByTestId('table-dock')
  await expect(dock).toHaveAttribute('data-kind', 'cells')
  const fits = async (ids: string[]) => {
    const d = (await dock.boundingBox())!
    for (const id of ['dock-prev', 'dock-next', ...ids, 'dock-table-more']) {
      const b = (await page.getByTestId(id).boundingBox())!
      expect(b.width, id).toBeGreaterThan(43.9)
      expect(b.height, id).toBeGreaterThan(43.9)
      expect(b.x, id).toBeGreaterThanOrEqual(d.x)
      expect(b.x + b.width, id).toBeLessThanOrEqual(360)
    }
    expect(await page.getByTestId('dock-slots').locator('button').count()).toBe(ids.length)
  }
  await fits(['dock-bold', 'dock-align', 'dock-fill'])
  // Bold acts on the tap and leaves the keyboard where it is.
  await page.getByTestId('dock-bold').tap()
  await expect(cell(page, 0, 0)).toHaveAttribute('data-bold', '')
  await expect(page.getByTestId('dock-bold')).toHaveAttribute('aria-pressed', 'true')
  await expect(input(page)).toBeFocused()
  await page.getByTestId('dock-bold').tap()
  await expect(cell(page, 0, 0)).not.toHaveAttribute('data-bold', '')
  // A row, from its grip: Fill, Insert below, Delete.
  await page.getByTestId('table-row-grip').nth(1).tap()
  await expect(dock).toHaveAttribute('data-kind', 'rows')
  await fits(['dock-fill', 'dock-row-below', 'dock-delete'])
  // A column, from its header's menu: Type, Sort, Align.
  await tapOn(page, page.locator('thead th').nth(0), { x: 6, y: 10 })
  await page.waitForTimeout(300)
  await page.getByTestId('table-column-menu').nth(0).tap()
  await page.keyboard.press('Escape')
  await expect(dock).toHaveAttribute('data-kind', 'cols')
  await fits(['dock-type', 'dock-sort', 'dock-align'])
})

test('Type and Sort open as bottom sheets on a phone, and the table keeps editing under them', async ({ page }) => {
  await typedTable(page)
  await editCell(page, 0, 0)
  await tapOn(page, page.locator('thead th').nth(0), { x: 6, y: 10 })
  await page.waitForTimeout(300)
  await page.getByTestId('table-column-menu').nth(0).tap()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('table-dock')).toHaveAttribute('data-kind', 'cols')
  await page.getByTestId('dock-type').tap()
  const sheet = page.getByTestId('table-type-menu')
  await expect(sheet).toBeVisible()
  const b = (await sheet.boundingBox())!
  expect(b.y + b.height).toBeGreaterThan(page.viewportSize()!.height - 4)
  await sheet.getByTestId('table-type-number').tap()
  await expect(cell(page, 0, 0)).toHaveAttribute('data-type', 'number')
  await expect(table(page)).toHaveClass(/editing/)
  // Sort: Biscuit, Mochi, Rex is A to Z; the numbers-as-text column now sorts as text that can't be read, so use Pup back.
  await page.getByTestId('dock-type').tap()
  await page.getByTestId('table-type-text').tap()
  await page.getByTestId('dock-sort').tap()
  await expect(page.getByTestId('table-sort-menu')).toBeVisible()
  await page.getByTestId('table-sort-asc').tap()
  expect((await grid(page)).slice(1).map((r) => r[0])).toEqual(['Biscuit', 'Mochi', 'Rex'])
})

test('the fill sheet: 32px dots with 44px targets, presets only, and the keyboard is left alone', async ({ page }) => {
  await typedTable(page)
  await editCell(page, 1, 0)
  await page.getByTestId('dock-fill').tap()
  const pop = page.getByTestId('table-fill-popover')
  await expect(pop).toBeVisible()
  const b = (await pop.boundingBox())!
  expect(b.y + b.height).toBeGreaterThan(page.viewportSize()!.height - 4)
  await expect(pop.locator('input[type=color]')).toHaveCount(0)
  const dot = (await pop.getByTestId('table-fill-sky').boundingBox())!
  expect(dot.width).toBeGreaterThanOrEqual(31.9)
  expect(dot.height).toBeGreaterThanOrEqual(31.9)
  // The 44px hit area reaches past the dot.
  const reach = await pop.getByTestId('table-fill-sky').evaluate((el) => { const a = getComputedStyle(el, '::after'); return parseFloat(a.width) })
  expect(reach).toBeGreaterThanOrEqual(43.9)
  await pop.getByTestId('table-fill-sky').tap()
  await expect(pop).toHaveCount(0)
  expect(await cell(page, 1, 0).getAttribute('style')).toContain('--dn-card-sky-bg')
  await expect(table(page)).toHaveClass(/editing/)
  // Whole rows through the row's own Fill.
  await page.getByTestId('table-row-grip').nth(0).tap()
  await page.getByTestId('dock-fill').tap()
  await page.getByTestId('table-fill-peach').tap()
  for (const c of [0, 1, 2, 3]) expect(await cell(page, 0, c).getAttribute('style')).toContain('--dn-card-peach-bg')
})

test('paws and boxes by tap: a tap on a paw sets it, the same paw clears; a selected table ticks on one tap', async ({ page }) => {
  await typedTable(page)
  // Selected but not editing: one tap ticks the box, no keyboard, no edit.
  await tapOn(page, cell(page, 2, 0), { x: 6, y: 10 })
  await expect(table(page)).toHaveClass(/selected/)
  await expect(input(page)).toHaveCount(0)
  await tap(page, await centerOf(checkOf(page, 1, 1)))
  await expect(checkOf(page, 1, 1)).toHaveAttribute('aria-checked', 'true')
  await expect(input(page)).toHaveCount(0)
  // Editing: the field takes no typing for a paw cell.
  await editCell(page, 2, 3)
  await expect(input(page)).toHaveAttribute('inputmode', 'none')
  await tap(page, await centerOf(cell(page, 2, 3).locator('[data-paw="3"]')))
  expect(await ratingOf(page, 2, 3)).toBe(3)
  await tap(page, await centerOf(cell(page, 2, 3).locator('[data-paw="3"]')))
  expect(await ratingOf(page, 2, 3)).toBe(0)
  await tap(page, await centerOf(cell(page, 1, 3).locator('[data-paw="5"]')))
  expect(await ratingOf(page, 1, 3)).toBe(5)
  expect(await activeCell(page)).toEqual({ row: 1, col: 3 })
  // A box, while editing.
  await tap(page, await centerOf(checkOf(page, 2, 1)))
  await expect(checkOf(page, 2, 1)).toHaveAttribute('aria-checked', 'true')
})

test('a tag opens a sheet with a filter box; tapping an option, or Create, chooses it', async ({ page }) => {
  await typedTable(page)
  await editCell(page, 2, 2)
  await expect(input(page)).toHaveAttribute('inputmode', 'none')
  // A tap on the selected cell opens its tags.
  await tapOn(page, cell(page, 2, 2), { x: 6, y: 10 })
  const pop = page.getByTestId('table-select-popover')
  await expect(pop).toBeVisible()
  const b = (await pop.boundingBox())!
  expect(b.y + b.height).toBeGreaterThan(page.viewportSize()!.height - 4)
  await expect(page.getByTestId('table-select-input')).toBeFocused()
  expect(await page.getByTestId('table-select-input').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
  await pop.getByTestId('table-option').first().getByRole('button').tap()
  await expect(pop).toHaveCount(0)
  await expect(cell(page, 2, 2).getByTestId('table-chip')).toHaveText('Walked')
  // A new name.
  await tapOn(page, cell(page, 2, 2), { x: 6, y: 10 })
  await expect(pop).toBeVisible()
  await page.getByTestId('table-select-input').fill('Zoomies')
  await pop.getByTestId('table-option-create').tap()
  await expect(cell(page, 2, 2).getByTestId('table-chip')).toHaveText('Zoomies')
})

test('a date cell: a tap on the selected cell focuses a real date input, and its value is the cell', async ({ page }) => {
  await typedTable(page, [{ n: 'Pup' }, { n: 'Day', t: 'date' as const }], [{ cells: ['Rex', '2019-03-14'] }, { cells: ['Mochi', null] }])
  await editCell(page, 1, 1)
  const wheel = page.getByTestId('table-date')
  await expect(wheel).toHaveCount(1)
  await expect(wheel).not.toBeFocused()
  await tapOn(page, cell(page, 1, 1), { x: 6, y: 10 })
  await expect(wheel).toBeFocused()
  expect(await wheel.evaluate((el) => (el as HTMLInputElement).type)).toBe('date')
  // The native picker is not drivable here; its result is the input's value and a change.
  await wheel.fill('2018-12-25')
  await expect(cell(page, 1, 1)).toHaveText('Dec 25, 2018')
  // The existing date is in the input when its cell is the active one.
  await tapOn(page, cell(page, 0, 1), { x: 6, y: 10 })
  await expect(wheel).toHaveValue('2019-03-14')
  // No on-screen keyboard for a date.
  await expect(input(page)).toHaveAttribute('inputmode', 'none')
})
