import { expect, test, type Page } from '@playwright/test'
import { clickEmpty, freshBoard, waitForSync } from './helpers.ts'
import { MOD, activeCell, cell, checkOf, columnGrip, grid, input, openEditing, ratingOf, seedTyped, table, type TypedColumn, type TypedRow } from './tables.ts'

// Column types: how each one is drawn, typed into, ticked, picked and rated. The
// stored values stay plain (numbers, booleans, YYYY-MM-DD, option ids, 1-5);
// only what is drawn follows the browser's locale.

const COLS: TypedColumn[] = [
  { n: 'Pup' },
  { n: 'Age', t: 'number' },
  { n: 'Good boy', t: 'checkbox' },
  { n: 'Birthday', t: 'date' },
  { n: 'Status', t: 'select', opts: [['Walked', 'ball'], ['Fed', 'gold'], ['Napping', 'sky']] },
  { n: 'Paws', t: 'rating' },
]
const ROWS: TypedRow[] = [
  { cells: ['Rex', 4, true, '2019-03-14', 'Walked', 5] },
  { cells: ['Mochi', 12, false, '2019-11-02', 'Fed', 3] },
  { cells: ['Biscuit', 'lots', true, 'soon', 'Napping', 2] },
  { cells: ['Fido', null, null, null, null, null] },
]
const [PUP, AGE, GOOD, BIRTHDAY, STATUS, PAWS] = [0, 1, 2, 3, 4, 5]

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

/** Edit mode on a body cell, reached by the keyboard so a tick or paw is never clicked by accident. */
async function openAt(page: Page, row: number, col: number) {
  await openEditing(page, row, PUP)
  for (let i = 0; i < col; i++) await page.keyboard.press('ArrowRight')
  expect(await activeCell(page)).toEqual({ row, col })
}
const text = async (page: Page, row: number, col: number) => (await cell(page, row, col).textContent()) ?? ''
const undo = (page: Page) => page.keyboard.press(`${MOD}+z`)

test('numbers sit on the right in tabular figures, group their digits, and keep text they cannot read, muted', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  const age = cell(page, 0, AGE)
  expect(await age.evaluate((el) => getComputedStyle(el).textAlign)).toBe('right')
  expect(await age.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums')
  // Typed in the browser's own habits; stored as a number, drawn grouped.
  await openAt(page, 3, AGE)
  await page.keyboard.type('1,234.5')
  await page.keyboard.press('Enter')
  expect(await text(page, 3, AGE)).toBe('1,234.5')
  // Editing it again starts from the plain number, so typing it back changes nothing.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(input(page)).toHaveValue('1234.5')
  await page.keyboard.press('Escape')
  // Text a number column can't read is kept, drawn quieter, and still editable.
  await page.keyboard.type('a bone')
  await page.keyboard.press('Enter')
  const quiet = cell(page, 3, AGE)
  await expect(quiet).toHaveAttribute('data-muted', '')
  expect(await text(page, 3, AGE)).toBe('a bone')
  const normal = await cell(page, 0, PUP).evaluate((el) => getComputedStyle(el).color)
  expect(await quiet.evaluate((el) => getComputedStyle(el).color)).not.toBe(normal)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(input(page)).toHaveValue('a bone')
  await page.keyboard.press('Escape')
  // The row that already held "lots" shows it muted from the start.
  await expect(cell(page, 2, AGE)).toHaveAttribute('data-muted', '')
})

test.describe('a comma as the decimal mark', () => {
  test.use({ locale: 'de-DE' })
  test('numbers and dates are typed and drawn the local way, and stored the same everywhere', async ({ page }) => {
    await seedTyped(page, COLS, ROWS)
    await openAt(page, 3, AGE)
    await page.keyboard.type('1.234,5')
    await page.keyboard.press('Enter')
    expect(await text(page, 3, AGE)).toBe('1.234,5')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(input(page)).toHaveValue('1234,5')
    await page.keyboard.press('Escape')
    // Day first.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('25.12.2018')
    await page.keyboard.press('Enter')
    expect(await text(page, 3, BIRTHDAY)).toContain('2018')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(input(page)).toHaveValue('2018-12-25')
  })
})

