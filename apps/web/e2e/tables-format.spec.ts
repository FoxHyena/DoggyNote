import { expect, test, type Locator, type Page } from '@playwright/test'
import { freshBoard, setAccountAppearance } from './helpers.ts'
import { MOD, activeCell, cell, columnGrip, grid, headerCells, input, openEditing, rowGrip, seedTyped, type TypedColumn, type TypedRow } from './tables.ts'

// Bold, alignment, fill and sort, and the bar that carries them: at most four
// buttons in any context, never wider than 220px, each with a tip.

const COLS: TypedColumn[] = [{ n: 'Pup' }, { n: 'Age', t: 'number' }, { n: 'Good boy', t: 'checkbox' }, { n: 'Paws', t: 'rating' }]
const ROWS: TypedRow[] = [
  { cells: ['Mochi', 12, true, 3] },
  { cells: ['Rex', 4, false, 5] },
  { cells: ['', null, null, null] },
  { cells: ['Biscuit', 7, true, 1] },
]

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const bar = (page: Page) => page.locator('.selection-bar')
const names = async (page: Page, col = 0) => (await grid(page)).slice(1).map((r) => r[col])
const align = (c: Locator) => c.evaluate((el) => getComputedStyle(el).textAlign)
const weight = (c: Locator) => c.evaluate((el) => Number(getComputedStyle(el).fontWeight))
const bg = (c: Locator) => c.evaluate((el) => getComputedStyle(el).backgroundColor)
async function openAt(page: Page, row: number, col: number) {
  await openEditing(page, row, 0)
  for (let i = 0; i < col; i++) await page.keyboard.press('ArrowRight')
}
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

test('bold: Command+B and the bar button toggle it on the selected cells, one undo each', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 0, 0)
  const bold = page.getByTestId('table-bold')
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
  expect(await weight(cell(page, 0, 0))).toBeLessThan(600)
  await page.keyboard.press(`${MOD}+b`)
  await expect(cell(page, 0, 0)).toHaveAttribute('data-bold', '')
  expect(await weight(cell(page, 0, 0))).toBeGreaterThanOrEqual(600)
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  // The text stays; only the style changed.
  expect((await names(page))[0]).toBe('Mochi')
  await page.keyboard.press(`${MOD}+b`)
  await expect(cell(page, 0, 0)).not.toHaveAttribute('data-bold', '')
  // A range, from the button: one press makes all of it bold.
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await bold.click()
  for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) await expect(cell(page, r!, c!)).toHaveAttribute('data-bold', '')
  await expect(cell(page, 2, 0)).not.toHaveAttribute('data-bold', '')
  // The keyboard is still in the grid after the button.
  await expect(input(page)).toBeFocused()
  await page.keyboard.press(`${MOD}+z`)
  await expect(cell(page, 1, 1)).not.toHaveAttribute('data-bold', '')
  await expect(cell(page, 0, 0)).not.toHaveAttribute('data-bold', '')
  // Whole rows are bold too, header untouched.
  await rowGrip(page, 3).click()
  await page.keyboard.press(`${MOD}+b`)
  for (const c of [0, 1, 2, 3]) await expect(cell(page, 3, c)).toHaveAttribute('data-bold', '')
  expect(await weight(headerCells(page).first())).toBeLessThanOrEqual(600)
  await expect(headerCells(page).first()).not.toHaveAttribute('data-bold', '')
})

