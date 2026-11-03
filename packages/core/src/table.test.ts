import { describe, expect, it } from 'vitest'
import {
  TABLE_CAPS, TABLE_FIELD, addColumn, addRows, cellKey, cellOf, cellDisplay, cellValue, clearCells, colKey, compareCells, deleteColumns, deleteRows, guessHeader,
  looksTabular, moveColumn, moveRow, optionId, parseInput, parseNumber, parseTableKey, parseTsv, resizeBoundary, retype, rowKey, setCells, setRowFill, setStyle,
  sortRows, starterTable, tableColumns, tableFromGrid, tableId, tableLimitError, tableRows, tableText, toTsv, updateColumn, validTableField, withoutTableTombstones,
  readCell, isBlankTable, type TablePatch,
} from './index.ts'

const apply = (card: Record<string, unknown>, patch: TablePatch) => ({ ...card, ...patch })

/** A table with columns A, B, C and rows r1..r3 with the given cell texts. */
function fixture(types: ('text' | 'number' | 'checkbox' | 'date' | 'select' | 'rating')[] = ['text', 'text', 'text'], grid: (string | number | boolean | null)[][] = []) {
  const card: Record<string, unknown> = { id: 'c', kind: 'card', type: 'table', content: { title: 'T' } }
  const cols = ['100001', '100002', '100003']
  cols.forEach((id, i) => { card[colKey(id)] = { n: 'ABC'[i], o: i + 1, w: 1, t: types[i] } })
  const rows = ['200001', '200002', '200003']
  rows.forEach((id, i) => {
    card[rowKey(id)] = { o: i + 1 }
    grid[i]?.forEach((v, j) => { if (v !== null) card[cellKey(id, cols[j]!)] = v })
  })
  return { card, cols, rows }
}

describe('ids and keys', () => {
  it('makes 6-character ids that start with a digit, and avoids taken ones', () => {
    for (let i = 0; i < 200; i++) expect(tableId()).toMatch(/^[0-9][0-9a-z]{5}$/)
    for (let i = 0; i < 200; i++) expect(optionId()).toMatch(/^[0-9][0-9a-z]{3}$/)
    const taken = new Set<string>()
    for (let i = 0; i < 500; i++) { const id = tableId(taken); expect(taken.has(id)).toBe(false); taken.add(id) }
  })
  it('all keys match TABLE_FIELD and the server field-name rule', () => {
    const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/
    for (const key of [rowKey('200001'), colKey('100001'), cellKey('200001', '100001')]) {
      expect(TABLE_FIELD.test(key)).toBe(true)
      expect(KEY.test(key)).toBe(true)
    }
    for (const key of ['title', 'content', 'tr1', 'tk12345', 'tcabcdef', 'label0123456789ab', 'tr_00001', 'trabcdef']) expect(TABLE_FIELD.test(key)).toBe(false)
  })
  it('parses a key back into what it addresses', () => {
    expect(parseTableKey(rowKey('200001'))).toEqual({ kind: 'row', row: '200001' })
    expect(parseTableKey(colKey('100001'))).toEqual({ kind: 'col', col: '100001' })
    expect(parseTableKey(cellKey('200001', '100001'))).toEqual({ kind: 'cell', row: '200001', col: '100001' })
    expect(parseTableKey('x')).toBeNull()
  })
})