test('a box ticks with Space or Enter, a click on it, and one click when the table is only selected', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await expect(checkOf(page, 0, GOOD)).toHaveAttribute('aria-checked', 'true')
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'false')
  // Read view: it centres, and draws like a to-do's box.
  expect(await cell(page, 0, GOOD).evaluate((el) => getComputedStyle(el).textAlign)).toBe('center')
  await openAt(page, 1, GOOD)
  // A box takes no typing, so no keyboard comes up for it.
  await expect(input(page)).toHaveAttribute('inputmode', 'none')
  await page.keyboard.press('Space')
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Enter')
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.type('x')
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'false')
  await expect(input(page)).toHaveValue('')
  // A range ticks together, every box taking the opposite of the active one.
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Space')
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'true')
  await expect(checkOf(page, 2, GOOD)).toHaveAttribute('aria-checked', 'true')
  // Each press is one undo step.
  await undo(page)
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'false')
  await expect(checkOf(page, 2, GOOD)).toHaveAttribute('aria-checked', 'true')
  // Delete empties the box (it reads unticked).
  await page.keyboard.press('Delete')
  await expect(checkOf(page, 2, GOOD)).toHaveAttribute('aria-checked', 'false')
  // Editing: clicking the box ticks it and picks the cell; clicking the cell around it only picks.
  await checkOf(page, 3, GOOD).click()
  await expect(checkOf(page, 3, GOOD)).toHaveAttribute('aria-checked', 'true')
  expect(await activeCell(page)).toEqual({ row: 3, col: GOOD })
  const box = (await cell(page, 0, GOOD).boundingBox())!
  await page.mouse.click(box.x + 6, box.y + box.height / 2)
  expect(await activeCell(page)).toEqual({ row: 0, col: GOOD })
  await expect(checkOf(page, 0, GOOD)).toHaveAttribute('aria-checked', 'true')
  await waitForSync(page)
  await page.reload()
  await expect(checkOf(page, 3, GOOD)).toHaveAttribute('aria-checked', 'true')
})

test('a selected table ticks a box on one click, like a to-do; an unselected one only selects', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  // Not selected: the first click picks the card and ticks nothing.
  await checkOf(page, 1, GOOD).click()
  await expect(table(page)).toHaveClass(/selected/)
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'false')
  await expect(input(page)).toHaveCount(0)
  // Selected: one click ticks it, and the table is not opened for editing.
  await checkOf(page, 1, GOOD).click()
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'true')
  await expect(input(page)).toHaveCount(0)
  await checkOf(page, 1, GOOD).click()
  await expect(checkOf(page, 1, GOOD)).toHaveAttribute('aria-checked', 'false')
  await expect(input(page)).toHaveCount(0)
  await clickEmpty(page)
  await expect(table(page)).not.toHaveClass(/selected/)
  await expect(checkOf(page, 0, GOOD)).not.toHaveAttribute('data-nodrag', '')
})

test('dates are typed in the local order or as ISO, drawn short, and anything else is kept, muted', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  expect(await text(page, 0, BIRTHDAY)).toBe('Mar 14, 2019')
  await openAt(page, 3, BIRTHDAY)
  await page.keyboard.type('3/4/2018')
  await page.keyboard.press('Enter')
  expect(await text(page, 3, BIRTHDAY)).toBe('Mar 4, 2018')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  // The draft is unambiguous ISO.
  await expect(input(page)).toHaveValue('2018-03-04')
  await page.keyboard.press('Escape')
  await page.keyboard.type('2017-12-25')
  await page.keyboard.press('Enter')
  expect(await text(page, 3, BIRTHDAY)).toBe('Dec 25, 2017')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.type('next week')
  await page.keyboard.press('Enter')
  await expect(cell(page, 3, BIRTHDAY)).toHaveAttribute('data-muted', '')
  expect(await text(page, 3, BIRTHDAY)).toBe('next week')
  await expect(cell(page, 2, BIRTHDAY)).toHaveAttribute('data-muted', '')
})

