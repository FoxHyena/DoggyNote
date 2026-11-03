import { isPresetColor, CARD_COLORS, type PresetColor } from '@doggynote/theme'
import { ordersBetween, orderBetween } from './order.ts'

// Table cards. A table is a card whose `content` is just `{ title }`; every row,
// column and cell is a top-level field of the card itself:
//
//   tr<rowId>            RowField     order + fill
//   tk<colId>            ColumnField  name, order, width weight, type, align, options
//   tc<rowId><colId>     CellField    one cell (a bare value, or value + style)
//
// Sync merges per top-level field, so two people editing different cells never
// overwrite each other (one `content.cells` map would lose a concurrent edit).
// Ids are 6 characters starting with a digit, so these keys never collide with
// real fields (which start with a letter after the `t`). Everything here is
// pure: patch builders return plain `{ field: value }` objects that the caller
// passes to `doc.update`. Synced values are unchecked, so every reader
// tolerates wrong types.

export type Align = 'l' | 'c' | 'r'
export type ColumnType = 'text' | 'number' | 'checkbox' | 'date' | 'select' | 'rating'
export type Prim = string | number | boolean
export type CellValue = Prim | null
export type SelectOption = { id: string; n: string; c: PresetColor }

/** Stored shapes (what travels over sync). */
export type CellField = Prim | { v?: Prim; b?: 1; a?: Align; bg?: PresetColor } | null
export type RowField = { o: number; bg?: PresetColor } | null
export type ColumnField = { n: string; o: number; w: number; t: ColumnType; a?: Align; opts?: SelectOption[] } | null

/** Read shapes (always well-formed). */
export type Cell = { v: CellValue; b: boolean; a?: Align; bg?: PresetColor }
export type TableRow = { id: string; o: number; bg?: PresetColor }
export type TableColumn = { id: string; n: string; o: number; w: number; t: ColumnType; a?: Align; opts: SelectOption[] }
export type TablePatch = Record<string, unknown>

export const COLUMN_TYPES: readonly ColumnType[] = ['text', 'number', 'checkbox', 'date', 'select', 'rating']

/** What the editor allows. */
export const TABLE_CAPS = { rows: 100, cols: 26, cell: 2000, name: 100, options: 50 } as const
/** What the server refuses beyond (1.5x the UI, so a rebase or an agent never trips on the edge). */
export const TABLE_SERVER_CAPS = { rows: 150, cols: 40, bytes: 1024 * 1024 } as const
/** The smallest relative column weight a boundary drag leaves behind. */
export const MIN_COLUMN_WEIGHT = 0.25

const ID = /^[0-9][0-9a-z]{5}$/
const OPTION_ID = /^[0-9][0-9a-z]{3}$/
const ROW_FIELD = /^tr([0-9][0-9a-z]{5})$/
const COLUMN_FIELD = /^tk([0-9][0-9a-z]{5})$/
const CELL_FIELD = /^tc([0-9][0-9a-z]{5})([0-9][0-9a-z]{5})$/
/** Any key that belongs to a table. All of them satisfy the server's field-name rule. */
export const TABLE_FIELD = /^t[rk][0-9][0-9a-z]{5}$|^tc[0-9][0-9a-z]{5}[0-9][0-9a-z]{5}$/
export const isTableField = (key: string) => TABLE_FIELD.test(key)
export const isTableId = (id: unknown): id is string => typeof id === 'string' && ID.test(id)

// ---- ids and keys -------------------------------------------------------------

const DIGITS = '0123456789'
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

function randomId(length: number, taken?: ReadonlySet<string>): string {
  for (;;) {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    let id = DIGITS[bytes[0]! % 10]!
    for (let i = 1; i < length; i++) id += BASE36[bytes[i]! % 36]!
    if (!taken?.has(id)) return id
  }
}

/** A fresh row or column id (6 chars, first is a digit). Pass the ids in use to rule out a clash. */
export const tableId = (taken?: ReadonlySet<string>) => randomId(6, taken)
/** A fresh select option id (4 chars, first is a digit). */
export const optionId = (taken?: ReadonlySet<string>) => randomId(4, taken)

export const rowKey = (rowId: string) => `tr${rowId}`
export const colKey = (colId: string) => `tk${colId}`
export const cellKey = (rowId: string, colId: string) => `tc${rowId}${colId}`

/** What a table key addresses, or null if it isn't one. */
export function parseTableKey(key: string): { kind: 'row'; row: string } | { kind: 'col'; col: string } | { kind: 'cell'; row: string; col: string } | null {
  let m = ROW_FIELD.exec(key)
  if (m) return { kind: 'row', row: m[1]! }
  m = COLUMN_FIELD.exec(key)
  if (m) return { kind: 'col', col: m[1]! }
  m = CELL_FIELD.exec(key)
  if (m) return { kind: 'cell', row: m[1]!, col: m[2]! }
  return null
}

// ---- tolerant readers ---------------------------------------------------------

type Source = object
const fields = (card: Source) => card as Record<string, unknown>
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isAlign = (v: unknown): v is Align => v === 'l' || v === 'c' || v === 'r'
const isType = (v: unknown): v is ColumnType => (COLUMN_TYPES as readonly unknown[]).includes(v)
const isPrim = (v: unknown): v is Prim => typeof v === 'string' || typeof v === 'boolean' || finite(v)
const byOrder = (a: { o: number; id: string }, b: { o: number; id: string }) => a.o - b.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s)

function readOptions(value: unknown): SelectOption[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: SelectOption[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !OPTION_ID.test(raw.id) || seen.has(raw.id)) continue
    seen.add(raw.id)
    out.push({ id: raw.id, n: typeof raw.n === 'string' ? clip(raw.n, TABLE_CAPS.name) : '', c: isPresetColor(raw.c) ? raw.c : 'none' })
    if (out.length >= TABLE_CAPS.options) break
  }
  return out
}

