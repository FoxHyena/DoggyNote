import { CARD_COLORS, isPresetColor, type PresetColor } from '@doggynote/theme'
import { ordersBetween } from './order.ts'
import {
  COLUMN_TYPES, TABLE_CAPS, cellKey, cellOf, cellValue, colKey, encodeCell, findOption, isIsoDate, nextOptionColor, optionId, parseNumber, readCell, rowKey, tableColumns, tableId, tableRows, tableTitle,
  type Align, type Cell, type CellValue, type ColumnField, type ColumnType, type Prim, type RowField, type SelectOption, type TablePatch,
} from './table.ts'

// What an agent sees of a table card, and the translation both ways.
//
// A table is stored as one top-level field per row, column and cell (see
// table.ts), with ids, order values and option ids that mean nothing to an
// agent. The agent shape is plain: columns in order, rows in order, and each
// row's cells in column order. Select cells use the option's NAME.
//
//   toAgentTable(card)             storage -> agent (what read_board returns)
//   fromAgentTable(agent, prev?)   agent -> flat fields (what a proposal stores)
//
// Ids are optional on the way in. Those from read_board keep a row or column
// the same object (and its `o`, so sync merges still line up); a row or column
// without one is new. Only rows that really moved get new order values.

export type AgentAlign = 'left' | 'center' | 'right'
export type AgentCellStyle = { value?: Prim | null; bold?: boolean; align?: AgentAlign; color?: PresetColor }
export type AgentValue = Prim | AgentCellStyle | null
export type AgentOption = { id?: string; name: string; color?: PresetColor }
export type AgentColumn = { id?: string; name: string; type?: ColumnType; width?: number; align?: AgentAlign; options?: AgentOption[] }
export type AgentRow = { id?: string; color?: PresetColor; cells: AgentValue[] }
export type AgentTable = { title: string; columns: AgentColumn[]; rows: AgentRow[] }

const ALIGN_OUT: Record<Align, AgentAlign> = { l: 'left', c: 'center', r: 'right' }
const ALIGN_IN: Record<AgentAlign, Align> = { left: 'l', center: 'c', right: 'r' }
const ID = /^[0-9][0-9a-z]{5}$/
const OPTION_ID = /^[0-9][0-9a-z]{3}$/
const MAX_TITLE = 1000

// ---- storage -> agent -----------------------------------------------------------

/** A cell as the agent sees it: the value its column's type reads (a select as its option's name). */
function agentValue(col: { t: ColumnType; opts: SelectOption[] }, cell: Cell): AgentValue {
  const v = cellValue(col, cell)
  const value: Prim | null = col.t === 'select' ? col.opts.find((o) => o.id === v)?.n ?? null : v
  if (!cell.b && !cell.a && !cell.bg) return value
  return { value, ...(cell.b ? { bold: true } : {}), ...(cell.a ? { align: ALIGN_OUT[cell.a] } : {}), ...(cell.bg ? { color: cell.bg } : {}) }
}

/** The agent's view of a table card (anything that is not well formed reads as empty). */
export function toAgentTable(card: object): AgentTable {
  const cols = tableColumns(card)
  return {
    title: tableTitle(card),
    columns: cols.map((c) => ({
      id: c.id, name: c.n, type: c.t, width: c.w,
      ...(c.a ? { align: ALIGN_OUT[c.a] } : {}),
      ...(c.t === 'select' ? { options: c.opts.map((o) => ({ id: o.id, name: o.n, ...(o.c !== 'none' ? { color: o.c } : {}) })) } : {}),
    })),
    rows: tableRows(card).map((r) => ({
      id: r.id,
      ...(r.bg ? { color: r.bg } : {}),
      cells: cols.map((c) => agentValue(c, cellOf(card, r.id, c.id))),
    })),
  }
}

// ---- agent -> storage -----------------------------------------------------------

export type FromAgent = { ok: true; fields: TablePatch & { content: { title: string } } } | { ok: false; error: string }