test('a tag: Enter opens the picker, typing filters it, arrows and Enter choose, and Escape gives the keys back', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 3, STATUS)
  await expect(input(page)).toHaveAttribute('inputmode', 'none')
  await page.keyboard.press('Enter')
  const pop = page.getByTestId('table-select-popover')
  await expect(pop).toBeVisible()
  await expect(page.getByTestId('table-select-input')).toBeFocused()
  await expect(page.getByTestId('table-select-input')).toHaveAttribute('placeholder', 'Sniff out an option…')
  await expect(page.getByTestId('table-option')).toHaveCount(3)
  await page.keyboard.type('n')
  await expect(page.getByTestId('table-option')).toHaveText(['Napping'])
  await page.keyboard.press('Enter')
  await expect(pop).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  await expect(cell(page, 3, STATUS).getByTestId('table-chip')).toHaveText('Napping')
  // Arrow keys move through the whole list.
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(cell(page, 3, STATUS).getByTestId('table-chip')).toHaveText(/Walked|Fed|Napping/)
  // Typing a letter on the cell opens the picker with it already in the filter.
  await page.keyboard.type('F')
  await expect(page.getByTestId('table-select-input')).toHaveValue('F')
  await expect(page.getByTestId('table-option')).toHaveText(['Fed'])
  await page.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  expect(await activeCell(page)).toEqual({ row: 3, col: STATUS })
})

test('a tag is a chip in the card colours, an unknown id shows nothing, and picking the cleared value empties the cell', async ({ page }) => {
  await seedTyped(page, COLS, [...ROWS.slice(0, 3), { cells: ['Fido', null, null, null, 'zz99', null] }])
  const chip = cell(page, 0, STATUS).getByTestId('table-chip')
  await expect(chip).toHaveText('Walked')
  expect(await chip.getAttribute('style')).toContain('--dn-table-ball-bg')
  expect(await chip.getAttribute('style')).toContain('--dn-table-ball-text')
  await expect(cell(page, 3, STATUS).getByTestId('table-chip')).toHaveCount(0)
  expect(await text(page, 3, STATUS)).toBe('')
  await openAt(page, 0, STATUS)
  await page.keyboard.press('Enter')
  await page.getByTestId('table-select-clear').click()
  await expect(cell(page, 0, STATUS).getByTestId('table-chip')).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  await undo(page)
  await expect(cell(page, 0, STATUS).getByTestId('table-chip')).toHaveText('Walked')
})

test('creating a tag: Enter on the typed name adds it with the next unused colour, in one undo step', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 3, STATUS)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Zoomies')
  await expect(page.getByTestId('table-option')).toHaveCount(0)
  await expect(page.getByTestId('table-option-create')).toHaveText('Create "Zoomies"')
  await page.keyboard.press('Enter')
  const chip = cell(page, 3, STATUS).getByTestId('table-chip')
  await expect(chip).toHaveText('Zoomies')
  // ball, gold and sky are taken: the next preset in line.
  expect(await chip.getAttribute('style')).toContain('--dn-table-collar-bg')
  // Another cell can pick it, by name, without creating a second one.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await page.keyboard.type('zoomies')
  await expect(page.getByTestId('table-option')).toHaveText(['Zoomies'])
  await expect(page.getByTestId('table-option-create')).toHaveCount(0)
  await page.keyboard.press('Escape')
  // One undo takes the new cell value and the new option back together.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await undo(page)
  await expect(cell(page, 3, STATUS).getByTestId('table-chip')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('table-option')).toHaveCount(3)
})