/** Columns in display order. Removed (null) and malformed fields are skipped. */
export function tableColumns(card: Source): TableColumn[] {
  const out: TableColumn[] = []
  for (const key of Object.keys(card)) {
    const m = COLUMN_FIELD.exec(key)
    if (!m) continue
    const f = fields(card)[key]
    if (!isRecord(f)) continue
    out.push({
      id: m[1]!,
      n: typeof f.n === 'string' ? clip(f.n, TABLE_CAPS.name) : '',
      o: finite(f.o) ? f.o : 0,
      w: finite(f.w) && f.w > 0 ? f.w : 1,
      t: isType(f.t) ? f.t : 'text',
      ...(isAlign(f.a) ? { a: f.a } : {}),
      opts: readOptions(f.opts),
    })
  }
  return out.sort(byOrder)
}

/** Rows in display order. */
export function tableRows(card: Source): TableRow[] {
  const out: TableRow[] = []
  for (const key of Object.keys(card)) {
    const m = ROW_FIELD.exec(key)
    if (!m) continue
    const f = fields(card)[key]
    if (!isRecord(f)) continue
    out.push({ id: m[1]!, o: finite(f.o) ? f.o : 0, ...(isPresetColor(f.bg) && f.bg !== 'none' ? { bg: f.bg } : {}) })
  }
  return out.sort(byOrder)
}

const EMPTY: Cell = Object.freeze({ v: null, b: false }) as Cell

/** Normalise one stored cell value of any (possibly wrong) shape. */
export function readCell(field: unknown): Cell {
  if (isPrim(field)) return field === '' ? EMPTY : { v: field, b: false }
  if (!isRecord(field)) return EMPTY
  const v = isPrim(field.v) && field.v !== '' ? field.v : null
  return {
    v,
    b: field.b === 1,
    ...(isAlign(field.a) ? { a: field.a } : {}),
    ...(isPresetColor(field.bg) && field.bg !== 'none' ? { bg: field.bg } : {}),
  }
}

export function cellOf(card: Source, rowId: string, colId: string): Cell {
  return readCell(fields(card)[cellKey(rowId, colId)])
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = DATE.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!
}

type ColLike = Pick<TableColumn, 't'> & { opts?: readonly SelectOption[] }

/**
 * The cell's value as its column's type reads it, or null if it is empty or
 * doesn't fit the type (a value is kept in storage even when the column type
 * changed, so changing back shows it again).
 * number: a finite number, or the text itself when it can't be parsed.
 */
export function cellValue(col: ColLike, cell: Cell): CellValue {
  const v = cell.v
  if (v === null) return null
  switch (col.t) {
    case 'text': return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : clip(String(v), TABLE_CAPS.cell)
    case 'number': {
      if (typeof v === 'number') return v
      if (typeof v === 'string') { const n = parseNumber(v); return n ?? v }
      return null
    }
    case 'checkbox': return typeof v === 'boolean' ? v : null
    case 'date': return isIsoDate(v) ? v : null
    case 'select': return typeof v === 'string' && col.opts?.some((o) => o.id === v) ? v : null
    case 'rating': return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null
  }
}