describe('readers survive wrong types', () => {
  it('skips tombstones and junk, and fills in safe defaults', () => {
    const card = {
      tk100001: { n: 5, o: 'x', w: -2, t: 'bogus', a: 'q', opts: 'no' },
      tk100002: null, tk100003: 'string', tk100004: [], tk100005: { n: 'ok', o: 2, w: 3, t: 'number', a: 'r' },
      tr200001: { o: NaN, bg: 'url(x)' }, tr200002: null, tr200003: 7, tr200004: { o: 1, bg: 'sky' },
    }
    expect(tableColumns(card)).toEqual([
      { id: '100001', n: '', o: 0, w: 1, t: 'text', opts: [] },
      { id: '100005', n: 'ok', o: 2, w: 3, t: 'number', a: 'r', opts: [] },
    ])
    expect(tableRows(card)).toEqual([{ id: '200001', o: 0 }, { id: '200004', o: 1, bg: 'sky' }])
  })
  it('reads cells of any shape', () => {
    expect(readCell('hi')).toEqual({ v: 'hi', b: false })
    expect(readCell(0)).toEqual({ v: 0, b: false })
    expect(readCell(false)).toEqual({ v: false, b: false })
    expect(readCell({ v: 'x', b: 1, a: 'c', bg: 'gold' })).toEqual({ v: 'x', b: true, a: 'c', bg: 'gold' })
    for (const junk of [null, undefined, '', NaN, Infinity, [], {}, { v: {} }, { v: 'x', bg: 'url(x)', a: 'z', b: 2 }, () => 1]) {
      const cell = readCell(junk)
      expect(cell.b).toBe(false)
      expect(cell.bg).toBeUndefined()
      expect(cell.a).toBeUndefined()
    }
    expect(readCell({ v: 'x', bg: 'url(x)', a: 'z', b: 2 })).toEqual({ v: 'x', b: false })
  })
  it('breaks order ties by id', () => {
    const card = { tr200002: { o: 1 }, tr200001: { o: 1 }, tr200000: { o: 0 } }
    expect(tableRows(card).map((r) => r.id)).toEqual(['200000', '200001', '200002'])
  })
  it('reads values by column type', () => {
    const opts = [{ id: '1abc', n: 'Doing', c: 'sky' as const }]
    const v = (t: Parameters<typeof cellValue>[0]['t'], value: unknown) => cellValue({ t, opts }, readCell(value))
    expect(v('text', 12)).toBe('12')
    expect(v('number', 12)).toBe(12)
    expect(v('number', '1,200.5')).toBe(1200.5)
    expect(v('number', 'abc')).toBe('abc')
    expect(v('checkbox', true)).toBe(true)
    expect(v('checkbox', 'true')).toBeNull()
    expect(v('date', '2026-02-30')).toBeNull()
    expect(v('date', '2026-02-28')).toBe('2026-02-28')
    expect(v('select', '1abc')).toBe('1abc')
    expect(v('select', 'zzzz')).toBeNull()
    expect(v('rating', 4)).toBe(4)
    expect(v('rating', 6)).toBeNull()
    expect(v('rating', 2.5)).toBeNull()
    expect(cellDisplay({ t: 'select', opts }, readCell('1abc'))).toBe('Doing')
    expect(cellDisplay({ t: 'checkbox' }, readCell(false))).toBe('FALSE')
    expect(cellDisplay({ t: 'text' }, readCell(null))).toBe('')
  })
  it('drops duplicate, malformed and excess options', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `1${i.toString(36).padStart(3, '0')}`, n: 'x', c: 'gold' }))
    const card = { tk100001: { n: 'S', o: 1, w: 1, t: 'select', opts: [{ id: '1abc', n: 'a', c: 'sky' }, { id: '1abc', n: 'dup', c: 'sky' }, { id: 'bad', n: 'b', c: 'sky' }, { id: '2abc', n: 3, c: 'zzz' }, ...many] } }
    const opts = tableColumns(card)[0]!.opts
    expect(opts.slice(0, 2)).toEqual([{ id: '1abc', n: 'a', c: 'sky' }, { id: '2abc', n: '', c: 'none' }])
    expect(opts.length).toBe(TABLE_CAPS.options)
  })
  it('tableText lists the title, header and rows', () => {
    const { card } = fixture(undefined, [['a', 'b\tc', 3]])
    expect(tableText(card)).toBe('T\nA\tB\tC\r\na\t"b\tc"\t3\r\n\t\t\r\n\t\t')
  })
})