test('a column menu edits the options: rename, recolour with the presets, reorder, delete, add', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openAt(page, 0, STATUS)
  await columnGrip(page, STATUS).click()
  await page.getByTestId('table-more').click()
  await page.getByTestId('table-edit-options').click()
  const panel = page.getByTestId('table-options-popover')
  await expect(panel).toBeVisible()
  const rows = page.getByTestId('table-option-row')
  await expect(rows).toHaveCount(3)
  // Rename: the cells follow, because they point at the option by id.
  await rows.nth(1).getByTestId('table-option-name').fill('Dinner')
  await rows.nth(1).getByTestId('table-option-name').press('Enter')
  await expect(cell(page, 1, STATUS).getByTestId('table-chip')).toHaveText('Dinner')
  // A name another option has is refused, and says so.
  await rows.nth(1).getByTestId('table-option-name').fill('walked')
  await rows.nth(1).getByTestId('table-option-name').press('Enter')
  await expect(page.getByTestId('table-options-error')).toBeVisible()
  await expect(rows.nth(1).getByTestId('table-option-name')).toHaveValue('Dinner')
  // Recolour: presets only, no colour wheel.
  await rows.nth(1).getByTestId('table-option-colour').click()
  await expect(panel.locator('input[type=color]')).toHaveCount(0)
  await expect(panel.locator('.color-dot')).toHaveCount(7)
  await panel.getByTestId('table-option-colour-lilac').click()
  expect(await cell(page, 1, STATUS).getByTestId('table-chip').getAttribute('style')).toContain('--dn-table-lilac-bg')
  // Reorder: Dinner moves above Walked.
  await rows.nth(1).getByTestId('table-option-up').click()
  await expect(rows.nth(0)).toHaveAttribute('data-option', 'Dinner')
  await expect(rows.nth(0).getByTestId('table-option-up')).toBeDisabled()
  // Add, then delete one that cells use: those cells empty, with an Undo.
  await page.getByTestId('table-option-add').fill('Zoomies')
  await page.getByTestId('table-option-add').press('Enter')
  await expect(rows).toHaveCount(4)
  await rows.nth(1).getByTestId('table-option-delete').click()
  await expect(rows).toHaveCount(3)
  await expect(cell(page, 0, STATUS).getByTestId('table-chip')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  await undo(page)
  await expect(cell(page, 0, STATUS).getByTestId('table-chip')).toHaveText('Walked')
})

test('paws: keys 1 to 5 set, 0 and Delete clear, a click sets a paw and the same paw again clears', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  expect(await ratingOf(page, 0, PAWS)).toBe(5)
  await expect(cell(page, 1, PAWS).locator('.table-rating')).toHaveAttribute('aria-label', '3 of 5 paws')
  expect(await cell(page, 0, PAWS).evaluate((el) => getComputedStyle(el).textAlign)).toBe('center')
  await openAt(page, 3, PAWS)
  await expect(input(page)).toHaveAttribute('inputmode', 'none')
  await page.keyboard.press('4')
  expect(await ratingOf(page, 3, PAWS)).toBe(4)
  await page.keyboard.press('1')
  expect(await ratingOf(page, 3, PAWS)).toBe(1)
  await page.keyboard.press('0')
  expect(await ratingOf(page, 3, PAWS)).toBe(0)
  await page.keyboard.press('3')
  await page.keyboard.press('Delete')
  expect(await ratingOf(page, 3, PAWS)).toBe(0)
  // Letters and 6 to 9 mean nothing.
  await page.keyboard.type('9a')
  expect(await ratingOf(page, 3, PAWS)).toBe(0)
  // A click on the paw itself.
  await cell(page, 3, PAWS).locator('[data-paw="4"]').click()
  expect(await ratingOf(page, 3, PAWS)).toBe(4)
  expect(await activeCell(page)).toEqual({ row: 3, col: PAWS })
  await cell(page, 3, PAWS).locator('[data-paw="4"]').click()
  expect(await ratingOf(page, 3, PAWS)).toBe(0)
  // Empty paws are outlines at the tested strength (3:1 on any cell); set ones are solid paws in the full text colour.
  const faint = await cell(page, 1, PAWS).locator('[data-paw="5"]').evaluate((el) => Number(getComputedStyle(el).opacity))
  const set = await cell(page, 1, PAWS).locator('[data-paw="1"]').evaluate((el) => Number(getComputedStyle(el).opacity))
  expect(faint).toBeCloseTo(0.7, 2)
  expect(set).toBe(1)
  await expect(cell(page, 1, PAWS).locator('[data-paw="5"] svg')).toHaveAttribute('data-icon', 'pawOutline')
  await expect(cell(page, 1, PAWS).locator('[data-paw="1"] svg')).toHaveAttribute('data-icon', 'paw')
  // A range takes the key together.
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('2')
  expect(await ratingOf(page, 2, PAWS)).toBe(2)
  expect(await ratingOf(page, 1, PAWS)).toBe(2)
})