/** The text of a cell, for display, search, copy and sorting. */
export function cellDisplay(col: ColLike, cell: Cell): string {
  const v = cellValue(col, cell)
  if (v === null) return ''
  if (col.t === 'select') return col.opts?.find((o) => o.id === v)?.n ?? ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

/**
 * Text a number or date column could not read (typed or pasted before the type
 * was set, or not a number at all). It is kept and shown muted, never dropped.
 */
export function unreadText(col: ColLike, cell: Cell): string | null {
  const v = cell.v
  if (typeof v !== 'string') return null
  if (col.t === 'number') return parseNumber(v) === null ? clip(v, TABLE_CAPS.cell) : null
  if (col.t === 'date') return isIsoDate(v) ? null : clip(v, TABLE_CAPS.cell)
  return null
}

/** Where a cell's content sits: its own choice, else its column's, else what the type suits (numbers right; ticks and paws centred). */
export function effectiveAlign(col: Pick<TableColumn, 't' | 'a'>, cellAlign?: Align): Align {
  return cellAlign ?? col.a ?? (col.t === 'number' ? 'r' : col.t === 'checkbox' || col.t === 'rating' ? 'c' : 'l')
}

/** The table's title (synced data: anything but text reads as empty). */
export function tableTitle(card: Source): string {
  const content = fields(card).content
  return isRecord(content) && typeof content.title === 'string' ? content.title : ''
}

/**
 * A table nobody has written anything in: no title, no cell with a value, and
 * the columns still named as the starter table had them. A new one left like
 * this is discarded when its edit ends.
 */
export function isBlankTable(card: Source, starterNames: readonly string[]): boolean {
  if (tableTitle(card).trim()) return false
  const names = tableColumns(card).map((c) => c.n)
  if (names.length !== starterNames.length || names.some((n, i) => n !== starterNames[i])) return false
  for (const key of Object.keys(card)) {
    const p = parseTableKey(key)
    if (p?.kind === 'cell' && readCell(fields(card)[key]).v !== null) return false
  }
  return true
}

/** Plain text of the whole table (title, header, rows as TSV), for search and cards' text. */
export function tableText(card: Source): string {
  const title = tableTitle(card)
  const cols = tableColumns(card)
  if (!cols.length) return title
  const grid = [cols.map((c) => c.n), ...tableRows(card).map((r) => cols.map((c) => cellDisplay(c, cellOf(card, r.id, c.id))))]
  return [title, toTsv(grid)].filter(Boolean).join('\n')
}

// ---- numbers and coercion ----------------------------------------------------

/** How the person typing writes numbers and dates (the web app reads it from the browser's locale). */
export type InputLocale = { decimal: '.' | ','; dates: 'mdy' | 'dmy' | 'ymd' }

/** "12", "1,200.5", " -3 ", "1e3" -> number; anything else null. With a comma as the decimal mark, "1.200,5" reads as 1200.5. */
export function parseNumber(text: string, decimal: '.' | ',' = '.'): number | null {
  const raw = text.trim()
  // A comma mark: dots group thousands ("1.234,5", "1.234"); a lone dot ("1.5") is still a point.
  const t = decimal === ','
    ? raw.includes(',') || /^[-+]?\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw
    : raw.replace(/,/g, '')
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * ISO "2026-03-14" and "2026/3/14" always; with a locale also "3/14/2026", "14.03.2026"
 * and "14-3-26" in that locale's order (a two-digit year is 20xx). Null if it isn't a real day.
 */
export function parseDate(text: string, order: InputLocale['dates'] = 'ymd'): string | null {
  const t = text.trim()
  if (isIsoDate(t)) return t
  const m = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/.exec(t)
  if (!m) return null
  const [a, b, c] = [m[1]!, m[2]!, m[3]!]
  let y: string, mo: string, d: string
  if (a.length === 4) [y, mo, d] = [a, b, c]
  else if (order === 'dmy') [d, mo, y] = [a, b, c]
  else if (order === 'mdy') [mo, d, y] = [a, b, c]
  else return null
  if (y.length === 2) y = `20${y}`
  if (y.length !== 4 || d.length > 2) return null
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  return isIsoDate(iso) ? iso : null
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'x', '1', '✓', '☑'])
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', ''])

/**
 * Typed text -> the value to store for a column of this type. Text that doesn't
 * fit stays a string (so nothing typed or pasted is lost); a select takes an
 * option's name or id, else stays a string and shows empty.
 */
export function parseInput(col: ColLike, text: string, locale?: InputLocale): CellValue {
  const t = clip(text, TABLE_CAPS.cell)
  if (!t.trim()) return null
  switch (col.t) {
    case 'text': return t
    case 'number': return parseNumber(t, locale?.decimal) ?? t
    case 'checkbox': { const w = t.trim().toLowerCase(); return TRUE_WORDS.has(w) ? true : FALSE_WORDS.has(w) ? false : t }
    case 'date': return parseDate(t, locale?.dates) ?? t
    case 'select': { const w = t.trim(); return col.opts?.find((o) => o.id === w)?.id ?? col.opts?.find((o) => o.n.trim().toLowerCase() === w.toLowerCase())?.id ?? t }
    case 'rating': { const n = parseNumber(t); return n !== null && Number.isInteger(n) && n >= 1 && n <= 5 ? n : t }
  }
}

/** The value kept in a cell of this column: strings are clipped, non-finite numbers dropped. */
function storable(value: CellValue | undefined): CellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value === '' ? null : clip(value, TABLE_CAPS.cell)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return value
}

const hasStyle = (c: Cell) => c.b || !!c.a || !!c.bg

/** The compact stored form: a bare value if unstyled, nothing (a tombstone) if empty. */
export function encodeCell(c: Cell): CellField {
  if (!hasStyle(c)) return c.v
  return { ...(c.v !== null ? { v: c.v } : {}), ...(c.b ? { b: 1 as const } : {}), ...(c.a ? { a: c.a } : {}), ...(c.bg ? { bg: c.bg } : {}) }
}

// ---- caps ---------------------------------------------------------------------

export function tableCounts(card: Source): { rows: number; cols: number } {
  let rows = 0, cols = 0
  const f = fields(card)
  for (const key of Object.keys(card)) {
    if (f[key] == null) continue
    if (ROW_FIELD.test(key)) rows++
    else if (COLUMN_FIELD.test(key)) cols++
  }
  return { rows, cols }
}

/** Why a table object is too big for the server, or null. */
export function tableLimitError(card: Source): string | null {
  const { rows, cols } = tableCounts(card)
  if (rows > TABLE_SERVER_CAPS.rows) return 'too many rows'
  if (cols > TABLE_SERVER_CAPS.cols) return 'too many columns'
  if (JSON.stringify(card).length > TABLE_SERVER_CAPS.bytes) return 'table too large'
  return null
}

// ---- patch builders -----------------------------------------------------------

/** New rows at `at` (an index into the current order; default the end). Stops at the row cap. */
export function addRows(card: Source, count = 1, at?: number): { patch: TablePatch; ids: string[] } {
  const rows = tableRows(card)
  const n = Math.max(0, Math.min(count, TABLE_CAPS.rows - rows.length))
  if (!n) return { patch: {}, ids: [] }
  const i = Math.max(0, Math.min(at ?? rows.length, rows.length))
  const orders = ordersBetween(rows[i - 1]?.o, rows[i]?.o, n)
  const taken = new Set(Object.keys(card).flatMap((k) => { const p = parseTableKey(k); return p?.kind === 'row' ? [p.row] : [] }))
  const patch: TablePatch = {}
  const ids: string[] = []
  for (let k = 0; k < n; k++) {
    const id = tableId(taken)
    taken.add(id)
    ids.push(id)
    patch[rowKey(id)] = { o: orders[k]! } satisfies RowField
  }
  return { patch, ids }
}

/** Tombstone rows and every cell in them. */
export function deleteRows(card: Source, rowIds: Iterable<string>): TablePatch {
  const gone = new Set(rowIds)
  const patch: TablePatch = {}
  for (const key of Object.keys(card)) {
    const p = parseTableKey(key)
    if (p && (p.kind === 'row' || p.kind === 'cell') && gone.has(p.row)) patch[key] = null
  }
  for (const id of gone) patch[rowKey(id)] = null
  return patch
}