describe('rows and columns', () => {
  it('adds rows in the middle and at the end, in order, up to the cap', () => {
    const { card, rows } = fixture()
    const mid = addRows(card, 2, 1)
    expect(mid.ids).toHaveLength(2)
    expect(tableRows(apply(card, mid.patch)).map((r) => r.id)).toEqual([rows[0], ...mid.ids, rows[1], rows[2]])
    const end = addRows(card, 1)
    expect(tableRows(apply(card, end.patch)).at(-1)!.id).toBe(end.ids[0])
    const start = addRows(card, 1, 0)
    expect(tableRows(apply(card, start.patch))[0]!.id).toBe(start.ids[0])
    const big = apply(card, addRows(card, TABLE_CAPS.rows).patch)
    expect(tableRows(big)).toHaveLength(TABLE_CAPS.rows)
    expect(addRows(big, 1).ids).toEqual([])
  })
  it('deleting rows tombstones the row and all its cells', () => {
    const { card, rows } = fixture(undefined, [['a', 'b', 'c'], ['d', 'e', 'f']])
    const patch = deleteRows(card, [rows[0]!])
    expect(Object.keys(patch).sort()).toEqual([rowKey(rows[0]!), ...['100001', '100002', '100003'].map((c) => cellKey(rows[0]!, c))].sort())
    expect(Object.values(patch).every((v) => v === null)).toBe(true)
    const after = withoutTableTombstones(apply(card, patch))
    expect(tableRows(after).map((r) => r.id)).toEqual([rows[1], rows[2]])
    expect(Object.keys(after).filter((k) => k.startsWith('tc'))).toHaveLength(3)
  })
  it('adds a column between others, with the average width, and stops at the cap', () => {
    const { card, cols } = fixture()
    const patch = addColumn({ ...card, [colKey(cols[0]!)]: { n: 'A', o: 1, w: 2, t: 'text' } }, { name: 'New', type: 'number' }, 1)
    const added = Object.entries(patch.patch)[0]![1] as { n: string; w: number; t: string }
    expect(added).toMatchObject({ n: 'New', t: 'number', w: 1.333 })
    const after = apply(card, addColumn(card, { name: 'X' }, 1).patch)
    expect(tableColumns(after).map((c) => c.n)).toEqual(['A', 'X', 'B', 'C'])
    let big: Record<string, unknown> = card
    for (let i = 0; i < 30; i++) big = apply(big, addColumn(big, {}).patch)
    expect(tableColumns(big)).toHaveLength(TABLE_CAPS.cols)
    expect(addColumn(big, {}).ids).toEqual([])
  })
  it('deleting columns tombstones the column and its cells', () => {
    const { card, cols, rows } = fixture(undefined, [['a', 'b', 'c']])
    const patch = deleteColumns(card, [cols[1]!])
    expect(Object.keys(patch).sort()).toEqual([colKey(cols[1]!), ...rows.map((r) => cellKey(r, cols[1]!)).filter((k) => k in card)].sort())
  })
  it('moves a row and a column to an index of the new order, keeping their other fields', () => {
    const { card, rows, cols } = fixture()
    const withFill = { ...card, [rowKey(rows[0]!)]: { o: 1, bg: 'gold' } }
    const moved = apply(withFill, moveRow(withFill, rows[0]!, 2))
    expect(tableRows(moved).map((r) => r.id)).toEqual([rows[1], rows[2], rows[0]])
    expect(tableRows(moved).at(-1)!.bg).toBe('gold')
    expect(tableRows(apply(card, moveRow(card, rows[2]!, 0))).map((r) => r.id)).toEqual([rows[2], rows[0], rows[1]])
    expect(tableRows(apply(card, moveRow(card, rows[1]!, 1))).map((r) => r.id)).toEqual(rows)
    expect(tableColumns(apply(card, moveColumn(card, cols[0]!, 1))).map((c) => c.id)).toEqual([cols[1], cols[0], cols[2]])
    expect(moveColumn(card, 'nope00', 0)).toEqual({})
  })
  it('renames a column and sets a row fill without touching the rest', () => {
    const { card, cols, rows } = fixture(['select', 'text', 'text'])
    const named = apply(card, updateColumn(card, cols[1]!, { n: 'Renamed', a: 'c' }))
    expect(tableColumns(named)[1]).toMatchObject({ n: 'Renamed', a: 'c', w: 1, t: 'text' })
    expect(tableRows(apply(card, setRowFill(card, [rows[1]!], 'sky')))[1]!.bg).toBe('sky')
    expect(tableRows(apply(apply(card, setRowFill(card, [rows[1]!], 'sky')), setRowFill(card, [rows[1]!], null)))[1]!.bg).toBeUndefined()
  })
  it('resizing a boundary moves weight between neighbours and keeps the sum', () => {
    const { card, cols } = fixture()
    const after = apply(card, resizeBoundary(card, cols[0]!, 0.5))
    expect(tableColumns(after).map((c) => c.w)).toEqual([1.5, 0.5, 1])
    const clamped = apply(card, resizeBoundary(card, cols[0]!, 5))
    expect(tableColumns(clamped).map((c) => c.w)).toEqual([1.75, 0.25, 1])
    expect(tableColumns(apply(card, resizeBoundary(card, cols[0]!, -5))).map((c) => c.w)).toEqual([0.25, 1.75, 1])
    expect(resizeBoundary(card, cols[2]!, 1)).toEqual({})
    expect(resizeBoundary(card, cols[0]!, NaN)).toEqual({})
  })
})