test('changing a column type converts what fits, loses nothing, and is one undo step', async ({ page }) => {
  await seedTyped(page, [{ n: 'Pup' }, { n: 'Notes' }], [
    { cells: ['Rex', '4'] }, { cells: ['Mochi', '12.5'] }, { cells: ['Biscuit', 'cheese'] }, { cells: ['Fido', 'cheese'] },
  ])
  await openAt(page, 0, 1)
  await columnGrip(page, 1).click()
  await page.getByTestId('table-type').click()
  await expect(page.getByTestId('table-type-menu')).toBeVisible()
  await expect(page.getByTestId('table-type-text')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('table-type-number').click()
  await expect(cell(page, 0, 1)).toHaveAttribute('data-type', 'number')
  expect(await cell(page, 0, 1).evaluate((el) => getComputedStyle(el).textAlign)).toBe('right')
  expect(await text(page, 1, 1)).toBe('12.5')
  // "cheese" can't be a number: it stays, muted, so changing back shows it again.
  await expect(cell(page, 2, 1)).toHaveAttribute('data-muted', '')
  expect(await text(page, 2, 1)).toBe('cheese')
  await page.getByTestId('table-type').click()
  await page.getByTestId('table-type-select').click()
  // Distinct values become tags: 4, 12.5 and cheese, with cheese used twice.
  await expect(cell(page, 2, 1).getByTestId('table-chip')).toHaveText('cheese')
  await expect(cell(page, 3, 1).getByTestId('table-chip')).toHaveText('cheese')
  const a = await cell(page, 2, 1).getByTestId('table-chip').getAttribute('style')
  expect(await cell(page, 3, 1).getByTestId('table-chip').getAttribute('style')).toBe(a)
  await undo(page)
  await expect(cell(page, 0, 1)).toHaveAttribute('data-type', 'number')
  await expect(cell(page, 2, 1).getByTestId('table-chip')).toHaveCount(0)
  await undo(page)
  await expect(cell(page, 0, 1)).toHaveAttribute('data-type', 'text')
  expect((await grid(page)).slice(1).map((r) => r[1])).toEqual(['4', '12.5', 'cheese', 'cheese'])
})

test('the column menu holds Type and Sort too, and the header shows the type', async ({ page }) => {
  await seedTyped(page, COLS, ROWS)
  await openEditing(page, 0, 0)
  await columnGrip(page, AGE).click()
  await expect(page.getByTestId('table-type')).toHaveAttribute('data-tip', 'Column type')
  await page.getByTestId('table-more').click()
  const menu = page.getByTestId('table-more-menu')
  await expect(menu.getByTestId('table-menu-type')).toContainText('Number')
  await menu.getByTestId('table-menu-type').click()
  await expect(menu.getByTestId('table-type-number')).toHaveAttribute('aria-checked', 'true')
  await menu.getByTestId('table-type-rating').click()
  await expect(cell(page, 0, AGE)).toHaveAttribute('data-type', 'rating')
  // 4 is a rating; 12 is not 1 to 5, so it is kept but draws no paws.
  expect(await ratingOf(page, 0, AGE)).toBe(4)
  expect(await ratingOf(page, 1, AGE)).toBe(0)
})

test('each box is named by its column and its row\'s first cell, and its state is the box\'s own to say', async ({ page, browser }) => {
  await seedTyped(page, COLS, [
    { cells: ['Rex', 4, true, null, null, null] },
    { cells: ['Mochi', 12, false, null, null, null] },
    { cells: ['', 7, true, null, null, null] },
  ])
  const card = page.locator('[data-type=table]')
  const box = (name: string) => card.getByRole('checkbox', { name, exact: true })
  // Read view: "Good boy, Rex" with the state on aria-checked, and no row without a name is left as a bare "Good boy".
  await expect(box('Good boy, Rex')).toHaveAttribute('aria-checked', 'true')
  await expect(box('Good boy, Mochi')).toHaveAttribute('aria-checked', 'false')
  await expect(box('Row 3, Good boy')).toHaveAttribute('aria-checked', 'true')
  // Ticking while editing changes the state and not the name.
  await openAt(page, 1, GOOD)
  await page.keyboard.press('Space')
  await expect(box('Good boy, Mochi')).toHaveAttribute('aria-checked', 'true')
  // A new first-cell value renames its row's boxes.
  await openAt(page, 0, PUP)
  await page.keyboard.type('Rexy')
  await page.keyboard.press('Enter')
  await expect(box('Good boy, Rexy')).toHaveCount(1)
  await expect(box('Good boy, Rex')).toHaveCount(0)
  // The read-only viewer has the same names.
  await page.getByTestId('share').click()
  const panel = page.getByTestId('share-panel')
  await panel.getByTestId('create-share').click()
  const url = await panel.getByTestId('share-url').first().inputValue()
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const v = await ctx.newPage()
    await v.goto(url)
    const shared = v.locator('[data-type=table]')
    await expect(shared.getByRole('checkbox', { name: 'Good boy, Rexy', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(shared.getByRole('checkbox', { name: 'Row 3, Good boy', exact: true })).toBeVisible()
  } finally { await ctx.close() }
})

test('a box in the first column is named by its row number', async ({ page }) => {
  await seedTyped(page, [{ n: 'Walked', t: 'checkbox' }, { n: 'Pup' }], [{ cells: [true, 'Rex'] }, { cells: [false, 'Mochi'] }])
  const card = page.locator('[data-type=table]')
  await expect(card.getByRole('checkbox', { name: 'Row 1, Walked', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(card.getByRole('checkbox', { name: 'Row 2, Walked', exact: true })).toHaveAttribute('aria-checked', 'false')
})

test('a read-only viewer draws every type and nothing in it can be changed', async ({ page, browser }) => {
  await seedTyped(page, COLS, ROWS)
  await page.getByTestId('share').click()
  const panel = page.getByTestId('share-panel')
  await panel.getByTestId('create-share').click()
  const url = await panel.getByTestId('share-url').first().inputValue()
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const v = await ctx.newPage()
    await v.goto(url)
    const card = v.locator('[data-type=table]')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('table-chip').first()).toBeVisible()
    await expect(card.getByTestId('table-rating')).toHaveCount(4)
    await expect(card.getByTestId('table-check')).toHaveCount(4)
    // A tick, even clicked twice, selected or not, changes nothing; no card is selected-and-live either.
    const tick = card.getByTestId('table-check').nth(1)
    await expect(tick).toHaveAttribute('aria-checked', 'false')
    await tick.click({ force: true })
    await tick.click({ force: true })
    await expect(tick).toHaveAttribute('aria-checked', 'false')
    await expect(tick).not.toHaveAttribute('data-nodrag', '')
    await card.getByTestId('table-check').first().click({ force: true })
    await expect(card.getByTestId('table-check').first()).toHaveAttribute('aria-checked', 'true')
    await card.locator('[data-paw="1"]').first().click({ force: true })
    await expect(card.getByTestId('table-rating').first()).toHaveAttribute('data-n', '5')
    await expect(v.getByTestId('table-input')).toHaveCount(0)
    await expect(v.getByTestId('table-select-popover')).toHaveCount(0)
  } finally { await ctx.close() }
})

test('zoomed out, fills and tags are drawn on the overview canvas', async ({ page }) => {
  await seedTyped(page, COLS, [
    { bg: 'sky', cells: ['Rex', 4, true, '2019-03-14', 'Walked', 5] },
    { cells: ['Mochi', { v: 12, bg: 'collar' }, false, '2019-11-02', 'Fed', 3] },
  ])
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 80)
  await page.keyboard.up('Control')
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  await expect(page.getByTestId('table-grid')).toHaveCount(0)
  // The canvas holds the table's own fills (the dark theme's softer ones): exact pixels of the sky and collar fills.
  const colours = await page.getByTestId('lod-layer').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let sky = 0, collar = 0
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b, a] = [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!]
      if (a < 250) continue
      if (r === 0x45 && g === 0x50 && b === 0x5a) sky++
      if (r === 0x66 && g === 0x3a && b === 0x3e) collar++
    }
    return { sky, collar }
  })
  expect(colours.sky).toBeGreaterThan(20)
  expect(colours.collar).toBeGreaterThan(5)
})