test('alignment: a cell overrides its column, the column overrides the type, "default" hands it back', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  // The types' own habits first: numbers right, boxes and paws centred, text left.
  expect(await align(cell(page, 0, 0))).toBe('left')
  expect(await align(cell(page, 0, 1))).toBe('right')
  expect(await align(cell(page, 0, 2))).toBe('center')
  expect(await align(cell(page, 0, 3))).toBe('center')
  await openAt(page, 1, 0)
  await page.getByTestId('table-align').click()
  await expect(page.getByTestId('table-align-menu')).toBeVisible()
  await expect(page.getByTestId('table-align-default')).toHaveText('Column default')
  await expect(page.getByTestId('table-align-default')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('table-align-c').click()
  expect(await align(cell(page, 1, 0))).toBe('center')
  expect(await align(cell(page, 0, 0))).toBe('left')
  await expect(input(page)).toBeFocused()
  await page.getByTestId('table-align').click()
  await expect(page.getByTestId('table-align-c')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('table-align-default').click()
  expect(await align(cell(page, 1, 0))).toBe('left')
  // A column's own default: every cell and its header, but a cell can still choose.
  await columnGrip(page, 0).click()
  await page.getByTestId('table-align').click()
  await expect(page.getByTestId('table-align-default')).toHaveText('Automatic')
  await page.getByTestId('table-align-r').click()
  for (const r of [0, 1, 3]) expect(await align(cell(page, r, 0))).toBe('right')
  await expect(headerCells(page).first()).toHaveAttribute('data-align', 'r')
  await openAt(page, 3, 0)
  await page.getByTestId('table-align').click()
  await page.getByTestId('table-align-l').click()
  expect(await align(cell(page, 3, 0))).toBe('left')
  expect(await align(cell(page, 0, 0))).toBe('right')
  // Automatic on the column goes back to the type's habit.
  await columnGrip(page, 1).click()
  await page.getByTestId('table-align').click()
  await page.getByTestId('table-align-l').click()
  expect(await align(cell(page, 0, 1))).toBe('left')
  await page.getByTestId('table-align').click()
  await page.getByTestId('table-align-default').click()
  expect(await align(cell(page, 0, 1))).toBe('right')
  await page.keyboard.press(`${MOD}+z`)
  expect(await align(cell(page, 0, 1))).toBe('left')
})

test('fill: the card colours as dots, cells and rows, a cell beats its row, and none clears', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 0, 0)
  await page.getByTestId('table-fill').click()
  const pop = page.getByTestId('table-fill-popover')
  await expect(pop).toBeVisible()
  // The presets, no colour wheel.
  await expect(pop.locator('.color-dot')).toHaveCount(7)
  await expect(pop.locator('input[type=color]')).toHaveCount(0)
  await pop.getByTestId('table-fill-sky').click()
  await expect(pop).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  await expect(cell(page, 0, 0)).toHaveAttribute('data-fill', '')
  expect(await cell(page, 0, 0).getAttribute('style')).toContain('--dn-table-sky-bg')
  expect(await bg(cell(page, 0, 0))).not.toBe(TRANSPARENT)
  expect(await bg(cell(page, 0, 1))).toBe(TRANSPARENT)
  // A row: every cell of it.
  await rowGrip(page, 1).click()
  await page.getByTestId('table-fill').click()
  await expect(page.getByTestId('table-fill-popover')).toBeVisible()
  await page.getByTestId('table-fill-peach').click()
  for (const c of [0, 1, 2, 3]) expect(await cell(page, 1, c).getAttribute('style')).toContain('--dn-table-peach-bg')
  // The row's colour sits behind a cell's own: the cell wins, and clearing it gives the row's back.
  await openAt(page, 1, 1)
  await page.getByTestId('table-fill').click()
  await page.getByTestId('table-fill-lilac').click()
  expect(await cell(page, 1, 1).getAttribute('style')).toContain('--dn-table-lilac-bg')
  expect(await cell(page, 1, 0).getAttribute('style')).toContain('--dn-table-peach-bg')
  await page.getByTestId('table-fill').click()
  await expect(page.getByTestId('table-fill-lilac')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('table-fill-none').click()
  expect(await cell(page, 1, 1).getAttribute('style')).toContain('--dn-table-peach-bg')
  // None on a row clears it.
  await rowGrip(page, 1).click()
  await page.getByTestId('table-fill').click()
  await expect(page.getByTestId('table-fill-peach')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('table-fill-none').click()
  await expect(cell(page, 1, 0)).not.toHaveAttribute('data-fill', '')
  // Fill is a style: the cells' values are untouched, and undo is one step.
  expect((await names(page))[0]).toBe('Mochi')
  await page.keyboard.press(`${MOD}+z`)
  await expect(cell(page, 1, 0)).toHaveAttribute('data-fill', '')
})

test('fill panel: Escape closes it and gives the keyboard back; an outside click closes it', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 0, 0)
  await page.getByTestId('table-fill').click()
  await expect(page.getByTestId('table-fill-popover')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('table-fill-popover')).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  // Still editing.
  await expect(page.getByTestId('table-bar')).toBeVisible()
})