export type NewColumn = { name?: string; type?: ColumnType; width?: number; align?: Align; opts?: SelectOption[] }

/** A new column at `at` (an index; default the end). Its width is the average of the others. Nothing at the column cap. */
export function addColumn(card: Source, spec: NewColumn = {}, at?: number): { patch: TablePatch; ids: string[] } {
  const cols = tableColumns(card)
  if (cols.length >= TABLE_CAPS.cols) return { patch: {}, ids: [] }
  const i = Math.max(0, Math.min(at ?? cols.length, cols.length))
  const taken = new Set(Object.keys(card).flatMap((k) => { const p = parseTableKey(k); return p?.kind === 'col' ? [p.col] : [] }))
  const id = tableId(taken)
  const avg = cols.length ? cols.reduce((s, c) => s + c.w, 0) / cols.length : 1
  const field: NonNullable<ColumnField> = {
    n: clip(spec.name ?? '', TABLE_CAPS.name),
    o: orderBetween(cols[i - 1]?.o, cols[i]?.o),
    w: spec.width && spec.width > 0 ? spec.width : Math.round(avg * 1000) / 1000,
    t: spec.type ?? 'text',
    ...(spec.align ? { a: spec.align } : {}),
    ...(spec.opts?.length ? { opts: spec.opts.slice(0, TABLE_CAPS.options) } : {}),
  }
  return { patch: { [colKey(id)]: field }, ids: [id] }
}

/** Tombstone columns and every cell in them. */
export function deleteColumns(card: Source, colIds: Iterable<string>): TablePatch {
  const gone = new Set(colIds)
  const patch: TablePatch = {}
  for (const key of Object.keys(card)) {
    const p = parseTableKey(key)
    if (p && (p.kind === 'col' || p.kind === 'cell') && gone.has(p.col)) patch[key] = null
  }
  for (const id of gone) patch[colKey(id)] = null
  return patch
}

/** Keep the stored form of a row, only changing what is asked. */
function rowField(card: Source, id: string, change: { o?: number; bg?: PresetColor | null }): RowField {
  const row = tableRows(card).find((r) => r.id === id)
  const o = change.o ?? row?.o ?? 0
  const bg = change.bg === undefined ? row?.bg : change.bg === null || change.bg === 'none' ? undefined : change.bg
  return { o, ...(bg ? { bg } : {}) }
}

function columnField(col: TableColumn, change: Partial<Omit<TableColumn, 'id' | 'a'>> & { a?: Align | null } = {}): NonNullable<ColumnField> {
  const next = { ...col, ...change } as TableColumn & { a?: Align | null }
  const opts = next.opts
  return {
    n: clip(next.n, TABLE_CAPS.name), o: next.o, w: next.w, t: next.t,
    ...(next.a ? { a: next.a } : {}),
    ...(opts.length ? { opts: opts.slice(0, TABLE_CAPS.options) } : {}),
  }
}

/** Move a row so it ends up at `toIndex` of the new order. */
export function moveRow(card: Source, rowId: string, toIndex: number): TablePatch {
  const others = tableRows(card).filter((r) => r.id !== rowId)
  const i = Math.max(0, Math.min(toIndex, others.length))
  return { [rowKey(rowId)]: rowField(card, rowId, { o: orderBetween(others[i - 1]?.o, others[i]?.o) }) }
}

/** Move a column so it ends up at `toIndex` of the new order. */
export function moveColumn(card: Source, colId: string, toIndex: number): TablePatch {
  const cols = tableColumns(card)
  const col = cols.find((c) => c.id === colId)
  if (!col) return {}
  const others = cols.filter((c) => c.id !== colId)
  const i = Math.max(0, Math.min(toIndex, others.length))
  return { [colKey(colId)]: columnField(col, { o: orderBetween(others[i - 1]?.o, others[i]?.o) }) }
}

/**
 * Move a block of rows (the selected ones, in display order) so that they end up
 * together, in order, before the `toIndex`th of the rows that stay. One patch.
 */
export function moveRows(card: Source, rowIds: readonly string[], toIndex: number): TablePatch {
  return moveBlock(card, rowIds, toIndex, tableRows, moveRow)
}

/** Like `moveRows`, for columns. */
export function moveColumns(card: Source, colIds: readonly string[], toIndex: number): TablePatch {
  return moveBlock(card, colIds, toIndex, tableColumns, moveColumn)
}

function moveBlock(card: Source, ids: readonly string[], toIndex: number, list: (c: Source) => { id: string }[], move: (c: Source, id: string, to: number) => TablePatch): TablePatch {
  const block = new Set(ids)
  const order = list(card).map((x) => x.id)
  const picked = order.filter((id) => block.has(id))
  if (!picked.length) return {}
  const stay = order.filter((id) => !block.has(id))
  const t = Math.max(0, Math.min(toIndex, stay.length))
  // Already there: nothing to write.
  if (order.slice(t, t + picked.length).join() === picked.join() && order.indexOf(picked[0]!) === t) return {}
  const patch: TablePatch = {}
  let virtual: Record<string, unknown> = { ...(card as Record<string, unknown>) }
  let after: string | undefined = stay[t - 1]
  for (const id of picked) {
    const others = list(virtual).map((x) => x.id).filter((x) => x !== id)
    const p = move(virtual, id, after === undefined ? 0 : others.indexOf(after) + 1)
    Object.assign(patch, p)
    virtual = { ...virtual, ...p }
    after = id
  }
  return patch
}

