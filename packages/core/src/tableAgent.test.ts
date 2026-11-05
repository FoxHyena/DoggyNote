import { describe, expect, it } from 'vitest'
import { TABLE_CAPS, cellKey, colKey, rowKey, tableColumns, tableRows, validTableField, fromAgentTable, toAgentTable, tableChangeSummary, type AgentTable } from './index.ts'

const must = (agent: unknown, prev?: object) => {
  const r = fromAgentTable(agent, prev)
  if (!r.ok) throw new Error(r.error)
  return r.fields
}
const card = (fields: Record<string, unknown>) => ({ id: 't', kind: 'card', type: 'table', ...fields })
const error = (agent: unknown, prev?: object) => { const r = fromAgentTable(agent, prev); return r.ok ? null : r.error }

const sample: AgentTable = {
  title: 'Vet visits',
  columns: [
    { name: 'Dog', type: 'text', width: 2 },
    { name: 'Weight', type: 'number', align: 'right' },
    { name: 'Vaccinated', type: 'checkbox' },
    { name: 'Next visit', type: 'date' },
    { name: 'Status', type: 'select', options: [{ name: 'Healthy', color: 'sky' }, { name: 'Watch', color: 'peach' }] },
    { name: 'Mood', type: 'rating' },
  ],
  rows: [
    { cells: [{ value: 'Rex', bold: true }, 31.5, true, '2026-12-01', 'Healthy', 5] },
    { color: 'gold', cells: ['Fido', 8, false, null, { value: 'Watch', color: 'lilac', align: 'center' }, 3] },
    { cells: ['Biscuit', null, null, null, 'Sleepy', null] },
  ],
}

describe('agent table round trip', () => {
  it('turns the friendly shape into fields and back, unchanged but for ids', () => {
    const fields = must(sample)
    expect(fields.content).toEqual({ title: 'Vet visits' })
    const back = toAgentTable(card(fields))
    const strip = (t: AgentTable) => JSON.parse(JSON.stringify(t, (k, v) => (k === 'id' ? undefined : v)))
    // "Sleepy" was not an option: it is created, with a colour.
    const status = back.columns[4]!.options!
    expect(status.map((o) => o.name)).toEqual(['Healthy', 'Watch', 'Sleepy'])
    expect(strip(back).rows).toEqual([
      { cells: [{ value: 'Rex', bold: true }, 31.5, true, '2026-12-01', 'Healthy', 5] },
      { color: 'gold', cells: ['Fido', 8, false, null, { value: 'Watch', align: 'center', color: 'lilac' }, 3] },
      { cells: ['Biscuit', null, null, null, 'Sleepy', null] },
    ])
    expect(back.columns.map((c) => [c.name, c.type, c.align ?? null])).toEqual(sample.columns.map((c) => [c.name, c.type, c.align ?? null]))
    expect(back.columns[0]!.width).toBe(2)
  })

  it('reading it again and sending it back changes nothing', () => {
    const first = card(must(sample))
    const agent = toAgentTable(first)
    const second = card(must(agent, first))
    expect(second).toEqual(first)
    expect(toAgentTable(second)).toEqual(agent)
  })

  it('writes only keys the sync accepts', () => {
    const fields = must(sample)
    for (const [k, v] of Object.entries(fields)) if (k !== 'content') expect(validTableField(k, v), k).toBe(true)
    expect(tableRows(fields)).toHaveLength(3)
    expect(tableColumns(fields)).toHaveLength(6)
  })

  it('leaves out empty cells and gives every id the right shape', () => {
    const fields = must(sample)
    expect(Object.keys(fields).filter((k) => k.startsWith('tc'))).toHaveLength(13)
    for (const r of tableRows(fields)) expect(r.id).toMatch(/^[0-9][0-9a-z]{5}$/)
  })

  it('shows a value the type cannot read as empty, and keeps it when sent back as empty', () => {
    const base = card(must({ title: 'T', columns: [{ name: 'When', type: 'date' }], rows: [{ cells: ['2026-01-02'] }] }))
    const [row] = tableRows(base), [col] = tableColumns(base)
    const odd = { ...base, [cellKey(row!.id, col!.id)]: 'tomorrow' }
    const agent = toAgentTable(odd)
    expect(agent.rows[0]!.cells[0]).toBeNull()
    expect(must(agent, odd)[cellKey(row!.id, col!.id)]).toBe('tomorrow')
    // Saying something else replaces it.
    agent.rows[0]!.cells[0] = '2026-02-03'
    expect(must(agent, odd)[cellKey(row!.id, col!.id)]).toBe('2026-02-03')
  })
})

