import { expect, type Locator, type Page } from '@playwright/test'
import { cellKey, rowKey, colKey, starterTable, tableColumns, tableRows } from '@doggynote/core'
import { MOD } from './helpers.ts'

// Shared by the table specs: building tables, reading what they show.

export { MOD }
export const table = (page: Page) => page.locator('[data-type=table]').first()
export const input = (page: Page) => page.getByTestId('table-input')
export const headerCells = (page: Page) => table(page).locator('thead th')
export const bodyRows = (page: Page) => table(page).locator('tbody tr')
export const cell = (page: Page, row: number, col: number) => bodyRows(page).nth(row).locator('td').nth(col)

/** Every cell's text, the header row first. */
export async function grid(page: Page, card: Locator = table(page)): Promise<string[][]> {
  return card.locator('table.table-grid tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent ?? '')))
}

/** Make a table with the toolbar, in edit mode on its first cell. */
export async function addTable(page: Page) {
  await page.getByTestId('tool-table').click()
  await expect(input(page)).toBeVisible()
  await expect(input(page)).toBeFocused()
  return table(page)
}

/** The fields of a table with `header` columns and `rows` of cell text, for seeding through the API. */
export function tableFields(header: string[], rows: string[][]) {
  const base = starterTable(header, rows.length)
  const cols = tableColumns(base), rowList = tableRows(base)
  const fields: Record<string, unknown> = { ...base }
  rows.forEach((line, r) => line.forEach((text, c) => { if (text) fields[cellKey(rowList[r]!.id, cols[c]!.id)] = text }))
  return { fields, rows: rowList.map((r) => r.id), cols: cols.map((c) => c.id) }
}
export { cellKey, rowKey, colKey }

/** The active cell's outline (the field) sits over this cell. */
export async function activeCell(page: Page): Promise<{ row: number; col: number } | null> {
  return page.evaluate(() => {
    const ta = document.querySelector('[data-testid=table-input]') as HTMLElement | null
    const grid = document.querySelector('[data-type=table] table.table-grid') as HTMLTableElement | null
    if (!ta || !grid) return null
    const a = ta.getBoundingClientRect()
    const cx = a.left + a.width / 2, cy = a.top + Math.min(a.height / 2, 16)
    const el = [...grid.querySelectorAll('th, td')].find((c) => { const r = c.getBoundingClientRect(); return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom })
    if (!el) return null
    const tr = el.parentElement as HTMLTableRowElement
    const inHead = !!tr.closest('thead')
    return { row: inHead ? -1 : [...tr.parentElement!.children].indexOf(tr), col: [...tr.children].indexOf(el) }
  })
}