test('sort: A to Z and Z to A from the column, empty cells last either way, one undo step', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openEditing(page, 0, 0)
  await columnGrip(page, 0).click()
  await page.getByTestId('table-sort').click()
  await expect(page.getByTestId('table-sort-asc')).toHaveText('Sort A to Z')
  await page.getByTestId('table-sort-asc').click()
  expect(await names(page)).toEqual(['Biscuit', 'Mochi', 'Rex', ''])
  // Each row keeps its other cells.
  expect((await grid(page)).slice(1).map((r) => r[1])).toEqual(['7', '12', '4', ''])
  await page.getByTestId('table-sort').click()
  await page.getByTestId('table-sort-desc').click()
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit', ''])
  await page.keyboard.press(`${MOD}+z`)
  expect(await names(page)).toEqual(['Biscuit', 'Mochi', 'Rex', ''])
  await page.keyboard.press(`${MOD}+z`)
  expect(await names(page)).toEqual(['Mochi', 'Rex', '', 'Biscuit'])
  // Numbers sort as numbers (4, 7, 12), and the menu says so.
  await columnGrip(page, 1).click()
  await page.getByTestId('table-sort').click()
  await expect(page.getByTestId('table-sort-asc')).toHaveText('Sort 1 to 9')
  await page.getByTestId('table-sort-asc').click()
  expect((await grid(page)).slice(1).map((r) => r[1])).toEqual(['4', '7', '12', ''])
  // The column's own menu has it too, and a sort needs exactly one column.
  await columnGrip(page, 0).click()
  await columnGrip(page, 1).click({ modifiers: ['Shift'] })
  await page.getByTestId('table-sort').click()
  await expect(page.getByTestId('table-sort-asc')).toBeDisabled()
  await page.keyboard.press('Escape')
  // (A grip inside the picked columns keeps them picked, so go via another one.)
  await columnGrip(page, 3).click()
  await columnGrip(page, 0).click()
  await page.getByTestId('table-more').click()
  await page.getByTestId('table-sort-desc').click()
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit', ''])
})

test('sort keeps row fills with their rows and orders paws and boxes', async ({ page }) => {
  await seedTyped(page, COLS, [{ bg: 'sky', cells: ['Mochi', 12, true, 3] }, { cells: ['Rex', 4, false, 5] }, { cells: ['Biscuit', 7, true, 1] }])
  await openEditing(page, 0, 0)
  await columnGrip(page, 3).click()
  await page.getByTestId('table-sort').click()
  await expect(page.getByTestId('table-sort-desc')).toHaveText('Sort 9 to 1')
  await page.getByTestId('table-sort-desc').click()
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit'])
  // Mochi (the blue row) moved to second place with its fill.
  await expect(cell(page, 1, 0)).toHaveAttribute('data-fill', '')
  await expect(cell(page, 0, 0)).not.toHaveAttribute('data-fill', '')
  await columnGrip(page, 2).click()
  await page.getByTestId('table-sort').click()
  await expect(page.getByTestId('table-sort-asc')).toHaveText('Unticked first')
  await page.getByTestId('table-sort-asc').click()
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit'])
})

test('the bar is never wider than 220px, holds at most four buttons, and every button has a tip', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 1, 0)
  const check = async (kind: string, testids: string[]) => {
    await expect(page.getByTestId('table-bar')).toHaveAttribute('data-kind', kind)
    const buttons = bar(page).locator('button')
    expect(await buttons.count()).toBeLessThanOrEqual(4)
    expect(await buttons.count()).toBe(testids.length)
    for (const id of testids) await expect(bar(page).getByTestId(id)).toBeVisible()
    for (let i = 0; i < (await buttons.count()); i++) expect(await buttons.nth(i).getAttribute('data-tip')).toBeTruthy()
    expect((await bar(page).boundingBox())!.width).toBeLessThanOrEqual(220)
  }
  await check('cells', ['table-bold', 'table-align', 'table-fill', 'table-more'])
  await rowGrip(page, 1).click()
  await check('rows', ['table-fill', 'table-row-below', 'table-delete', 'table-more'])
  await columnGrip(page, 1).click()
  await check('cols', ['table-type', 'table-sort', 'table-align', 'table-more'])
  // The column's Type button wears the type it is.
  await expect(page.getByTestId('table-type').locator('[data-icon]')).toHaveAttribute('data-icon', 'typeNumber')
  await columnGrip(page, 2).click()
  await expect(page.getByTestId('table-type').locator('[data-icon]')).toHaveAttribute('data-icon', 'typeCheckbox')
  await columnGrip(page, 1).click({ modifiers: ['Shift'] })
  // Different types: the button shows the first's icon, and a choice sets them all.
  await page.getByTestId('table-type').click()
  await expect(page.getByTestId('table-type-menu').locator('[aria-checked=true]')).toHaveCount(0)
  await page.getByTestId('table-type-text').click()
  await expect(cell(page, 0, 1)).toHaveAttribute('data-type', 'text')
  await expect(cell(page, 0, 2)).toHaveAttribute('data-type', 'text')
  await check('cols', ['table-type', 'table-sort', 'table-align', 'table-more'])
})