/** Copies of rows (cells and fill) placed right after the last of them. Nothing at the row cap. */
export function duplicateRows(card: Source, rowIds: readonly string[]): { patch: TablePatch; ids: string[] } {
  const rows = tableRows(card)
  const src = rows.filter((r) => rowIds.includes(r.id))
  if (!src.length || rows.length + src.length > TABLE_CAPS.rows) return { patch: {}, ids: [] }
  const last = rows.findIndex((r) => r.id === src[src.length - 1]!.id)
  const { patch, ids } = addRows(card, src.length, last + 1)
  const f = fields(card)
  src.forEach((row, i) => {
    if (row.bg) patch[rowKey(ids[i]!)] = { ...(patch[rowKey(ids[i]!)] as object), bg: row.bg }
    for (const col of tableColumns(card)) {
      const v = f[cellKey(row.id, col.id)]
      if (v != null) patch[cellKey(ids[i]!, col.id)] = structuredClone(v)
    }
  })
  return { patch, ids }
}

/** Rename, re-align, re-weight or change the options of one column (not its type: see `retype`). */
export function updateColumn(card: Source, colId: string, change: { n?: string; w?: number; a?: Align | null; opts?: SelectOption[] }): TablePatch {
  const col = tableColumns(card).find((c) => c.id === colId)
  if (!col) return {}
  return { [colKey(colId)]: columnField(col, change) }
}

/** Fill one or more rows (`null` or 'none' clears). */
export function setRowFill(card: Source, rowIds: Iterable<string>, bg: PresetColor | null): TablePatch {
  const patch: TablePatch = {}
  for (const id of rowIds) patch[rowKey(id)] = rowField(card, id, { bg })
  return patch
}

// ---- select options -----------------------------------------------------------

const PALETTE_COLORS = CARD_COLORS.filter((c) => c !== 'none')