describe('cells', () => {
  it('sets, styles and clears cells; a style keeps the value and a value keeps the style', () => {
    const { card, rows, cols } = fixture()
    const ref = { row: rows[0]!, col: cols[0]! }
    let c = apply(card, setCells(card, [{ ...ref, value: 'hi' }]))
    expect(c[cellKey(ref.row, ref.col)]).toBe('hi')
    c = apply(c, setStyle(c, [ref], { b: true, bg: 'gold' }))
    expect(cellOf(c, ref.row, ref.col)).toEqual({ v: 'hi', b: true, bg: 'gold' })
    c = apply(c, setCells(c, [{ ...ref, value: 'yo' }]))
    expect(cellOf(c, ref.row, ref.col)).toEqual({ v: 'yo', b: true, bg: 'gold' })
    c = apply(c, clearCells(c, [ref]))
    expect(cellOf(c, ref.row, ref.col)).toEqual({ v: null, b: true, bg: 'gold' })
    c = apply(c, setStyle(c, [ref], { b: false, bg: null }))
    expect(c[cellKey(ref.row, ref.col)]).toBeNull()
    expect(cellOf(c, ref.row, ref.col)).toEqual({ v: null, b: false })
  })
  it('stores unstyled values bare, and drops a cleared plain cell to a tombstone', () => {
    const { card, rows, cols } = fixture(undefined, [['x']])
    const patch = clearCells(card, [{ row: rows[0]!, col: cols[0]! }])
    expect(patch).toEqual({ [cellKey(rows[0]!, cols[0]!)]: null })
    expect(setCells(card, [{ row: rows[1]!, col: cols[0]!, value: '' }])).toEqual({ [cellKey(rows[1]!, cols[0]!)]: null })
    expect(setCells(card, [{ row: rows[1]!, col: cols[0]!, value: false }])[cellKey(rows[1]!, cols[0]!)]).toBe(false)
    expect(setCells(card, [{ row: rows[1]!, col: cols[0]!, value: NaN }])[cellKey(rows[1]!, cols[0]!)]).toBeNull()
  })
  it('clips cell text at the cap', () => {
    const { card, rows, cols } = fixture()
    const patch = setCells(card, [{ row: rows[0]!, col: cols[0]!, value: 'x'.repeat(5000) }])
    expect((patch[cellKey(rows[0]!, cols[0]!)] as string).length).toBe(TABLE_CAPS.cell)
  })
  it('two edits to the same cell in one patch compose', () => {
    const { card, rows, cols } = fixture()
    const ref = { row: rows[0]!, col: cols[0]! }
    const patch = setCells(card, [{ ...ref, value: 'a' }, { ...ref, value: 'b' }])
    expect(patch[cellKey(ref.row, ref.col)]).toBe('b')
  })
})

