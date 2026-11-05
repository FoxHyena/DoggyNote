import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { cellKey, colKey, rowKey, tableId, validTableField } from '@doggynote/core'
import { app } from './app.ts'
import { sha256Hex } from './crypto.ts'
import type { Env } from './env.ts'
import { upsertSql } from './sync.ts'

// Table cards: every row, column and cell is a top-level field, so one push can
// carry thousands of keys. The server writes them in one atomic batch, removes
// null ones, and accepts them on table cards only.

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  for (const id of ['rex', 'fido']) {
    sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(id, id, 'unused', 0, 1)
    sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex(id), id, 1, Date.now() + 3600000)
  }
  for (const [id, user] of [['root', 'rex'], ['toybox:rex', 'rex']]) {
    const data = { id, kind: 'board', title: id, parentId: null, icon: 'paw', color: 'gold', createdAt: 1 }
    sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at,owner_id) VALUES(?,'board',?,1,1,?)").run(id, JSON.stringify(data), id.startsWith('toybox:') ? user : null)
    sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(id, user)
  }
  const statements: { sql: string; params: number }[] = []
  const db = {
    prepare(source: string) {
      let args: unknown[] = []
      const statement = {
        bind(...values: unknown[]) {
          args = values
          // D1 refuses more than 100 bound parameters in one statement; node:sqlite doesn't.
          statements.push({ sql: source, params: values.length })
          return statement
        },
        query() {
          const values: unknown[] = []
          const text = source.replace(/\?(\d+)/g, (_, n: string) => { values.push(args[Number(n) - 1]); return '?' })
          return { query: sql.prepare(text), values: values as (string | number | null)[] }
        },
        async all() { const { query, values } = statement.query(); return { results: query.all(...values) } },
        async first() { const { query, values } = statement.query(); return query.get(...values) ?? null },
        async run() { const { query, values } = statement.query(); const r = query.run(...values); return { success: true, meta: { changes: Number(r.changes) } } },
      }
      return statement
    },
    async batch(batch: { run(): Promise<unknown> }[]) {
      sql.exec('BEGIN')
      try { const result = []; for (const s of batch) result.push(await s.run()); sql.exec('COMMIT'); return result } catch (e) { sql.exec('ROLLBACK'); throw e }
    },
  } as unknown as D1Database
  const env = { DB: db } as unknown as Env
  const request = (path: string, body?: unknown, user = 'rex') => app.request(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${user}`, 'content-type': 'application/json', 'x-doggynote-protocol': '4' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  const push = (...changes: Record<string, unknown>[]) => request('/sync', { changes: changes.map((patch) => ({ id: patch.id, patch })) })
  const pull = async () => ((await (await request('/sync?since=0')).json()) as { objects: Record<string, unknown>[] }).objects
  const find = async (id: string) => (await pull()).find((o) => o.id === id)
  const row = (id: string) => sql.prepare('SELECT data, seq FROM objects WHERE id=?').get(id) as { data: string; seq: number } | undefined
  const counter = () => (sql.prepare("SELECT value FROM counters WHERE name='seq'").get() as { value: number }).value
  return { push, find, row, counter, statements }
}

const base = (id: string, type = 'table', boardId = 'root', extra: Record<string, unknown> = {}) => ({ id, kind: 'card', type, boardId, x: 0, y: 0, w: 420, h: 140, z: 1, color: 'none', createdAt: 1, content: type === 'table' ? { title: '' } : { md: '' }, ...extra })

/** `rows` x `cols` table fields: every cell filled. */
function grid(rows: number, cols: number) {
  const fields: Record<string, unknown> = {}
  const colIds = Array.from({ length: cols }, (_, i) => `1${i.toString(36).padStart(5, '0')}`)
  const rowIds = Array.from({ length: rows }, (_, i) => `2${i.toString(36).padStart(5, '0')}`)
  colIds.forEach((id, i) => { fields[colKey(id)] = { n: `C${i}`, o: i + 1, w: 1, t: 'text' } })
  rowIds.forEach((r, i) => {
    fields[rowKey(r)] = { o: i + 1 }
    for (const c of colIds) fields[cellKey(r, c)] = `${i}`
  })
  return { fields, rowIds, colIds }
}

it('writes a 3000-key table in one atomic push, within D1 parameter limits, bumping seq once', async () => {
  const { push, find, row, counter, statements } = await fixture()
  const { fields, rowIds, colIds } = grid(120, 24)
  expect(Object.keys(fields).length).toBeGreaterThan(3000)
  const before = counter()
  expect((await push(base('t1', 'table', 'root', fields))).status).toBe(200)
  expect(counter()).toBe(before + 1)
  expect(Math.max(...statements.map((s) => s.params))).toBeLessThanOrEqual(100)
  const stored = await find('t1') as Record<string, unknown>
  expect(Object.keys(stored).filter((k) => /^t[rkc]/.test(k))).toHaveLength(Object.keys(fields).length)
  // Editing the same table later spreads the keys over several statements too.
  const edit: Record<string, unknown> = {}
  for (const r of rowIds.slice(0, 100)) edit[cellKey(r, colIds[0]!)] = 'edited'
  statements.length = 0
  expect((await push({ id: 't1', ...edit })).status).toBe(200)
  expect(counter()).toBe(before + 2)
  expect(statements.filter((s) => s.sql.includes('UPDATE objects SET data')).length).toBeGreaterThan(0)
  expect(Math.max(...statements.map((s) => s.params))).toBeLessThanOrEqual(100)
  const after = await find('t1') as Record<string, unknown>
  expect(after[cellKey(rowIds[0]!, colIds[0]!)]).toBe('edited')
  expect(after[cellKey(rowIds[99]!, colIds[0]!)]).toBe('edited')
  expect(after[cellKey(rowIds[100]!, colIds[0]!)]).toBe('100')
  expect(row('t1')!.seq).toBe(counter())
})

it('keeps concurrent edits to different cells, and the last write wins on the same one', async () => {
  const { push, find } = await fixture()
  const { fields, rowIds, colIds } = grid(3, 3)
  await push(base('t1', 'table', 'root', fields))
  await push({ id: 't1', [cellKey(rowIds[0]!, colIds[0]!)]: 'mine' })
  await push({ id: 't1', [cellKey(rowIds[1]!, colIds[1]!)]: 'theirs' })
  await push({ id: 't1', [cellKey(rowIds[0]!, colIds[0]!)]: 'later' })
  const t = await find('t1') as Record<string, unknown>
  expect(t[cellKey(rowIds[0]!, colIds[0]!)]).toBe('later')
  expect(t[cellKey(rowIds[1]!, colIds[1]!)]).toBe('theirs')
  expect(t[cellKey(rowIds[2]!, colIds[2]!)]).toBe('2')
})

it('removes null table keys, including beyond one statement, and never stores them on insert', async () => {
  const { push, find, row } = await fixture()
  const { fields, rowIds, colIds } = grid(30, 10)
  await push(base('t1', 'table', 'root', fields))
  const gone: Record<string, unknown> = { [rowKey(rowIds[0]!)]: null }
  for (const c of colIds) gone[cellKey(rowIds[0]!, c)] = null
  for (const r of rowIds.slice(1, 20)) for (const c of colIds) gone[cellKey(r, c)] = null
  expect(Object.keys(gone).length).toBeGreaterThan(176)
  expect((await push({ id: 't1', ...gone, [rowKey(rowIds[25]!)]: { o: 99 } })).status).toBe(200)
  const t = await find('t1') as Record<string, unknown>
  for (const key of Object.keys(gone)) expect(key in t, key).toBe(false)
  expect(t[rowKey(rowIds[25]!)]).toEqual({ o: 99 })
  expect(t[cellKey(rowIds[29]!, colIds[9]!)]).toBe('29')
  expect(Object.keys(t).filter((k) => /^t[rkc]/.test(k))).toHaveLength(Object.keys(fields).length - Object.keys(gone).length)
  // A new object created with tombstones doesn't keep them.
  const [r1] = rowIds
  await push(base('t2', 'table', 'root', { [rowKey(r1!)]: { o: 1 }, [cellKey(r1!, colIds[0]!)]: null }))
  expect(JSON.parse(row('t2')!.data)).not.toHaveProperty(cellKey(r1!, colIds[0]!))
  // Other fields still treat null as a value, as before.
  await push({ id: 't2', note: 'x' })
  await push({ id: 't2', note: null })
  expect(JSON.parse(row('t2')!.data).note).toBeNull()
})

it('builds the statements: 88 keys each, paths inlined for removals', () => {
  const patch: Record<string, unknown> = { id: 'a', x: 1 }
  for (let i = 0; i < 200; i++) patch[cellKey(tableId(), tableId())] = `${i}`
  const gone = Array.from({ length: 100 }, () => rowKey(tableId()))
  for (const k of gone) patch[k] = null
  const { sql, args, more } = upsertSql(patch)
  expect(args).toHaveLength(88)
  expect(sql).toContain('json_set(objects.data')
  expect(sql).toContain(`json_remove(json_set(json_set(objects.data`)
  expect(more.map((m) => m.args.length)).toEqual([88, 25, 0])
  expect(more.every((m) => m.sql.startsWith('UPDATE objects SET data'))).toBe(true)
  expect(more.at(-1)!.sql).toContain(`'$.${gone[99]}'`)
  expect(() => upsertSql({ "x') --": 1 })).toThrow()
})

it('refuses table fields on anything but a table card, and bad values anywhere', async () => {
  const { push } = await fixture()
  const { fields, rowIds, colIds } = grid(2, 2)
  const cell = cellKey(rowIds[0]!, colIds[0]!)
  // A note, a new one or an existing one, takes no table fields.
  expect((await push(base('n1', 'note', 'root', { [cell]: 'x' }))).status).toBe(403)
  expect((await push(base('n2', 'note'))).status).toBe(200)
  expect((await push({ id: 'n2', [cell]: 'x' })).status).toBe(403)
  expect((await push({ id: 'n2', [cell]: null })).status).toBe(403)
  expect((await push({ id: 'root', [cell]: 'x' })).status).toBe(403)
  expect((await push(base('t1', 'table', 'root', fields))).status).toBe(200)
  // Wrong shapes are refused before any write.
  for (const bad of [{ [cell]: 'x'.repeat(2001) }, { [cell]: { bg: 'url(x)' } }, { [cell]: [1] }, { [rowKey(rowIds[0]!)]: { o: 'a' } }, { [colKey(colIds[0]!)]: { n: 'x', o: 1, w: 0, t: 'text' } }, { [colKey(colIds[0]!)]: { n: 'x', o: 1, w: 1, t: 'nope' } }, { [colKey(colIds[0]!)]: { n: 'x', o: 1, w: 1, t: 'text', s: 'up' } }]) {
    const res = await push({ id: 't1', ...bad })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('bad table field')
  }
  // The sort mark is an additive column field: both directions are accepted.
  expect((await push({ id: 't1', [colKey(colIds[0]!)]: { n: 'x', o: 1, w: 1, t: 'text', s: 'a' } })).status).toBe(200)
  expect((await push({ id: 't1', [colKey(colIds[0]!)]: { n: 'x', o: 1, w: 1, t: 'text', s: 'd' } })).status).toBe(200)
  // A table can't become a note, and its content stays an object.
  expect((await push({ id: 't1', type: 'note' })).status).toBe(403)
  expect((await push({ id: 't1', content: 'x' })).status).toBe(403)
  expect((await push({ id: 't1', content: { title: 5 } })).status).toBe(403)
  expect((await push({ id: 't1', content: { title: 'Pack list' } })).status).toBe(200)
})

it('enforces the row, column and size caps on the whole table', async () => {
  const { push } = await fixture()
  expect((await push(base('rows', 'table', 'root', grid(150, 1).fields))).status).toBe(200)
  const more = grid(151, 1)
  expect((await push({ id: 'rows', [rowKey('2zzzzz')]: { o: 1000 } })).status).toBe(403)
  expect((await push(base('rows2', 'table', 'root', more.fields))).status).toBe(403)
  expect((await push(base('cols', 'table', 'root', grid(1, 40).fields))).status).toBe(200)
  expect((await push({ id: 'cols', [colKey('1zzzzz')]: { n: 'x', o: 99, w: 1, t: 'text' } })).status).toBe(403)
  // Removing rows in the same push makes room.
  expect((await push({ id: 'rows', [rowKey('2zzzzz')]: { o: 1000 }, [rowKey(grid(1, 1).rowIds[0]!)]: null })).status).toBe(200)
  // More than 1 MB of cells.
  const huge: Record<string, unknown> = {}
  const ids = Array.from({ length: 150 }, (_, i) => `2${i.toString(36).padStart(5, '0')}`)
  await push(base('big', 'table', 'root', Object.fromEntries(ids.map((r, i) => [rowKey(r), { o: i }]))))
  for (let c = 0; c < 4; c++) {
    const col = `1${c}0000`
    Object.assign(huge, { [colKey(col)]: { n: 'c', o: c, w: 1, t: 'text' } })
    for (const r of ids) huge[cellKey(r, col)] = 'x'.repeat(2000)
  }
  let status = 0
  for (const chunk of Object.entries(huge).reduce<Record<string, unknown>[]>((acc, entry, i) => { (acc[Math.floor(i / 100)] ??= {})[entry[0]] = entry[1]; return acc }, [])) {
    status = (await push({ id: 'big', ...chunk })).status
    if (status !== 200) break
  }
  expect(status).toBe(403)
})

it('limits ordinary objects to 90 keys as before, and a normal note push is unaffected', async () => {
  const { push, find } = await fixture()
  const many = Object.fromEntries(Array.from({ length: 91 }, (_, i) => [`field${i}`, i]))
  expect((await push(base('n1', 'note', 'root', many))).status).toBe(400)
  expect((await push(base('n1', 'note'))).status).toBe(200)
  expect((await push({ id: 'n1', x: 50, color: 'sky' })).status).toBe(200)
  expect(await find('n1')).toMatchObject({ x: 50, color: 'sky', content: { md: '' } })
  const tooMany = grid(100, 51).fields
  expect(Object.keys(tooMany).length).toBeGreaterThan(5000)
  expect((await push(base('t1', 'table', 'root', tooMany))).status).toBe(400)
})

it('shares nothing from a Toy box: table fields are private like any other', async () => {
  const { push, find } = await fixture()
  const { fields } = grid(2, 2)
  expect((await push(base('t1', 'table', 'toybox:rex', fields))).status).toBe(200)
  expect(await find('t1')).toBeTruthy()
  for (const [key, value] of Object.entries(fields)) expect(validTableField(key, value)).toBe(true)
})