/** The next colour for a new option: the first of the palette that no option uses yet, else round again. */
export function nextOptionColor(opts: readonly SelectOption[]): PresetColor {
  const used = new Set(opts.map((o) => o.c))
  return PALETTE_COLORS.find((c) => !used.has(c)) ?? PALETTE_COLORS[opts.length % PALETTE_COLORS.length]!
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The option with this name (any case) in a column, if there is one. */
export function findOption(opts: readonly SelectOption[], name: string): SelectOption | undefined {
  return opts.find((o) => sameName(o.n, name))
}

/**
 * A new option on a column. If one has the name already, that one is returned and
 * nothing is written. Null at the option cap or for an empty name.
 */
export function addOption(card: Source, colId: string, name: string, color?: PresetColor): { patch: TablePatch; option: SelectOption } | null {
  const col = tableColumns(card).find((c) => c.id === colId)
  const n = clip(name.replace(/\s+/g, ' ').trim(), TABLE_CAPS.name)
  if (!col || !n) return null
  const known = findOption(col.opts, n)
  if (known) return { patch: {}, option: known }
  if (col.opts.length >= TABLE_CAPS.options) return null
  const option: SelectOption = { id: optionId(new Set(col.opts.map((o) => o.id))), n, c: color ?? nextOptionColor(col.opts) }
  return { patch: updateColumn(card, colId, { opts: [...col.opts, option] }), option }
}

/** Rename or recolour one option. Cells keep pointing at it by id. */
export function updateOption(card: Source, colId: string, optId: string, change: { n?: string; c?: PresetColor }): TablePatch {
  const col = tableColumns(card).find((c) => c.id === colId)
  if (!col || !col.opts.some((o) => o.id === optId)) return {}
  const opts = col.opts.map((o) => (o.id === optId ? { id: o.id, n: change.n === undefined ? o.n : clip(change.n.trim(), TABLE_CAPS.name), c: change.c ?? o.c } : o))
  return updateColumn(card, colId, { opts })
}

/** Delete an option and empty the cells that had it. */
export function removeOption(card: Source, colId: string, optId: string): TablePatch {
  const col = tableColumns(card).find((c) => c.id === colId)
  if (!col || !col.opts.some((o) => o.id === optId)) return {}
  const patch = updateColumn(card, colId, { opts: col.opts.filter((o) => o.id !== optId) })
  const stale: CellRef[] = []
  for (const row of tableRows(card)) if (cellOf(card, row.id, colId).v === optId) stale.push({ row: row.id, col: colId })
  return Object.assign(patch, clearCells(card, stale))
}

/** Move an option to `toIndex` of the new order. */
export function moveOption(card: Source, colId: string, optId: string, toIndex: number): TablePatch {
  const col = tableColumns(card).find((c) => c.id === colId)
  const from = col?.opts.findIndex((o) => o.id === optId) ?? -1
  if (!col || from < 0) return {}
  const opts = [...col.opts]
  const [o] = opts.splice(from, 1)
  opts.splice(Math.max(0, Math.min(toIndex, opts.length)), 0, o!)
  if (opts.every((x, i) => x === col.opts[i])) return {}
  return updateColumn(card, colId, { opts })
}

export type CellRef = { row: string; col: string }

/**
 * Write values into cells. Existing styles stay. A value is stored as given
 * (callers run typed text through `parseInput`); an empty one removes the cell.
 */
export function setCells(card: Source, entries: Iterable<CellRef & { value: CellValue }>): TablePatch {
  const patch: TablePatch = {}
  for (const { row, col, value } of entries) {
    const key = cellKey(row, col)
    const prev = key in patch ? readCell(patch[key]) : cellOf(card, row, col)
    patch[key] = encodeCell({ ...prev, v: storable(value) })
  }
  return nullify(patch)
}

/** Empty cells (the Delete key). Their styles stay. */
export function clearCells(card: Source, refs: Iterable<CellRef>): TablePatch {
  return setCells(card, [...refs].map((r) => ({ ...r, value: null })))
}

export type CellStyle = { b?: boolean; a?: Align | null; bg?: PresetColor | null }

/** Bold, alignment and fill for cells (`null` or 'none' removes a fill or alignment). Values stay. */
export function setStyle(card: Source, refs: Iterable<CellRef>, style: CellStyle): TablePatch {
  const patch: TablePatch = {}
  for (const { row, col } of refs) {
    const key = cellKey(row, col)
    const prev = key in patch ? readCell(patch[key]) : cellOf(card, row, col)
    const next: Cell = { v: prev.v, b: style.b ?? prev.b }
    const a = style.a === undefined ? prev.a : style.a ?? undefined
    const bg = style.bg === undefined ? prev.bg : style.bg === null || style.bg === 'none' ? undefined : style.bg
    if (a) next.a = a
    if (bg) next.bg = bg
    patch[key] = encodeCell(next)
  }
  return nullify(patch)
}

/** `undefined` and empty become the null tombstone. */
function nullify(patch: TablePatch): TablePatch {
  for (const key of Object.keys(patch)) if (patch[key] === undefined || patch[key] === '') patch[key] = null
  return patch
}

/**
 * Dragging the boundary after column `leftColId`: `delta` weight moves from its
 * right neighbour to it (negative the other way), until either is `min` wide.
 * The weights' sum is unchanged, so the card keeps its size.
 */
export function resizeBoundary(card: Source, leftColId: string, delta: number, min = MIN_COLUMN_WEIGHT): TablePatch {
  const cols = tableColumns(card)
  const i = cols.findIndex((c) => c.id === leftColId)
  const left = cols[i], right = cols[i + 1]
  if (!left || !right || !finite(delta)) return {}
  const d = Math.max(min - left.w, Math.min(right.w - min, delta))
  if (!d) return {}
  const round = (n: number) => Math.round(n * 1000) / 1000
  return {
    [colKey(left.id)]: columnField(left, { w: round(left.w + d) }),
    [colKey(right.id)]: columnField(right, { w: round(right.w - d) }),
  }
}

// ---- retyping -----------------------------------------------------------------

function toText(col: TableColumn, cell: Cell): string | null {
  if (cell.v === null) return null
  if (col.t === 'select') { const name = col.opts.find((o) => o.id === cell.v)?.n; return name ?? null }
  if (typeof cell.v === 'boolean') return cell.v ? 'TRUE' : 'FALSE'
  return String(cell.v)
}


/**
 * Change a column's type. Values that convert without loss are converted;
 * anything else stays as it is (it shows empty under the new type and
 * reappears if the type changes back). Text -> select builds the options
 * from the distinct values (keeping existing options of the same name).
 */
export function retype(card: Source, colId: string, to: ColumnType): TablePatch {
  const col = tableColumns(card).find((c) => c.id === colId)
  if (!col || col.t === to) return {}
  const patch: TablePatch = {}
  const rows = tableRows(card)
  let opts = col.opts
  if (to === 'select') {
    const known = new Map(opts.map((o) => [o.n.trim().toLowerCase(), o]))
    const taken = new Set(opts.map((o) => o.id))
    const next = [...opts]
    for (const row of rows) {
      const text = toText(col, cellOf(card, row.id, colId))?.trim()
      if (!text || known.has(text.toLowerCase()) || next.length >= TABLE_CAPS.options) continue
      const o: SelectOption = { id: optionId(taken), n: clip(text, TABLE_CAPS.name), c: PALETTE_COLORS[next.length % PALETTE_COLORS.length]! }
      taken.add(o.id); next.push(o); known.set(text.toLowerCase(), o)
    }
    opts = next
    patch[colKey(colId)] = columnField(col, { t: to, opts })
    for (const row of rows) {
      const cell = cellOf(card, row.id, colId)
      const text = toText(col, cell)?.trim()
      const id = text ? known.get(text.toLowerCase())?.id : undefined
      if (id && id !== cell.v) patch[cellKey(row.id, colId)] = encodeCell({ ...cell, v: id })
    }
    return patch
  }
  patch[colKey(colId)] = columnField(col, { t: to })
  for (const row of rows) {
    const cell = cellOf(card, row.id, colId)
    const text = toText(col, cell)
    if (text === null) continue
    const next = convertText(to, text)
    if (next !== undefined && next !== cell.v) patch[cellKey(row.id, colId)] = encodeCell({ ...cell, v: next })
  }
  return patch
}

/** Text read as a value of this type, or undefined if reading it would lose something. */
function convertText(to: ColumnType, text: string): CellValue | undefined {
  switch (to) {
    case 'text': return clip(text, TABLE_CAPS.cell)
    case 'number': return parseNumber(text) ?? undefined
    case 'checkbox': { const w = text.trim().toLowerCase(); return TRUE_WORDS.has(w) ? true : FALSE_WORDS.has(w) ? false : undefined }
    case 'date': return parseDate(text) ?? undefined
    case 'rating': { const n = parseNumber(text); return n !== null && Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined }
    case 'select': return undefined
  }
}

// ---- sorting ------------------------------------------------------------------

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * Comparator for cells of a column of this type. Empty cells go last whichever
 * way it sorts; equal cells compare 0 (the sort is stable). Pass the column
 * itself for a select, to sort by option name.
 */
export function compareCells(col: ColumnType | ColLike, dir: 'asc' | 'desc' = 'asc'): (a: Cell, b: Cell) => number {
  const like: ColLike = typeof col === 'string' ? { t: col, opts: [] } : col
  const sign = dir === 'desc' ? -1 : 1
  return (a, b) => {
    const x = cellValue(like, a), y = cellValue(like, b)
    const ex = x === null, ey = y === null
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1
    let r: number
    if (like.t === 'select') r = collator.compare(cellDisplay(like, a), cellDisplay(like, b))
    else if (typeof x === 'number' && typeof y === 'number') r = x - y
    else if (typeof x === 'boolean' && typeof y === 'boolean') r = Number(x) - Number(y)
    // Numbers before the text a number column couldn't read.
    else if (typeof x === 'number') r = -1
    else if (typeof y === 'number') r = 1
    else r = collator.compare(String(x), String(y))
    return r * sign
  }
}

/** Row orders that sort the table by a column. Only rows whose position changes are written. */
export function sortRows(card: Source, colId: string, dir: 'asc' | 'desc' = 'asc'): TablePatch {
  const col = tableColumns(card).find((c) => c.id === colId)
  if (!col) return {}
  const compare = compareCells(col, dir)
  const rows = tableRows(card)
  const indexed = rows.map((row, i) => ({ row, i, cell: cellOf(card, row.id, colId) }))
  indexed.sort((a, b) => compare(a.cell, b.cell) || a.i - b.i)
  const patch: TablePatch = {}
  indexed.forEach(({ row }, i) => {
    if (row.o !== i + 1) patch[rowKey(row.id)] = rowField(card, row.id, { o: i + 1 })
  })
  return patch
}

// ---- clipboard (TSV) ----------------------------------------------------------

/** Tab-separated text as Excel and Sheets write it: quoted fields, any line ending, ragged rows kept. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let started = false
  let i = 0
  const endRow = () => { row.push(field); rows.push(row); row = []; field = ''; started = false }
  while (i < text.length) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false
      } else field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') { quoted = true; started = true }
    else if (ch === '\t') { row.push(field); field = '' }
    else if (ch === '\r') { endRow(); if (text[i + 1] === '\n') i++ }
    else if (ch === '\n') endRow()
    else field += ch
    i++
  }
  // A final line ending doesn't start another row.
  if (field !== '' || row.length || started) endRow()
  return rows
}

const NEEDS_QUOTES = /["\t\r\n]/

/** Rows to tab-separated text with Excel quoting and CRLF line endings. */
export function toTsv(rows: readonly (readonly string[])[]): string {
  const cell = (s: string) => (NEEDS_QUOTES.test(s) ? `"${s.replaceAll('"', '""')}"` : s)
  return rows.map((r) => (r.length === 1 && r[0] === '' ? '""' : r.map(cell).join('\t'))).join('\r\n')
}

/** Is pasted text a grid worth making into a table: tabs, two or more lines, mostly two or more columns, within the caps. */
export function looksTabular(text: string): boolean {
  if (!text.includes('\t')) return false
  const rows = parseTsv(text)
  if (rows.length < 2 || rows.length > TABLE_CAPS.rows + 1) return false
  const wide = rows.filter((r) => r.length >= 2).length
  return wide >= Math.ceil(rows.length * 0.6) && Math.max(...rows.map((r) => r.length)) <= TABLE_CAPS.cols
}

/** Does the first row of pasted data read as column names: all filled in, all words (no numbers or dates), all different, and something below. */
export function guessHeader(rows: readonly (readonly string[])[]): boolean {
  const first = rows[0]
  if (!first || rows.length < 2 || !first.length) return false
  const names = first.map((s) => s.trim().toLowerCase())
  if (names.some((s) => !s || parseNumber(s) !== null || parseDate(s) !== null)) return false
  return new Set(names).size === names.length
}

/** The text of rows and columns as copied: the cells' display text, with the column names first when `header` is set. */
export function copyGrid(card: Source, rowIds: readonly string[], colIds: readonly string[], header: boolean): string[][] {
  const cols = colIds.map((id) => tableColumns(card).find((c) => c.id === id)).filter((c): c is TableColumn => !!c)
  const out = rowIds.map((r) => cols.map((c) => cellDisplay(c, cellOf(card, r, c.id))))
  return header ? [cols.map((c) => c.n), ...out] : out
}

export type PasteResult = {
  patch: TablePatch
  /** Some of the text did not fit under the row or column limits. */
  clipped: boolean
  /** The cells written, as indices after the paste (rows from -1 for the header). */
  range: { r0: number; r1: number; c0: number; c1: number }
}

/**
 * Paste a grid of text with its top-left cell at `at` (row -1 is the header),
 * growing the table up to the caps. One value pasted over a range of several
 * cells fills it. Text goes through `parseInput` for its column; a header takes
 * the text as its name. Ragged lines leave the cells they don't reach alone.
 */
export function pasteGrid(card: Source, grid: readonly (readonly string[])[], at: { r: number; c: number }, fill?: { r0: number; r1: number; c0: number; c1: number }): PasteResult {
  const patch: TablePatch = {}
  let virtual: Record<string, unknown> = { ...(card as Record<string, unknown>) }
  const apply = (p: TablePatch) => { Object.assign(patch, p); virtual = { ...virtual, ...p } }
  const single = grid.length === 1 && grid[0]!.length === 1 && !!fill && (fill.r1 > fill.r0 || fill.c1 > fill.c0)
  const r0 = single ? fill!.r0 : at.r
  const c0 = single ? fill!.c0 : at.c
  const height = single ? fill!.r1 - fill!.r0 + 1 : grid.length
  const width = single ? fill!.c1 - fill!.c0 + 1 : Math.max(0, ...grid.map((l) => l.length))
  let clipped = false
  for (let n = tableColumns(virtual).length; n < c0 + width; n++) {
    const { patch: p, ids } = addColumn(virtual, {}, n)
    if (!ids.length) { clipped = true; break }
    apply(p)
  }
  const have = tableRows(virtual).length
  if (have < r0 + height) {
    const { patch: p, ids } = addRows(virtual, r0 + height - have, have)
    if (ids.length < r0 + height - have) clipped = true
    apply(p)
  }
  const cols = tableColumns(virtual), rows = tableRows(virtual)
  const entries: (CellRef & { value: CellValue })[] = []
  const written = { r1: r0 - 1, c1: c0 - 1 }
  for (let i = 0; i < height; i++) {
    const r = r0 + i
    if (r >= rows.length) { clipped = true; break }
    const line = single ? grid[0]! : grid[i]!
    for (let j = 0; j < (single ? width : line.length); j++) {
      const c = c0 + j
      if (c >= cols.length) { clipped = true; break }
      const text = single ? line[0]! : line[j]!
      const col = cols[c]!
      written.r1 = Math.max(written.r1, r)
      written.c1 = Math.max(written.c1, c)
      if (r < 0) { apply(updateColumn(virtual, col.id, { n: text.replace(/\s*[\r\n]+\s*/g, ' ').trim() })); continue }
      const value = parseInput(col, text)
      const key = cellKey(rows[r]!.id, col.id)
      // Nothing to blank in a cell that has no field.
      if (value === null && fields(virtual)[key] == null) continue
      entries.push({ row: rows[r]!.id, col: col.id, value })
    }
  }
  apply(setCells(virtual, entries))
  return { patch, clipped, range: { r0, r1: Math.max(r0, written.r1), c0, c1: Math.max(c0, written.c1) } }
}

// ---- validation and copying ---------------------------------------------------

function validRow(v: Record<string, unknown>): boolean {
  return Object.keys(v).every((k) => k === 'o' || k === 'bg') && finite(v.o) && Math.abs(v.o) <= 1e12 && (v.bg === undefined || isPresetColor(v.bg))
}

function validColumn(v: Record<string, unknown>): boolean {
  if (!Object.keys(v).every((k) => ['n', 'o', 'w', 't', 'a', 'opts'].includes(k))) return false
  if (typeof v.n !== 'string' || v.n.length > TABLE_CAPS.name || !finite(v.o) || Math.abs(v.o) > 1e12) return false
  if (!finite(v.w) || v.w <= 0 || v.w > 1000 || !isType(v.t)) return false
  if (v.a !== undefined && !isAlign(v.a)) return false
  if (v.opts === undefined) return true
  if (!Array.isArray(v.opts) || v.opts.length > TABLE_CAPS.options) return false
  const seen = new Set<string>()
  return v.opts.every((o) => {
    if (!isRecord(o) || Object.keys(o).some((k) => k !== 'id' && k !== 'n' && k !== 'c')) return false
    if (typeof o.id !== 'string' || !OPTION_ID.test(o.id) || seen.has(o.id)) return false
    seen.add(o.id)
    return typeof o.n === 'string' && o.n.length <= TABLE_CAPS.name && isPresetColor(o.c)
  })
}

const validPrim = (v: unknown) => (typeof v === 'string' ? v.length <= TABLE_CAPS.cell : isPrim(v))

function validCell(v: unknown): boolean {
  if (isPrim(v)) return validPrim(v)
  if (!isRecord(v)) return false
  if (!Object.keys(v).every((k) => k === 'v' || k === 'b' || k === 'a' || k === 'bg')) return false
  return (v.v === undefined || validPrim(v.v)) && (v.b === undefined || v.b === 1) && (v.a === undefined || isAlign(v.a)) && (v.bg === undefined || isPresetColor(v.bg))
}

/** May this value be written to this table key? Null and undefined are tombstones, valid anywhere. */
export function validTableField(key: string, value: unknown): boolean {
  const p = parseTableKey(key)
  if (!p) return false
  if (value === null || value === undefined) return true
  if (p.kind === 'cell') return validCell(value)
  if (!isRecord(value)) return false
  return p.kind === 'row' ? validRow(value) : validColumn(value)
}

/** A copy of a card without its removed (null) table fields, for duplicating or restoring it. */
export function withoutTableTombstones<T extends Source>(card: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(card)) if (!(v == null && TABLE_FIELD.test(k))) out[k] = v
  return out as T
}