describe('typing text', () => {
  it('parses numbers', () => {
    expect(parseNumber('1,200.5')).toBe(1200.5)
    expect(parseNumber(' -3 ')).toBe(-3)
    expect(parseNumber('.5')).toBe(0.5)
    expect(parseNumber('1e3')).toBe(1000)
    for (const bad of ['', 'abc', '1.2.3', '--1', '1e', 'NaN', 'Infinity', '0x10']) expect(parseNumber(bad)).toBeNull()
  })
  it('reads typed text by column type, keeping what does not fit', () => {
    const opts = [{ id: '1abc', n: 'Doing', c: 'sky' as const }]
    expect(parseInput({ t: 'number' }, '42')).toBe(42)
    expect(parseInput({ t: 'number' }, 'lots')).toBe('lots')
    expect(parseInput({ t: 'checkbox' }, 'Yes')).toBe(true)
    expect(parseInput({ t: 'checkbox' }, 'no')).toBe(false)
    expect(parseInput({ t: 'date' }, '2026/3/4')).toBe('2026-03-04')
    expect(parseInput({ t: 'date' }, 'tomorrow')).toBe('tomorrow')
    expect(parseInput({ t: 'select', opts }, 'doing')).toBe('1abc')
    expect(parseInput({ t: 'rating' }, '5')).toBe(5)
    expect(parseInput({ t: 'rating' }, '9')).toBe('9')
    expect(parseInput({ t: 'text' }, '  ')).toBeNull()
  })
})

describe('retype', () => {
  it('text -> number converts what parses and leaves the rest, so changing back loses nothing', () => {
    const { card, rows, cols } = fixture(undefined, [['12'], ['abc'], ['1,5']])
    const to = apply(card, retype(card, cols[0]!, 'number'))
    expect(tableColumns(to)[0]!.t).toBe('number')
    expect(cellOf(to, rows[0]!, cols[0]!).v).toBe(12)
    expect(cellOf(to, rows[1]!, cols[0]!).v).toBe('abc')
    expect(cellOf(to, rows[2]!, cols[0]!).v).toBe(15)
    expect(cellDisplay(tableColumns(to)[0]!, cellOf(to, rows[0]!, cols[0]!))).toBe('12')
    const back = apply(to, retype(to, cols[0]!, 'text'))
    expect(cellOf(back, rows[0]!, cols[0]!).v).toBe('12')
    expect(cellOf(back, rows[1]!, cols[0]!).v).toBe('abc')
  })
  it('text -> select builds options from the distinct values (case-insensitive) and maps cells to them', () => {
    const { card, rows, cols } = fixture(undefined, [['Todo'], ['Done'], ['todo'], [null], ['Done']])
    const more = { ...card, [rowKey('200004')]: { o: 4 }, [rowKey('200005')]: { o: 5 }, [cellKey('200004', cols[0]!)]: 'Done', [cellKey('200005', cols[0]!)]: 'Done' }
    const to = apply(more, retype(more, cols[0]!, 'select'))
    const col = tableColumns(to)[0]!
    expect(col.opts.map((o) => o.n)).toEqual(['Todo', 'Done'])
    expect(new Set(col.opts.map((o) => o.id)).size).toBe(2)
    expect(col.opts.every((o) => o.c !== 'none')).toBe(true)
    expect(cellDisplay(col, cellOf(to, rows[0]!, cols[0]!))).toBe('Todo')
    expect(cellDisplay(col, cellOf(to, rows[2]!, cols[0]!))).toBe('Todo')
    expect(cellDisplay(col, cellOf(to, rows[1]!, cols[0]!))).toBe('Done')
    expect(validTableField(colKey(cols[0]!), (to as Record<string, unknown>)[colKey(cols[0]!)])).toBe(true)
    // And back to text: option names return.
    const back = apply(to, retype(to, cols[0]!, 'text'))
    expect(cellOf(back, rows[0]!, cols[0]!).v).toBe('Todo')
    expect(cellOf(back, rows[1]!, cols[0]!).v).toBe('Done')
  })
  it('keeps cell styles when converting, and converts checkbox, date and rating', () => {
    const { card, rows, cols } = fixture(undefined, [['yes'], ['2026/1/2'], ['4']])
    const styled = apply(card, setStyle(card, [{ row: rows[0]!, col: cols[0]! }], { b: true }))
    expect(cellOf(apply(styled, retype(styled, cols[0]!, 'checkbox')), rows[0]!, cols[0]!)).toEqual({ v: true, b: true })
    expect(cellOf(apply(card, retype(card, cols[0]!, 'date')), rows[1]!, cols[0]!).v).toBe('2026-01-02')
    expect(cellOf(apply(card, retype(card, cols[0]!, 'rating')), rows[2]!, cols[0]!).v).toBe(4)
    expect(cellOf(apply(card, retype(card, cols[0]!, 'rating')), rows[0]!, cols[0]!).v).toBe('yes')
    expect(retype(card, cols[0]!, 'text')).toEqual({})
    expect(retype(card, 'nope00', 'number')).toEqual({})
  })
})