class Refused extends Error {}
const refuse = (message: string): never => { throw new Refused(message) }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Longest strictly increasing run of `keys` (indices into it); undefined keys never take part. */
function longestIncreasing(keys: readonly (number | undefined)[]): Set<number> {
  const tails: number[] = [] // index of the smallest tail for each length
  const prev: number[] = new Array(keys.length).fill(-1)
  keys.forEach((k, i) => {
    if (k === undefined) return
    let lo = 0, hi = tails.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[tails[mid]!]! < k) lo = mid + 1; else hi = mid }
    if (lo > 0) prev[i] = tails[lo - 1]!
    tails[lo] = i
  })
  const out = new Set<number>()
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) out.add(i)
  return out
}

/**
 * Order values for items in their new sequence. Items that keep their old value
 * are the longest run still in order; the rest (new or moved) get values
 * between their neighbours.
 */
function assignOrders(old: readonly (number | undefined)[]): number[] {
  const keep = longestIncreasing(old)
  const out: number[] = new Array(old.length)
  let i = 0
  let before: number | undefined
  while (i < old.length) {
    if (keep.has(i)) { out[i] = before = old[i]!; i++; continue }
    let j = i
    while (j < old.length && !keep.has(j)) j++
    const after = j < old.length ? old[j] : undefined
    ordersBetween(before, after, j - i).forEach((o, k) => { out[i + k] = o })
    i = j
  }
  return out
}

function checkId(kind: string, n: number, id: unknown, seen: Set<string>): string | undefined {
  if (id === undefined) return undefined
  if (typeof id !== 'string' || !ID.test(id)) return refuse(`${kind} ${n}: "${String(id)}" is not an id from read_board (leave id out for a new ${kind.toLowerCase()})`)
  if (seen.has(id)) return refuse(`${kind} ${n}: id ${id} is used twice`)
  seen.add(id)
  return id
}