describe('keeping order values', () => {
  const three = card(must({ title: '', columns: [{ name: 'A' }], rows: [{ cells: ['a'] }, { cells: ['b'] }, { cells: ['c'] }, { cells: ['d'] }, { cells: ['e'] }] }))
  const orderOf = (c: object) => Object.fromEntries(tableRows(c).map((r) => [r.id, r.o]))

  it('rewrites only the rows that moved', () => {
    const agent = toAgentTable(three)
    const [a, b, c, d, e] = agent.rows
    agent.rows = [a!, c!, d!, e!, b!] // b moves to the end
    const next = card(must(agent, three))
    const before = orderOf(three), after = orderOf(next)
    for (const r of [a!, c!, d!, e!]) expect(after[r.id!]).toBe(before[r.id!])
    expect(after[b!.id!]).toBeGreaterThan(before[e!.id!]!)
    expect(tableRows(next).map((r) => r.id)).toEqual([a!, c!, d!, e!, b!].map((r) => r.id))
  })

  it('moving the last row to the front moves only that row', () => {
    const agent = toAgentTable(three)
    const e = agent.rows.pop()!
    agent.rows.unshift(e)
    const next = card(must(agent, three))
    const before = orderOf(three), after = orderOf(next)
    for (const r of agent.rows.slice(1)) expect(after[r.id!]).toBe(before[r.id!])
    expect(after[e.id!]).toBeLessThan(before[agent.rows[1]!.id!]!)
  })

  it('puts new rows between their neighbours without touching them', () => {
    const agent = toAgentTable(three)
    const ids = agent.rows.map((r) => r.id)
    agent.rows.splice(2, 0, { cells: ['x'] }, { cells: ['y'] })
    const next = card(must(agent, three))
    const before = orderOf(three), after = orderOf(next)
    for (const id of ids) expect(after[id!]).toBe(before[id!])
    const rows = tableRows(next)
    expect(rows.map((r) => r.id).filter((id) => !ids.includes(id))).toHaveLength(2)
    expect(rows.slice(2, 4).every((r) => !ids.includes(r.id))).toBe(true)
    expect(new Set(rows.map((r) => r.o)).size).toBe(7)
  })

  it('does the same for columns, and keeps their widths', () => {
    const wide = card(must({ title: '', columns: [{ name: 'A', width: 3 }, { name: 'B' }, { name: 'C' }], rows: [] }))
    const agent = toAgentTable(wide)
    const [a, b, c] = agent.columns
    agent.columns = [c!, a!, b!]
    const next = card(must(agent, wide))
    const before = tableColumns(wide), after = tableColumns(next)
    expect(after.map((x) => x.n)).toEqual(['C', 'A', 'B'])
    expect(after.find((x) => x.n === 'A')!.o).toBe(before.find((x) => x.n === 'A')!.o)
    expect(after.find((x) => x.n === 'B')!.o).toBe(before.find((x) => x.n === 'B')!.o)
    expect(after.find((x) => x.n === 'A')!.w).toBe(3)
  })

  it('drops what the agent leaves out, with its cells', () => {
    const agent = toAgentTable(three)
    agent.rows.splice(1, 1)
    const next = card(must(agent, three))
    expect(tableRows(next)).toHaveLength(4)
    const gone = tableRows(three)[1]!.id
    expect(Object.keys(next).some((k) => k.includes(gone))).toBe(false)
  })

  it('ignores ids it does not know in the order of a table that did not have them', () => {
    const agent = toAgentTable(three)
    const next = card(must({ ...agent, rows: agent.rows.slice().reverse() }))
    expect(tableRows(next).map((r) => r.id)).toEqual(agent.rows.slice().reverse().map((r) => r.id))
  })
})