/** The fields of a fresh table: named columns and empty rows. The caller supplies the (themed) names. */
export function starterTable(names: readonly string[], rowCount = 3): TablePatch {
  const patch: TablePatch = {}
  const taken = new Set<string>()
  names.slice(0, TABLE_CAPS.cols).forEach((name, i) => {
    const id = tableId(taken)
    taken.add(id)
    patch[colKey(id)] = { n: clip(name, TABLE_CAPS.name), o: i + 1, w: 1, t: 'text' } satisfies ColumnField
  })
  for (let i = 0; i < Math.min(rowCount, TABLE_CAPS.rows); i++) {
    const id = tableId(taken)
    taken.add(id)
    patch[rowKey(id)] = { o: i + 1 } satisfies RowField
  }
  return patch
}

/**
 * A table built from a grid of text (a paste): optionally the first row as
 * column names, otherwise `fallbackNames(i)`. Text is read by the column's type,
 * which stays 'text' (retype afterwards if wanted).
 */
export function tableFromGrid(grid: readonly (readonly string[])[], opts: { header: boolean; fallbackName: (i: number) => string }): TablePatch {
  const width = Math.min(TABLE_CAPS.cols, Math.max(0, ...grid.map((r) => r.length)))
  const body = (opts.header ? grid.slice(1) : grid).slice(0, TABLE_CAPS.rows)
  const names = Array.from({ length: width }, (_, i) => (opts.header ? grid[0]?.[i]?.trim() : '') || opts.fallbackName(i))
  const patch = starterTable(names, 0)
  const cols = tableColumns(patch)
  const taken = new Set(Object.keys(patch).flatMap((k) => { const p = parseTableKey(k); return p?.kind === 'col' ? [p.col] : [] }))
  body.forEach((line, r) => {
    const id = tableId(taken)
    taken.add(id)
    patch[rowKey(id)] = { o: r + 1 }
    cols.forEach((col, c) => {
      const value = storable(line[c] ?? null)
      if (value !== null) patch[cellKey(id, col.id)] = value
    })
  })
  return patch
}