const colour = (where: string, c: unknown): PresetColor | undefined => {
  if (c === undefined || c === 'none') return undefined
  if (!isPresetColor(c)) return refuse(`${where}: unknown colour "${String(c)}" (use ${CARD_COLORS.join(', ')})`)
  return c
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

type BuiltColumn = { id: string; field: NonNullable<ColumnField>; opts: SelectOption[]; label: string }

function buildColumn(spec: AgentColumn, n: number, id: string, old: { n: string; o: number; w: number; opts: SelectOption[] } | undefined, order: number, width: number): BuiltColumn {
  if (!isObject(spec) || typeof spec.name !== 'string') refuse(`Column ${n}: needs a name`)
  const label = spec.name.trim() ? `"${spec.name.trim()}"` : `column ${n}`
  if (spec.name.length > TABLE_CAPS.name) refuse(`Column ${n}: name is longer than ${TABLE_CAPS.name} characters`)
  const t = spec.type ?? 'text'
  if (!COLUMN_TYPES.includes(t)) refuse(`Column ${label}: type must be one of ${COLUMN_TYPES.join(', ')}`)
  if (spec.align !== undefined && !(spec.align in ALIGN_IN)) refuse(`Column ${label}: align must be left, center or right`)
  if (spec.width !== undefined && !(typeof spec.width === 'number' && Number.isFinite(spec.width) && spec.width > 0 && spec.width <= 1000)) refuse(`Column ${label}: width must be a number above 0 (relative to the other columns)`)
  if (spec.options !== undefined && t !== 'select') refuse(`Column ${label}: options only belong on a column with type "select"`)
  const opts: SelectOption[] = []
  if (t === 'select' && spec.options) {
    if (!Array.isArray(spec.options)) refuse(`Column ${label}: options must be a list`)
    if (spec.options.length > TABLE_CAPS.options) refuse(`Column ${label}: at most ${TABLE_CAPS.options} options`)
    const taken = new Set<string>()
    const known = old?.opts ?? []
    spec.options.forEach((o, i) => {
      if (!isObject(o) || typeof o.name !== 'string' || !o.name.trim()) return refuse(`Column ${label}, option ${i + 1}: needs a name`)
      if (o.name.length > TABLE_CAPS.name) return refuse(`Column ${label}, option ${i + 1}: name is longer than ${TABLE_CAPS.name} characters`)
      if (opts.some((x) => same(x.n, o.name))) return refuse(`Column ${label}: option "${o.name.trim()}" is listed twice`)
      let optId = o.id
      if (optId !== undefined && (typeof optId !== 'string' || !OPTION_ID.test(optId) || taken.has(optId))) return refuse(`Column ${label}, option ${i + 1}: "${String(optId)}" is not an option id from read_board (leave id out for a new option)`)
      // No id: the option of the same name stays the same option.
      const prior = optId ? known.find((k) => k.id === optId) : known.find((k) => same(k.n, o.name) && !taken.has(k.id) && !spec.options!.some((x) => x !== o && x.id === k.id))
      optId ??= prior?.id
      optId ??= optionId(new Set([...taken, ...known.map((k) => k.id)]))
      taken.add(optId)
      opts.push({ id: optId, n: o.name.trim(), c: colour(`Column ${label}, option "${o.name.trim()}"`, o.color) ?? (o.color === 'none' ? 'none' : prior?.c ?? nextOptionColor(opts)) })
    })
  }
  const field: NonNullable<ColumnField> = {
    n: spec.name, o: order, w: spec.width ?? old?.w ?? width, t,
    ...(spec.align ? { a: ALIGN_IN[spec.align] } : {}),
    ...(opts.length ? { opts } : {}),
  }
  return { id, field, opts, label }
}

/** One cell value for a column of this type, as the value to store. */
function coerce(col: BuiltColumn, t: ColumnType, value: Prim | null | undefined, oldRaw: CellValue | undefined): CellValue {
  if (value === null || value === undefined || value === '') return null
  // A value the table already holds, unchanged, stays as it is (even if the type doesn't read it).
  if (t !== 'select' && oldRaw !== undefined && oldRaw !== null && oldRaw === value) return value
  const bad = (hint: string): never => refuse(hint)
  switch (t) {
    case 'text':
      if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
      return limitText(String(value))
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : bad('use a finite number')
      if (typeof value === 'string') return parseNumber(value) ?? bad('use a number')
      return bad('use a number')
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return value
      if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true'
      return bad('use true or false')
    }
    case 'date':
      return typeof value === 'string' && isIsoDate(value.trim()) ? value.trim() : bad('use YYYY-MM-DD')
    case 'rating': {
      const n = typeof value === 'string' ? parseNumber(value) : value
      return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5 ? n : bad('use a whole number from 1 to 5')
    }
    case 'select': {
      if (typeof value === 'boolean') return bad('use an option name')
      const name = String(value).trim()
      if (name.length > TABLE_CAPS.name) return bad(`an option name is at most ${TABLE_CAPS.name} characters`)
      let option = findOption(col.opts, name)
      if (!option) {
        if (col.opts.length >= TABLE_CAPS.options) return bad(`this column already has ${TABLE_CAPS.options} options`)
        option = { id: optionId(new Set(col.opts.map((o) => o.id))), n: name, c: nextOptionColor(col.opts) }
        col.opts.push(option)
      }
      return option.id
    }
  }
}

function limitText(s: string): string {
  return s.length > TABLE_CAPS.cell ? refuse(`text is longer than ${TABLE_CAPS.cell} characters`) : s
}

/**
 * The flat fields (`tr…`, `tk…`, `tc…` and `content: { title }`) for an agent's
 * table. `prev` is the table being replaced: ids found there keep their order
 * values, widths and option ids, and values the agent saw as empty because they
 * don't fit the column type stay where they are. Nothing in `prev` is copied
 * over otherwise, so what the agent leaves out is removed.
 */
export function fromAgentTable(agent: unknown, prev?: object): FromAgent {
  try {
    return { ok: true, fields: build(agent, prev) }
  } catch (e) {
    if (e instanceof Refused) return { ok: false, error: e.message }
    throw e
  }
}