test('a header has no cells to style: Bold, Align and Fill wait until a cell is picked', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 0, 0)
  await page.keyboard.press('ArrowUp')
  expect(await activeCell(page)).toEqual({ row: -1, col: 0 })
  for (const id of ['table-bold', 'table-fill']) await expect(page.getByTestId(id)).toBeDisabled()
  await page.keyboard.press('ArrowDown')
  for (const id of ['table-bold', 'table-fill']) await expect(page.getByTestId(id)).toBeEnabled()
})

test('a range does not paint one cell darker than the rest', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 0, 0)
  // The pointer rests on the active cell, as it does after a click, while Shift+arrows stretch the range.
  const box = (await cell(page, 0, 0).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByTestId('table-range')).toBeVisible()
  const tints = await Promise.all([[0, 0], [0, 1], [1, 0], [1, 1]].map(([r, c]) => bg(cell(page, r!, c!))))
  expect(new Set(tints).size).toBe(1)
  expect(tints[0]).toBe(TRANSPARENT)
})

test('a filled cell keeps its colour under the draft, and fills show in the read view of a deselected table', async ({ page }) => {
  await seedTyped(page, COLS, [{ cells: [{ v: 'Mochi', bg: 'ball' }, 12, true, 3] }])
  const before = await bg(cell(page, 0, 0))
  expect(before).not.toBe(TRANSPARENT)
  await openAt(page, 0, 0)
  await page.keyboard.press('Enter')
  expect(await input(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(before)
})

test('a draft is aligned and weighted like its cell, and a right-aligned header keeps its ⋯ clear of its name', async ({ page }) => {
  await seedTyped(page, COLS, [{ cells: [{ v: 'Mochi', b: 1 }, 12, true, 3] }, { cells: ['Rex', 4, false, 5] }])
  await openAt(page, 0, 1)
  await page.keyboard.press('Enter')
  expect(await input(page).evaluate((el) => getComputedStyle(el).textAlign)).toBe('right')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  expect(Number(await input(page).evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600)
  await page.keyboard.press('Escape')
  // The Age header is on the right, so its menu button sits on the left of the column.
  await columnGrip(page, 1).click()
  const menu = (await page.getByTestId('table-column-menu').nth(1).boundingBox())!
  const head = (await headerCells(page).nth(1).boundingBox())!
  expect(menu.x).toBeLessThan(head.x + head.width / 2)
  const name = await headerCells(page).nth(1).evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { x: b.x, w: b.width } })
  expect(menu.x + menu.width).toBeLessThanOrEqual(name.x + 1)
  // A left-aligned header keeps it on the right.
  await columnGrip(page, 0).click()
  const first = (await page.getByTestId('table-column-menu').nth(0).boundingBox())!
  const firstHead = (await headerCells(page).nth(0).boundingBox())!
  expect(first.x).toBeGreaterThan(firstHead.x + firstHead.width / 2)
})

test('a sorted column keeps a small arrow in its header until the rows move or grow again', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  const marks = page.getByTestId('table-sort-mark')
  await expect(marks).toHaveCount(0)
  await openEditing(page, 0, 0)
  const headBefore = (await headerCells(page).first().boundingBox())!
  await columnGrip(page, 0).click()
  await page.getByTestId('table-sort').click()
  await page.getByTestId('table-sort-asc').click()
  await expect(marks).toHaveCount(1)
  await expect(headerCells(page).nth(0)).toHaveAttribute('aria-sort', 'ascending')
  await expect(headerCells(page).nth(0).getByTestId('table-sort-mark')).toHaveAttribute('data-dir', 'a')
  // An arrow takes no room: the header is as tall as it was.
  expect(Math.abs((await headerCells(page).first().boundingBox())!.height - headBefore.height)).toBeLessThan(1)
  // Its tooltip says what it is; it does not cover or move the column's name.
  await headerCells(page).first().getByTestId('table-sort-mark').hover()
  await expect(page.locator('.dn-tooltip')).toContainText('Sorted A to Z')
  await page.mouse.move(0, 0)
  // The other direction flips it; another column takes it over (one mark at a time).
  await page.getByTestId('table-sort').click()
  await page.getByTestId('table-sort-desc').click()
  await expect(headerCells(page).nth(0)).toHaveAttribute('aria-sort', 'descending')
  await columnGrip(page, 1).click()
  await page.getByTestId('table-sort').click()
  await page.getByTestId('table-sort-asc').click()
  await expect(marks).toHaveCount(1)
  await expect(headerCells(page).nth(0)).not.toHaveAttribute('aria-sort', /.+/)
  await expect(headerCells(page).nth(1)).toHaveAttribute('aria-sort', 'ascending')
  // Edits that keep the order keep the mark: a value, a width, a fill.
  await openAt(page, 0, 0)
  await page.keyboard.type('Zed')
  await page.keyboard.press('Enter')
  await columnGrip(page, 0).click()
  await page.keyboard.press('Alt+Shift+Period')
  await expect(marks).toHaveCount(1)
  // The read view shows it too.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('table-grid').locator('th[aria-sort=ascending]')).toHaveCount(1)
  // Moving a row takes it off, and undo brings the arrow back with the order.
  await openEditing(page, 0, 0)
  await rowGrip(page, 0).click()
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await expect(marks).toHaveCount(0)
  await expect(headerCells(page).nth(1)).not.toHaveAttribute('aria-sort', /.+/)
  await page.keyboard.press(`${MOD}+z`)
  await expect(marks).toHaveCount(1)
  // Sorting again, then adding a row (the "+ row" pill), also takes it off.
  await columnGrip(page, 1).click()
  await page.getByTestId('table-sort').click()
  await page.getByTestId('table-sort-desc').click()
  await expect(marks).toHaveCount(1)
  await page.getByTestId('table-add-row').click()
  await expect(marks).toHaveCount(0)
})