describe('select options', () => {
  it('reuses an option of the same name when the agent leaves its id out', () => {
    const first = card(must(sample))
    const agent = toAgentTable(first)
    const ids = agent.columns[4]!.options!.map((o) => o.id)
    agent.columns[4]!.options = agent.columns[4]!.options!.map((o) => ({ name: o.name.toUpperCase(), ...(o.color ? { color: o.color } : {}) }))
    expect(tableColumns(must(agent, first))[4]!.opts.map((o) => o.id)).toEqual(ids)
  })

  it('creates an option for a name it has not seen, and matches names regardless of case', () => {
    const agent: AgentTable = { title: '', columns: [{ name: 'S', type: 'select', options: [{ name: 'Open' }] }], rows: [{ cells: ['open'] }, { cells: ['New one'] }, { cells: ['  NEW ONE '] }] }
    const fields = card(must(agent))
    const [col] = tableColumns(fields)
    expect(col!.opts.map((o) => o.n)).toEqual(['Open', 'New one'])
    expect(toAgentTable(fields).rows.map((r) => r.cells[0])).toEqual(['Open', 'New one', 'New one'])
  })
})

describe('errors name the cell', () => {
  const col = (type: string, extra = {}) => ({ title: '', columns: [{ name: 'Name' }, { name: 'Status', type, ...extra }], rows: [{ cells: ['a', null] }, { cells: ['b', null] }, { cells: ['c', 'bad'] }] })
  it('dates', () => expect(error(col('date'))).toBe('Row 3, "Status": use YYYY-MM-DD'))
  it('numbers', () => expect(error(col('number'))).toBe('Row 3, "Status": use a number'))
  it('ratings', () => {
    expect(error(col('rating'))).toBe('Row 3, "Status": use a whole number from 1 to 5')
    expect(error({ ...col('rating'), rows: [{ cells: ['a', 6] }] })).toContain('Row 1, "Status"')
    expect(error({ ...col('rating'), rows: [{ cells: ['a', 2.5] }] })).toContain('whole number')
  })
  it('checkboxes', () => expect(error(col('checkbox'))).toBe('Row 3, "Status": use true or false'))
  it('too many cells', () => expect(error({ title: '', columns: [{ name: 'A' }], rows: [{ cells: ['a', 'b'] }] })).toBe('Row 1: has 2 cells but the table has 1 columns'))
  it('unknown cell properties and colours', () => {
    expect(error({ title: '', columns: [{ name: 'A' }], rows: [{ cells: [{ value: 'a', italic: true }] }] })).toContain('"italic" is not a cell property')
    expect(error({ title: '', columns: [{ name: 'A' }], rows: [{ color: 'teal', cells: ['a'] }] })).toContain('Row 1: unknown colour "teal"')
  })
  it('bad ids and names', () => {
    expect(error({ title: '', columns: [{ id: 'nope', name: 'A' }], rows: [] })).toContain('Column 1')
    expect(error({ title: '', columns: [{ id: '100001', name: 'A' }, { id: '100001', name: 'B' }], rows: [] })).toContain('used twice')
    expect(error({ title: '', columns: [{ name: 'A', options: [{ name: 'x' }] }], rows: [] })).toContain('type "select"')
    expect(error({ title: '', columns: [{ name: 'A', type: 'select', options: [{ name: 'x' }, { name: 'X' }] }], rows: [] })).toContain('listed twice')
  })
  it('long text', () => expect(error({ title: '', columns: [{ name: 'A' }], rows: [{ cells: ['x'.repeat(TABLE_CAPS.cell + 1)] }] })).toContain('longer than 2000'))
})

describe('caps', () => {
  const rows = (n: number) => Array.from({ length: n }, () => ({ cells: ['x'] }))
  const cols = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `C${i}` }))
  it('accepts the largest table', () => {
    const f = must({ title: '', columns: cols(TABLE_CAPS.cols), rows: rows(TABLE_CAPS.rows) })
    expect(tableRows(f)).toHaveLength(100)
    expect(tableColumns(f)).toHaveLength(26)
  })
  it('refuses one more row or column', () => {
    expect(error({ title: '', columns: cols(1), rows: rows(101) })).toContain('Too many rows: 101 (at most 100')
    expect(error({ title: '', columns: cols(27), rows: [] })).toContain('Too many columns: 27 (at most 26')
    expect(error({ title: '', columns: [], rows: [] })).toContain('at least one column')
  })
})