describe('sorting', () => {
  const sorted = (type: Parameters<typeof compareCells>[0], values: unknown[], dir: 'asc' | 'desc' = 'asc') =>
    values.map(readCell).sort(compareCells(type, dir)).map((c) => c.v)
  it('puts empty cells last either way, and numbers numerically', () => {
    expect(sorted('number', [10, null, 2, 33, null, 1])).toEqual([1, 2, 10, 33, null, null])
    expect(sorted('number', [10, null, 2, 33], 'desc')).toEqual([33, 10, 2, null])
    expect(sorted('text', ['b', '', 'A', 'a10', 'a2'])).toEqual(['A', 'a2', 'a10', 'b', null])
    expect(sorted('checkbox', [true, false, null, false])).toEqual([false, false, true, null])
    expect(sorted('date', ['2026-03-01', null, '2025-12-31'])).toEqual(['2025-12-31', '2026-03-01', null])
    expect(sorted('number', ['abc', 5, 1])).toEqual([1, 5, 'abc'])
  })
  it('sorts rows stably, writing orders only for rows that moved', () => {
    const { card, rows, cols } = fixture(['text', 'text', 'text'], [['a'], ['c'], ['b']])
    const patch = sortRows(card, cols[0]!)
    expect(Object.keys(patch).sort()).toEqual([rowKey(rows[1]!), rowKey(rows[2]!)].sort())
    expect(tableRows(apply(card, patch)).map((r) => r.id)).toEqual([rows[0], rows[2], rows[1]])
    expect(tableRows(apply(card, sortRows(card, cols[0]!, 'desc'))).map((r) => r.id)).toEqual([rows[1], rows[2], rows[0]])
    expect(sortRows(apply(card, patch), cols[0]!)).toEqual({})
    // Equal cells keep their order.
    const ties = fixture(['text', 'text', 'text'], [['a'], ['a'], ['a']])
    expect(sortRows(ties.card, ties.cols[0]!)).toEqual({})
    expect(sortRows(ties.card, ties.cols[0]!, 'desc')).toEqual({})
  })
  it('sorts a select by option name and keeps row fills', () => {
    const base = fixture(['select', 'text', 'text'])
    const card: Record<string, unknown> = {
      ...base.card,
      [colKey(base.cols[0]!)]: { n: 'S', o: 1, w: 1, t: 'select', opts: [{ id: '1aaa', n: 'Zed', c: 'sky' }, { id: '1bbb', n: 'Amy', c: 'gold' }] },
      [cellKey(base.rows[0]!, base.cols[0]!)]: '1aaa', [cellKey(base.rows[1]!, base.cols[0]!)]: '1bbb',
      [rowKey(base.rows[0]!)]: { o: 1, bg: 'peach' },
    }
    const after = apply(card, sortRows(card, base.cols[0]!))
    expect(tableRows(after).map((r) => r.id)).toEqual([base.rows[1], base.rows[0], base.rows[2]])
    expect(tableRows(after).find((r) => r.id === base.rows[0])!.bg).toBe('peach')
  })
})

