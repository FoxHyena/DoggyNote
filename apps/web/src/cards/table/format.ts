import { cellDisplay, cellValue, unreadText, type Cell, type InputLocale, type TableColumn } from '@doggynote/core'

// How a table's values are written and read in this browser's locale. The stored
// values never change (numbers are numbers, dates are YYYY-MM-DD); only what is
// drawn and what is typed follows the person's habits.

/** The decimal mark and date order the browser's language uses. */
export function localeOf(lang?: string): InputLocale {
  let decimal: InputLocale['decimal'] = '.'
  let dates: InputLocale['dates'] = 'mdy'
  try {
    decimal = new Intl.NumberFormat(lang).formatToParts(1.5).find((p) => p.type === 'decimal')?.value === ',' ? ',' : '.'
    const order = new Intl.DateTimeFormat(lang, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(2000, 10, 22)).filter((p) => p.type === 'year' || p.type === 'month' || p.type === 'day').map((p) => p.type[0])
    dates = order.join('') === 'ymd' ? 'ymd' : order.join('') === 'dmy' ? 'dmy' : 'mdy'
  } catch { /* an unknown language: the defaults */ }
  return { decimal, dates }
}

let cached: InputLocale | null = null
export const inputLocale = (): InputLocale => (cached ??= localeOf(typeof navigator === 'undefined' ? undefined : navigator.language))

const numberFormat = (() => {
  let f: Intl.NumberFormat | null = null
  return () => (f ??= new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }))
})()

/** A number as drawn: grouped and with the locale's decimal mark. */
export const formatNumber = (n: number) => numberFormat().format(n)

/** A number as edited: no grouping, the locale's decimal mark, so typing it back gives the same value. */
export const numberText = (n: number) => String(n).replace('.', inputLocale().decimal)

/** "Mar 14", or "Mar 14, 2025" when it isn't this year. `iso` is a valid YYYY-MM-DD. */
export function formatDate(iso: string, now = new Date()): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m - 1, d)
  return new Intl.DateTimeFormat(undefined, y === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

/** The text a cell starts with when it is edited. */
export function editText(col: TableColumn, cell: Cell): string {
  const v = cellValue(col, cell)
  if (col.t === 'number' && typeof v === 'number') return numberText(v)
  if (v === null) return unreadText(col, cell) ?? ''
  return cellDisplay(col, cell)
}
