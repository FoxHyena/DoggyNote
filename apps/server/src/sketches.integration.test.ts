import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { DEFAULT_SKETCH, inkBounds } from '@doggynote/core'
import { app } from './app.ts'
import { sha256Hex } from './crypto.ts'
import type { Env } from './env.ts'

// Sketches and board ink: the server accepts only safe paper colours and
// stroke geometry, keeps ink with its card's board, and hides ink in a Toy box.

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  for (const id of ['rex', 'fido']) {
    sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(id, id, 'unused', 0, 1)
    sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex(id), id, 1, Date.now() + 3600000)
  }
  for (const [id, user] of [['root', 'rex'], ['other', 'rex'], ['toybox:rex', 'rex']]) {
    const data = { id, kind: 'board', title: id, parentId: null, icon: 'paw', color: 'gold', createdAt: 1 }
    sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at,owner_id) VALUES(?,'board',?,1,1,?)").run(id, JSON.stringify(data), id.startsWith('toybox:') ? user : null)
    sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(id, user)
  }
  const db = {
    prepare(source: string) {
      let args: unknown[] = []
      const statement = {
        bind(...values: unknown[]) { args = values; return statement },
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
    async batch(statements: { run(): Promise<unknown> }[]) {
      sql.exec('BEGIN')
      try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result } catch (e) { sql.exec('ROLLBACK'); throw e }
    },
  } as unknown as D1Database
  const env = { DB: db } as unknown as Env
  const request = (path: string, body?: unknown, user = 'rex') => app.request(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${user}`, 'content-type': 'application/json', 'x-doggynote-protocol': '3' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  const push = (...changes: Record<string, unknown>[]) => request('/sync', { changes: changes.map((patch) => ({ id: patch.id, patch })) })
  return { push, request }
}

const sketch = (id: string, boardId = 'root', content: unknown = DEFAULT_SKETCH) => ({ id, kind: 'card', type: 'sketch', boardId, x: 0, y: 0, w: 320, h: 240, z: 1, color: 'none', createdAt: 1, content })
const points = [{ x: 10, y: 10 }, { x: 90, y: 60 }]
const stroke = (id: string, cardId: string, boardId = 'root', extra: Record<string, unknown> = {}) => ({ id, kind: 'stroke', boardId, cardId, tool: 'pen', color: '#D7263D', width: 6, opacity: 1, order: 1, points, bounds: inkBounds(points, 6), createdAt: 1, ...extra })

it('accepts a sketch with its strokes, and refuses unsafe paper or geometry', async () => {
  const { push } = await fixture()
  expect((await push(sketch('s1'), stroke('k1', 's1'))).status).toBe(200)
  expect((await push(sketch('s2', 'root', { ...DEFAULT_SKETCH, background: 'url(https://x.test)' }))).status).toBe(403)
  expect((await push(sketch('s3', 'root', { ...DEFAULT_SKETCH, background: '#ffffff' }))).status).toBe(403)
  expect((await push(stroke('k2', 's1', 'root', { color: 'red' }))).status).toBe(403)
  expect((await push(stroke('k3', 's1', 'root', { points: [{ x: -5, y: 0 }] }))).status).toBe(403)
  // Ink belongs to a sketch or board ink card, on that card's board.
  expect((await push(stroke('k4', 's1', 'other'))).status).toBe(403)
  expect((await push(stroke('k5', 'root'))).status).toBe(403)
  // Erasing is a burial, like any other.
  expect((await push({ id: 'k1', deletedAt: 5 })).status).toBe(200)
})

it('a renamed sketch keeps strokes someone else just drew', async () => {
  const { push, request } = await fixture()
  await push(sketch('s1'))
  await push(stroke('k1', 's1'))
  await push({ id: 's1', content: { ...DEFAULT_SKETCH, title: 'Walk route' } })
  const { objects } = await (await request('/sync?since=0')).json() as { objects: { id: string; kind: string; content?: { title?: string } }[] }
  expect(objects.find((o) => o.id === 's1')?.content?.title).toBe('Walk route')
  expect(objects.some((o) => o.id === 'k1' && o.kind === 'stroke')).toBe(true)
})

it('ink on the board sits on the board, never in a column, and strokes follow their card', async () => {
  const { push } = await fixture()
  const ink = { id: 'i1', kind: 'card', type: 'ink', boardId: 'root', x: 0, y: 0, w: 80, h: 60, z: 1, color: 'none', columnId: null, createdAt: 1, content: { width: 80, height: 60 } }
  expect((await push(ink, stroke('k1', 'i1'))).status).toBe(200)
  expect((await push({ ...ink, id: 'i2', content: { width: -1, height: 2 } })).status).toBe(403)
  const col = { id: 'c1', kind: 'card', type: 'column', boardId: 'root', x: 0, y: 0, w: 280, h: 120, z: 1, color: 'none', createdAt: 1, content: { title: '' } }
  expect((await push(col)).status).toBe(200)
  expect((await push({ id: 'i1', columnId: 'c1' })).status).toBe(403)
  // Moving the card takes its ink along in the same push.
  expect((await push({ id: 'i1', boardId: 'other' }, { id: 'k1', boardId: 'other' })).status).toBe(200)
})

it('ink in a Toy box is private to its owner', async () => {
  const { push, request } = await fixture()
  expect((await push(sketch('s1', 'toybox:rex'), stroke('k1', 's1', 'toybox:rex'))).status).toBe(200)
  const { objects } = await (await request('/sync?since=0', undefined, 'fido')).json() as { objects: { id: string; hidden?: boolean; points?: unknown }[] }
  const seen = objects.find((o) => o.id === 'k1')
  expect(seen?.points).toBeUndefined()
})

it('title and paper are fields of their own: a rename and a recolour both survive', async () => {
  const { push, request } = await fixture()
  await push(sketch('s1'))
  expect((await push({ id: 's1', sketchTitle: 'Walk route' })).status).toBe(200)
  expect((await push({ id: 's1', sketchPaper: '#EDEDEA' })).status).toBe(200)
  const { objects } = await (await request('/sync?since=0')).json() as { objects: { id: string; sketchTitle?: string; sketchPaper?: string }[] }
  expect(objects.find((o) => o.id === 's1')).toMatchObject({ sketchTitle: 'Walk route', sketchPaper: '#EDEDEA' })
  expect((await push({ id: 's1', sketchPaper: '#ededea' })).status).toBe(403)
  expect((await push({ id: 's1', sketchPaper: 'url(x)' })).status).toBe(403)
  const column = { id: 'c1', kind: 'card', type: 'column', boardId: 'root', x: 0, y: 0, w: 280, h: 120, z: 1, color: 'none', createdAt: 1, content: { title: '' } }
  expect((await push(column)).status).toBe(200)
  expect((await push({ id: 'c1', sketchTitle: 'no' })).status).toBe(403)
})
