import { expect, test } from '@playwright/test'
import { camera, freshBoard, waitForSync } from './helpers.ts'
import { center, pinch, tapOn, touchDrag } from './touch.ts'
import { cell, centerOf, columnGrip, grid, headerCells, input, rowGrip, seedTable, table } from './tables.ts'

// iPad: a finger drives the grips, the resize strips and the menus; a finger over
// a table that isn't being edited still pans the board, and pinch still zooms.

const PACK = [['Rex', '4', 'Bacon'], ['Mochi', '7', 'Cheese'], ['Biscuit', '2', 'Roast chicken'], ['Fido', '9', 'Kibble']]
const COLS = ['Pup', 'Age', 'Treat']

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

async function openEditing(page: import('@playwright/test').Page, row = 0, col = 0) {
  await tapOn(page, cell(page, row, col), { x: 20, y: 10 })
  await tapOn(page, cell(page, row, col), { x: 20, y: 10 })
  await expect(input(page)).toBeFocused()
}

const names = async (page: import('@playwright/test').Page) => (await grid(page)).slice(1).map((r) => r[0])

test('one finger over a table that is not being edited pans the board; pinch zooms', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  const before = await camera(page)
  const c = await centerOf(cell(page, 1, 1))
  await touchDrag(page, c, { x: c.x + 90, y: c.y + 30 })
  const after = await camera(page)
  expect(after.tx - before.tx).toBeCloseTo(90, 0)
  expect(after.ty - before.ty).toBeCloseTo(30, 0)
  await expect(input(page)).toHaveCount(0)
  expect(await grid(page)).toEqual([COLS, ...PACK])
  const p = await center(page.getByTestId('canvas'))
  await pinch(page, p, 1.5)
  expect((await camera(page)).zoom).toBeGreaterThan(1.3)
})

test('pinch still zooms while a table is being edited', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const c = await centerOf(cell(page, 1, 1))
  await pinch(page, c, 1.5, { spread: 40 })
  expect((await camera(page)).zoom).toBeGreaterThan(1.3)
  await expect(input(page)).toBeVisible()
})

test('grips are 32px wide with 44px reach, and a tap on one selects the row', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const grip = rowGrip(page, 1)
  expect((await grip.boundingBox())!.width).toBe(32)
  const reach = await grip.evaluate((el) => { const s = getComputedStyle(el, '::after'); return el.getBoundingClientRect().height + 2 * -parseFloat(s.top) })
  expect(reach).toBeGreaterThanOrEqual(44)
  await tapOn(page, grip, { x: 16, y: 10 })
  await expect(page.getByTestId('table-dock')).toHaveAttribute('data-kind', 'rows')
  await expect(page.getByTestId('table-range')).toBeVisible()
  await expect(input(page)).toBeFocused()
})

test('dragging a grip with a finger moves the row; undo is one step', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const from = await centerOf(rowGrip(page, 0))
  const to = await centerOf(rowGrip(page, 2))
  await touchDrag(page, from, { x: to.x, y: to.y + 6 })
  expect(await names(page)).toEqual(['Mochi', 'Biscuit', 'Rex', 'Fido'])
  // The canvas did not pan under the finger.
  await input(page).press('Control+z')
  expect(await names(page)).toEqual(['Rex', 'Mochi', 'Biscuit', 'Fido'])
})

test('dragging a column grip with a finger moves the column', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const before = await camera(page)
  const from = await centerOf(columnGrip(page, 0))
  const to = await centerOf(columnGrip(page, 2))
  await touchDrag(page, from, { x: to.x + 20, y: to.y })
  expect((await grid(page))[0]).toEqual(['Age', 'Treat', 'Pup'])
  const after = await camera(page)
  expect(after.tx).toBeCloseTo(before.tx, 0)
  expect(after.ty).toBeCloseTo(before.ty, 0)
})

test('a finger on a boundary strip resizes the columns', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const widths = async () => page.evaluate(() => [...document.querySelectorAll('[data-type=table] thead th')].map((th) => th.getBoundingClientRect().width))
  const before = await widths()
  const strip = page.getByTestId('table-resize').first()
  expect((await strip.boundingBox())!.width).toBe(16)
  const at = await centerOf(strip)
  await touchDrag(page, at, { x: at.x + 50, y: at.y })
  const after = await widths()
  expect(after[0]! - before[0]!).toBeGreaterThan(40)
  expect(Math.abs(after.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0))).toBeLessThan(1)
})

test('a long press on a grip opens its menu, and the column ⋯ opens the column list', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page)
  const g = await centerOf(columnGrip(page, 1))
  await touchDrag(page, g, { x: g.x, y: g.y }, { hold: 700, steps: 1 })
  const menu = page.getByTestId('table-column-menu-list')
  await expect(menu).toBeVisible()
  await menu.getByTestId('table-move-left').tap()
  expect((await grid(page))[0]).toEqual(['Age', 'Pup', 'Treat'])
  await expect(headerCells(page)).toHaveCount(3)
  // The selected column shows its ⋯ with a 44px reach.
  const more = page.getByTestId('table-column-menu').nth(0)
  await expect(more).toHaveCSS('opacity', '1')
  const reach = await more.evaluate((el) => { const s = getComputedStyle(el, '::after'); return el.getBoundingClientRect().height + 2 * -parseFloat(s.top) })
  expect(reach).toBeGreaterThanOrEqual(44)
  await more.tap()
  await expect(page.getByTestId('table-column-menu-list')).toBeVisible()
  await waitForSync(page)
  expect(await table(page).count()).toBe(1)
})