describe('TSV', () => {
  it('parses Excel output: CRLF, quotes, embedded tabs and newlines, trailing newline, ragged rows', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseTsv('a\tb\nc')).toEqual([['a', 'b'], ['c']])
    expect(parseTsv('"a\tb"\t"line1\nline2"\t"say ""hi"""')).toEqual([['a\tb', 'line1\nline2', 'say "hi"']])
    expect(parseTsv('a\t\t\n')).toEqual([['a', '', '']])
    expect(parseTsv('a\r\n\r\nb')).toEqual([['a'], [''], ['b']])
    expect(parseTsv('a\rb')).toEqual([['a'], ['b']])
    expect(parseTsv('')).toEqual([])
    expect(parseTsv('""')).toEqual([['']])
    expect(parseTsv('5"x\t6')).toEqual([['5"x', '6']])
  })
  it('round-trips', () => {
    const grids = [
      [['a', 'b'], ['c', 'd']],
      [['say "hi"', 'tab\there', 'line\nbreak', 'cr\rhere'], ['', '', '']],
      [[''], ['x']],
      [['x', ''], ['', 'y'], ['z']],
      [['"'], ['""'], [' lead', 'trail ']],
    ]
    for (const grid of grids) expect(parseTsv(toTsv(grid))).toEqual(grid)
    expect(toTsv([['a', 'b'], ['c']])).toBe('a\tb\r\nc')
    expect(toTsv([['a b', 'q"']])).toBe('a b\t"q"""')
  })
  it('recognises a pasted grid and a header row', () => {
    expect(looksTabular('Name\tAge\nRex\t3\nFido\t5')).toBe(true)
    expect(looksTabular('just some text\nwith lines')).toBe(false)
    expect(looksTabular('one\ttwo')).toBe(false)
    expect(looksTabular('a\tb\nc')).toBe(false)
    expect(looksTabular(Array.from({ length: 102 }, () => 'a\tb').join('\n'))).toBe(false)
    expect(guessHeader([['Name', 'Age'], ['Rex', '3']])).toBe(true)
    expect(guessHeader([['Rex', '3'], ['Fido', '5']])).toBe(false)
    expect(guessHeader([['A', ''], ['b', 'c']])).toBe(false)
    expect(guessHeader([['Same', 'same'], ['b', 'c']])).toBe(false)
    expect(guessHeader([['Name', 'Age']])).toBe(false)
    expect(guessHeader([['2026-01-01', 'x'], ['a', 'b']])).toBe(false)
  })
  it('builds a table from a grid, with or without a header, capped', () => {
    const t = tableFromGrid([['Name', 'Age'], ['Rex', '3'], ['Fido']], { header: true, fallbackName: (i) => `Col ${i + 1}` })
    const cols = tableColumns(t), rows = tableRows(t)
    expect(cols.map((c) => c.n)).toEqual(['Name', 'Age'])
    expect(rows).toHaveLength(2)
    expect(cellOf(t, rows[0]!.id, cols[1]!.id).v).toBe('3')
    expect(cellOf(t, rows[1]!.id, cols[1]!.id).v).toBeNull()
    const none = tableFromGrid([['Rex', '3']], { header: false, fallbackName: (i) => `Col ${i + 1}` })
    expect(tableColumns(none).map((c) => c.n)).toEqual(['Col 1', 'Col 2'])
    expect(tableRows(none)).toHaveLength(1)
    for (const key of Object.keys(t)) expect(validTableField(key, t[key])).toBe(true)
  })
})