describe('tableChangeSummary', () => {
  const base = toAgentTable(card(must(sample)))
  const clone = () => structuredClone(base)
  it('describes a new table by its size', () => expect(tableChangeSummary(null, base)).toBe('3 rows · 6 columns'))
  it('is empty when nothing changed', () => expect(tableChangeSummary(base, clone())).toBe(''))
  it('counts cells, rows and columns', () => {
    const a = clone()
    a.rows[0]!.cells[1] = 40
    a.rows[1]!.cells[0] = 'Fido II'
    a.rows[2]!.cells[2] = true
    a.rows.push({ cells: ['New', 1, true, null, null, null] })
    a.columns.splice(5, 1)
    a.rows.forEach((r) => r.cells.splice(5, 1))
    expect(tableChangeSummary(base, a)).toBe('3 cells changed · 1 row added · 1 column removed')
  })
  it('counts singular and plural, moves, recolours and a changed column', () => {
    const a = clone()
    a.rows[0]!.cells[0] = 'Rex II'
    expect(tableChangeSummary(base, a)).toBe('1 cell changed')
    const m = clone()
    m.rows.push(m.rows.shift()!)
    expect(tableChangeSummary(base, m)).toBe('1 row moved')
    const r = clone()
    r.rows[2]!.color = 'sky'
    r.rows.pop()
    expect(tableChangeSummary(base, r)).toBe('1 row removed')
    const c = clone()
    c.columns[1]!.name = 'Kilos'
    c.title = 'Renamed'
    expect(tableChangeSummary(base, c)).toBe('title changed · 1 column changed')
  })
  it('does not count the cells of a removed or added column', () => {
    const a = clone()
    a.columns.push({ id: 'x'.padEnd(6, '1'), name: 'New' })
    a.rows.forEach((r) => r.cells.push('hi'))
    expect(tableChangeSummary(base, a)).toBe('1 column added')
  })
})

describe('table keys', () => {
  it('uses the stored key shapes', () => {
    const f = must({ title: 'x', columns: [{ name: 'A' }], rows: [{ cells: ['a'] }] })
    const [col] = tableColumns(f), [row] = tableRows(f)
    expect(f[colKey(col!.id)]).toBeTruthy()
    expect(f[rowKey(row!.id)]).toBeTruthy()
    expect(f[cellKey(row!.id, col!.id)]).toBe('a')
  })
})

describe('the sort mark for agents', () => {
  const cols = { a: '100001', b: '100002' }, rows = ['200001', '200002']
  const sortedCard = () => card({
    content: { title: 'T' },
    [colKey(cols.a)]: { n: 'Dog', o: 1, w: 1, t: 'text', s: 'd' }, [colKey(cols.b)]: { n: 'Age', o: 2, w: 1, t: 'number' },
    [rowKey(rows[0]!)]: { o: 1 }, [rowKey(rows[1]!)]: { o: 2 },
    [cellKey(rows[0]!, cols.a)]: 'Rex', [cellKey(rows[1]!, cols.a)]: 'Fido',
  })
  it('is read as sorted: asc or desc, and left out when the table is not sorted', () => {
    const t = toAgentTable(sortedCard())
    expect(t.columns[0]!.sorted).toBe('desc')
    expect(t.columns[1]).not.toHaveProperty('sorted')
  })
  it('is ignored on the way in, and kept only while the rows are exactly as read', () => {
    const prev = sortedCard()
    const read = toAgentTable(prev)
    const keep = must(read, prev)
    expect(tableColumns(keep).find((c) => c.id === cols.a)!.s).toBe('d')
    // Sending it for a column that was not sorted does nothing.
    const claimed = structuredClone(read)
    claimed.columns[1]!.sorted = 'asc'
    expect(tableColumns(must(claimed, prev)).find((c) => c.id === cols.b)!.s).toBeUndefined()
    // A new row, a different order, or a removed row drops it.
    const added = structuredClone(read)
    added.rows.push({ cells: ['Biscuit', 3] })
    expect(tableColumns(must(added, prev)).some((c) => c.s)).toBe(false)
    const swapped = structuredClone(read)
    swapped.rows.reverse()
    expect(tableColumns(must(swapped, prev)).some((c) => c.s)).toBe(false)
    const removed = structuredClone(read)
    removed.rows.pop()
    expect(tableColumns(must(removed, prev)).some((c) => c.s)).toBe(false)
    // A new table has none.
    expect(tableColumns(must(read)).some((c) => c.s)).toBe(false)
    // …and a retyped column loses it too.
    const retyped = structuredClone(read)
    retyped.columns[0]!.type = 'select'
    expect(tableColumns(must(retyped, prev)).some((c) => c.s)).toBe(false)
  })
})