test('a ticked box is the lamp on a plain cell and the cell\'s own ink on a filled one, as a to-do\'s done box is', async ({ page }) => {
  await seedTyped(page, COLS, [
    { cells: ['Rex', 4, true, null, null, null] },
    { cells: [{ v: 'Mochi', bg: 'sky' }, 12, { v: true, bg: 'sky' }, null, null, null] },
    { bg: 'gold', cells: ['Biscuit', 2, true, null, null, null] },
  ])
  const paint = (row: number) => checkOf(page, row, GOOD).evaluate((el) => {
    const td = el.closest('td')!, root = getComputedStyle(document.documentElement)
    return { box: getComputedStyle(el).backgroundColor, text: getComputedStyle(td).color, accent: root.getPropertyValue('--dn-accent').trim(), cellBg: getComputedStyle(td).backgroundColor }
  })
  const plain = await paint(0)
  const probe = await page.evaluate(() => { const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--dn-accent'); document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c })
  expect(plain.box).toBe(probe)
  // A fill (a cell's or its row's) takes the box away from the lamp: it is drawn in the cell's text colour.
  for (const row of [1, 2]) {
    const filled = await paint(row)
    expect(filled.box).toBe(filled.text)
    expect(filled.box).not.toBe(probe)
  }
})

test('the active cell keeps an inner ring in the cell\'s ink on a fill, so gold on gold never loses it', async ({ page }) => {
  await seedTyped(page, COLS, [{ bg: 'gold', cells: ['Rex', 4, true, null, null, null] }, { cells: ['Mochi', 12, true, null, null, null] }])
  await openAt(page, 0, PUP)
  const ring = () => input(page).evaluate((el) => ({ filled: (el as HTMLElement).hasAttribute('data-filled'), shadow: getComputedStyle(el).boxShadow, ink: getComputedStyle(el).getPropertyValue('--ta-fg').trim() }))
  const on = await ring()
  expect(on.filled).toBe(true)
  expect(on.shadow).not.toBe('none')
  await page.keyboard.press('ArrowDown')
  const off = await ring()
  expect(off.filled).toBe(false)
  expect(off.shadow).toBe('none')
})