function build(agent: unknown, prev: object | undefined): TablePatch & { content: { title: string } } {
  if (!isObject(agent)) return refuse('A table needs content with a title, columns and rows')
  const title = agent.title === undefined ? '' : agent.title
  if (typeof title !== 'string' || title.length > MAX_TITLE) return refuse(`The title must be text of at most ${MAX_TITLE} characters`)
  const { columns, rows } = agent
  if (!Array.isArray(columns) || !columns.length) return refuse('A table needs at least one column')
  if (columns.length > TABLE_CAPS.cols) return refuse(`Too many columns: ${columns.length} (at most ${TABLE_CAPS.cols})`)
  if (!Array.isArray(rows)) return refuse('rows must be a list (it may be empty)')
  if (rows.length > TABLE_CAPS.rows) return refuse(`Too many rows: ${rows.length} (at most ${TABLE_CAPS.rows}; make another table for the rest)`)

  const oldCols = new Map((prev ? tableColumns(prev) : []).map((c) => [c.id, c]))
  const oldRows = new Map((prev ? tableRows(prev) : []).map((r) => [r.id, r]))
  const patch: TablePatch = { content: { title } }

  // Columns.
  const colIds = new Set<string>()
  const given = columns.map((c, i) => checkId('Column', i + 1, (c as AgentColumn | undefined)?.id, colIds))
  const orders = assignOrders(given.map((id) => (id ? oldCols.get(id)?.o : undefined)))
  const widths = columns.map((c: AgentColumn, i) => (isObject(c) && typeof c.width === 'number' ? c.width : given[i] ? oldCols.get(given[i]!)?.w : undefined)).filter((w): w is number => typeof w === 'number' && w > 0)
  const avg = widths.length ? Math.round((widths.reduce((s, w) => s + w, 0) / widths.length) * 1000) / 1000 : 1
  const built: BuiltColumn[] = columns.map((spec: AgentColumn, i) => {
    const id = given[i] ?? tableId(colIds)
    colIds.add(id)
    return buildColumn(spec, i + 1, id, oldCols.get(id), orders[i]!, avg)
  })

  // Rows and cells.
  const rowIds = new Set<string>()
  const givenRows = rows.map((r, i) => checkId('Row', i + 1, (r as AgentRow | undefined)?.id, rowIds))
  const rowOrders = assignOrders(givenRows.map((id) => (id ? oldRows.get(id)?.o : undefined)))
  rows.forEach((row: AgentRow, i) => {
    const n = i + 1
    if (!isObject(row) || !Array.isArray(row.cells)) return refuse(`Row ${n}: needs cells (one value per column, in column order)`)
    if (row.cells.length > built.length) return refuse(`Row ${n}: has ${row.cells.length} cells but the table has ${built.length} columns`)
    const id = givenRows[i] ?? tableId(rowIds)
    rowIds.add(id)
    const bg = colour(`Row ${n}`, row.color)
    patch[rowKey(id)] = { o: rowOrders[i]!, ...(bg ? { bg } : {}) } satisfies RowField
    row.cells.forEach((raw: AgentValue, j) => {
      const col = built[j]!
      const where = `Row ${n}, ${col.label}`
      let value: Prim | null | undefined, b = false, a: Align | undefined, bg2: PresetColor | undefined
      if (isObject(raw)) {
        const extra = Object.keys(raw).find((k) => !['value', 'bold', 'align', 'color'].includes(k))
        if (extra) return refuse(`${where}: "${extra}" is not a cell property (use value, bold, align, color)`)
        value = raw.value as Prim | null | undefined
        if (value !== null && value !== undefined && typeof value === 'object') return refuse(`${where}: value must be text, a number, true/false or null`)
        b = raw.bold === true
        if (raw.bold !== undefined && typeof raw.bold !== 'boolean') return refuse(`${where}: bold must be true or false`)
        if (raw.align !== undefined && !(raw.align in ALIGN_IN)) return refuse(`${where}: align must be left, center or right`)
        a = raw.align ? ALIGN_IN[raw.align] : undefined
        bg2 = colour(where, raw.color)
      } else if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') return refuse(`${where}: use text, a number, true/false, null or { value, bold, align, color }`)
      else value = raw
      const old = prev && oldRows.has(id) && oldCols.has(col.id) ? readCell((prev as Record<string, unknown>)[cellKey(id, col.id)]) : undefined
      let v: CellValue
      try { v = coerce(col, col.field.t, value, old?.v ?? undefined) } catch (e) { return refuse(`${where}: ${e instanceof Refused ? e.message : 'invalid value'}`) }
      // A value the agent saw as empty only because it doesn't fit the type is left alone.
      const oldCol = oldCols.get(col.id)
      if (v === null && old && old.v !== null && oldCol && cellValue(oldCol, old) === null && (value === null || value === undefined || value === '')) v = old.v
      const stored = encodeCell({ v, b, ...(a ? { a } : {}), ...(bg2 ? { bg: bg2 } : {}) })
      if (stored !== null && stored !== undefined) patch[cellKey(id, col.id)] = stored
    })
  })
  // Options may have grown while reading cells; write the columns last.
  for (const c of built) patch[colKey(c.id)] = { ...c.field, ...(c.opts.length ? { opts: c.opts } : {}) }
  return patch as TablePatch & { content: { title: string } }
}