describe('validation and copying', () => {
  const r = '200001', c = '100001'
  it('accepts well-formed fields and tombstones', () => {
    for (const [key, value] of [
      [cellKey(r, c), 'hi'], [cellKey(r, c), 0], [cellKey(r, c), true], [cellKey(r, c), { v: 'x', b: 1, a: 'r', bg: 'sky' }], [cellKey(r, c), { b: 1 }], [cellKey(r, c), null],
      [rowKey(r), { o: 1.5, bg: 'gold' }], [rowKey(r), null],
      [colKey(c), { n: 'Name', o: 1, w: 2, t: 'select', a: 'c', opts: [{ id: '1abc', n: 'a', c: 'sky' }] }], [colKey(c), null],
    ] as const) expect(validTableField(key, value), `${key} ${JSON.stringify(value)}`).toBe(true)
    expect(validTableField(cellKey(r, c), undefined)).toBe(true)
  })
  it('refuses everything else', () => {
    for (const [key, value] of [
      ['title', 'x'], ['tr1', { o: 1 }], [cellKey(r, c), {}.constructor], [cellKey(r, c), 'x'.repeat(2001)], [cellKey(r, c), NaN], [cellKey(r, c), [1]],
      [cellKey(r, c), { v: {} }], [cellKey(r, c), { b: 2 }], [cellKey(r, c), { a: 'x' }], [cellKey(r, c), { bg: 'url(x)' }], [cellKey(r, c), { extra: 1 }],
      [rowKey(r), 'x'], [rowKey(r), { o: 'a' }], [rowKey(r), { o: Infinity }], [rowKey(r), { o: 1, bg: 'x' }], [rowKey(r), { o: 1, junk: 1 }], [rowKey(r), []],
      [colKey(c), { n: 'x', o: 1, w: 0, t: 'text' }], [colKey(c), { n: 'x', o: 1, w: 1, t: 'nope' }], [colKey(c), { n: 'x'.repeat(101), o: 1, w: 1, t: 'text' }],
      [colKey(c), { n: 'x', o: 1, w: 1, t: 'text', a: 'q' }], [colKey(c), { n: 'x', o: 1, w: 1, t: 'select', opts: 'a' }],
      [colKey(c), { n: 'x', o: 1, w: 1, t: 'select', opts: [{ id: 'bad', n: 'a', c: 'sky' }] }],
      [colKey(c), { n: 'x', o: 1, w: 1, t: 'select', opts: [{ id: '1abc', n: 'a', c: 'sky' }, { id: '1abc', n: 'b', c: 'sky' }] }],
      [colKey(c), { n: 'x', o: 1, w: 1, t: 'select', opts: Array.from({ length: 51 }, (_, i) => ({ id: `1${i.toString(36).padStart(3, '0')}`, n: 'a', c: 'sky' })) }],
    ] as const) expect(validTableField(key, value), `${key} ${JSON.stringify(value)}`).toBe(false)
  })
  it('strips tombstones from a copy but only for table fields', () => {
    const copy = withoutTableTombstones({ id: 'a', gone: null, [rowKey(r)]: null, [cellKey(r, c)]: 'x', [colKey(c)]: undefined })
    expect(copy).toEqual({ id: 'a', gone: null, [cellKey(r, c)]: 'x' })
  })
  it('builds a 3x3 starter table', () => {
    const t = starterTable(['One', 'Two', 'Three'])
    expect(tableColumns(t).map((x) => x.n)).toEqual(['One', 'Two', 'Three'])
    expect(tableRows(t)).toHaveLength(3)
    expect(Object.keys(t)).toHaveLength(6)
    for (const key of Object.keys(t)) { expect(TABLE_FIELD.test(key)).toBe(true); expect(validTableField(key, t[key])).toBe(true) }
  })
  it('measures server limits', () => {
    expect(tableLimitError(starterTable(['a']))).toBeNull()
    let t: Record<string, unknown> = {}
    for (let i = 0; i < 151; i++) t = apply(t, { [rowKey(tableId())]: { o: i } })
    expect(tableLimitError(t)).toBe('too many rows')
    let w: Record<string, unknown> = {}
    for (let i = 0; i < 41; i++) w = apply(w, { [colKey(tableId())]: { n: 'a', o: i, w: 1, t: 'text' } })
    expect(tableLimitError(w)).toBe('too many columns')
    // Removed rows don't count.
    expect(tableLimitError(apply(t, Object.fromEntries(Object.keys(t).slice(0, 5).map((k) => [k, null]))))).toBeNull()
    expect(tableLimitError({ big: 'x'.repeat(1024 * 1024) })).toBe('table too large')
  })
})

describe('isBlankTable', () => {
  const names = ['Name', 'Treats', 'Notes']
  it('is true for a fresh starter table and false once anything is written', () => {
    const card = { content: { title: '' }, ...starterTable(names) }
    expect(isBlankTable(card, names)).toBe(true)
    const [row] = tableRows(card)
    const [col] = tableColumns(card)
    expect(isBlankTable({ ...card, content: { title: 'Dogs' } }, names)).toBe(false)
    expect(isBlankTable({ ...card, ...setCells(card, [{ row: row!.id, col: col!.id, value: 'Rex' }]) }, names)).toBe(false)
    expect(isBlankTable({ ...card, ...updateColumn(card, col!.id, { n: 'Pup' }) }, names)).toBe(false)
  })
  it('ignores empty and removed cells', () => {
    const card = { content: { title: '' }, ...starterTable(names) }
    const [row] = tableRows(card)
    const [col] = tableColumns(card)
    expect(isBlankTable({ ...card, [cellKey(row!.id, col!.id)]: null }, names)).toBe(true)
  })
})