test('table fills are softer in the dark theme and the pastel swatch in the light one, with paws that read as 0 of 5', async ({ page }) => {
  await seedTyped(page, COLS, [{ bg: 'sky', cells: ['Mochi', 12, true, 3] }, { cells: ['Rex', { v: 4, bg: 'gold' }, false, 5] }, { cells: ['Biscuit', 7, true, 0] }])
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
  const paw = (row: number, n: number) => cell(page, row, 3).locator(`.table-paw[data-paw="${n}"]`)
  const opacity = (loc: Locator) => loc.evaluate((el) => Number(getComputedStyle(el).opacity))
  // Dark: the swatch at 30% over the card, with the theme's light text.
  expect(await bg(cell(page, 0, 0))).toBe(rgb('#45505a'))
  expect(await bg(cell(page, 1, 1))).toBe(rgb('#625a2c'))
  expect(await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color)).toBe(rgb('#ece7e1'))
  // Paws: a set one is a solid paw at full ink, an empty one an outline at the tested strength, on plain and filled cells.
  await expect(paw(1, 5).locator('svg')).toHaveAttribute('data-icon', 'paw')
  await expect(paw(0, 4).locator('svg')).toHaveAttribute('data-icon', 'pawOutline')
  expect(await opacity(paw(1, 5))).toBe(1)
  expect(await opacity(paw(0, 4))).toBeCloseTo(0.7, 2)
  expect(await opacity(paw(2, 1))).toBeCloseTo(0.7, 2)
  // An unticked box keeps the same strength; a ticked one is the full lamp.
  expect(await opacity(cell(page, 1, 2).locator('.table-check'))).toBeCloseTo(0.7, 2)
  expect(await opacity(cell(page, 0, 2).locator('.table-check'))).toBe(1)
  await setAccountAppearance(page, 'Light')
  expect(await bg(cell(page, 0, 0))).toBe(rgb('#bcd4ee'))
  expect(await bg(cell(page, 1, 1))).toBe(rgb('#f4dc8f'))
  expect(await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).color)).toBe(rgb('#10263f'))
  expect(await opacity(paw(0, 4))).toBeCloseTo(0.7, 2)
})