// ---- review summary -----------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const asRecord = (t: AgentTable) => ({ columns: new Map(t.columns.map((c) => [c.id ?? '', c])), rows: new Map(t.rows.map((r) => [r.id ?? '', r])) })

const cellKeyOf = (v: AgentValue | undefined) => {
  const o = isObject(v) ? v : { value: v ?? null }
  return JSON.stringify([o.value ?? null, o.bold === true, o.align ?? null, o.color ?? null])
}

/**
 * A line for the review dialog: "3 cells changed · 1 row added · 1 column removed".
 * Rows and columns are matched by id (`toAgentTable` gives every one an id).
 * Cells of added rows and columns are not counted on top. With no `before`, the
 * size of the new table. Empty if nothing differs.
 */
export function tableChangeSummary(before: AgentTable | null | undefined, after: AgentTable): string {
  if (!before) return [plural(after.rows.length, 'row'), plural(after.columns.length, 'column')].join(' · ')
  const b = asRecord(before), a = asRecord(after)
  const parts: string[] = []
  const add = (n: number, one: string, many?: string) => { if (n) parts.push(plural(n, one, many)) }
  if (before.title !== after.title) parts.push('title changed')

  // Cells in rows and columns that are in both.
  const commonCols = after.columns.map((c, j) => [c, j] as const).filter(([c]) => c.id && b.columns.has(c.id))
  let cells = 0, recoloured = 0
  const beforeIndex = new Map(before.columns.map((c, j) => [c.id, j]))
  for (const row of after.rows) {
    const old = row.id ? b.rows.get(row.id) : undefined
    if (!old) continue
    if ((old.color ?? null) !== (row.color ?? null)) recoloured++
    for (const [c, j] of commonCols) if (cellKeyOf(row.cells[j]) !== cellKeyOf(old.cells[beforeIndex.get(c.id)!])) cells++
  }
  add(cells, 'cell changed', 'cells changed')
  add(after.rows.filter((r) => !r.id || !b.rows.has(r.id)).length, 'row added', 'rows added')
  add(before.rows.filter((r) => !r.id || !a.rows.has(r.id)).length, 'row removed', 'rows removed')
  add(recoloured, 'row recoloured', 'rows recoloured')
  // Moved: rows that are in both but outside the longest run that kept its relative order.
  const common = after.rows.filter((r) => r.id && b.rows.has(r.id))
  const oldPos = new Map(before.rows.map((r, i) => [r.id, i]))
  const moved = common.length - longestIncreasing(common.map((r) => oldPos.get(r.id))).size
  add(moved, 'row moved', 'rows moved')
  add(after.columns.filter((c) => !c.id || !b.columns.has(c.id)).length, 'column added', 'columns added')
  add(before.columns.filter((c) => !c.id || !a.columns.has(c.id)).length, 'column removed', 'columns removed')
  const colSig = (c: AgentColumn) => JSON.stringify([c.name, c.type ?? 'text', c.width ?? null, c.align ?? null, (c.options ?? []).map((o) => [o.name, o.color ?? null])])
  const commonOrder = commonCols.map(([c]) => c)
  const colMoved = commonOrder.length - longestIncreasing(commonOrder.map((c) => beforeIndex.get(c.id))).size
  const colChanged = commonOrder.filter((c) => colSig(c) !== colSig(b.columns.get(c.id!)!)).length
  add(colChanged + colMoved, 'column changed', 'columns changed')
  return parts.join(' · ')
}
