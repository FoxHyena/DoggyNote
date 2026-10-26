import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { noteDocument, noteState, replaceText } from '@doggynote/core'
import { app } from './app.ts'
import { sha256Hex } from './crypto.ts'
import type { Env } from './env.ts'

// Synced notes: copies keep one text, joining needs edit access to every copy,
// and nothing synced ever sits in a Toy box (rule 10).

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  for (const id of ['rex', 'fido']) {
    sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(id, id, 'unused', 0, 1)
    sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex(id), id, 1, Date.now() + 3600000)
  }
  for (const [id, user] of [['shared', 'rex'], ['other', 'rex'], ['peek', 'rex'], ['kennel', 'fido'], ['toybox:rex', 'rex'], ['toybox:fido', 'fido']]) {
    const data = { id, kind: 'board', title: id, parentId: null, icon: 'paw', color: 'gold', createdAt: 1 }
    sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at,owner_id) VALUES(?,'board',?,1,1,?)").run(id, JSON.stringify(data), id.startsWith('toybox:') ? user : null)
    sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(id, user)
  }
  // fido edits "shared" and only views "peek".
  sql.exec("INSERT INTO board_grants(id,board_id,user_id,permission,include_children,created_by,created_at) VALUES ('g1','shared','fido','edit',1,'rex',1),('g2','peek','fido','view',1,'rex',1)")
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
  const request = (path: string, body?: unknown, user = 'rex') => app.request(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${user}`, 'content-type': 'application/json', 'x-doggynote-protocol': '4' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  const pushAs = (user: string, ...changes: Record<string, unknown>[]) => request('/sync', { changes: changes.map((patch) => ({ id: patch.id, patch })) }, user)
  const push = (...changes: Record<string, unknown>[]) => pushAs('rex', ...changes)
  type Pulled = { id: string; syncId?: string | null; content?: { md?: string }; noteState?: string; hidden?: boolean }
  const pull = async (user = 'rex') => ((await (await request('/sync?since=0', undefined, user)).json()) as { objects: Pulled[] }).objects
  const find = async (id: string, user = 'rex') => (await pull(user)).find((o) => o.id === id)
  return { push, pushAs, pull, find, sql }
}

const card = (id: string, boardId: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'card', type: 'note', boardId, x: 0, y: 0, w: 240, h: 80, z: 1, color: 'none', createdAt: 1, ...extra })
function state(text: string, from?: string) {
  const doc = noteDocument(from)
  replaceText(doc.getText('markdown'), text)
  try { return noteState(doc) } finally { doc.destroy() }
}
/** A note "a" on "shared", plus a synced copy "b" on `copyBoard`, the way the app makes one. */
async function linked(f: Awaited<ReturnType<typeof fixture>>, copyBoard = 'other') {
  expect((await f.push({ ...card('a', 'shared'), content: { md: 'Walk at 6' }, noteUpdate: state('Walk at 6') })).status).toBe(200)
  const clone = (await f.find('a'))!.noteState!
  const res = await f.push({ id: 'a', syncId: 'a', syncJoin: true }, { ...card('b', copyBoard), syncId: 'a', syncJoin: true, content: { md: 'Walk at 6' }, noteUpdate: clone })
  expect(res.status).toBe(200)
}
const edit = async (f: Awaited<ReturnType<typeof fixture>>, id: string, text: string, user = 'rex') => {
  const current = (await f.find(id, user))!.noteState!
  return f.pushAs(user, { id, noteUpdate: state(text, current) })
}

it('edits to either copy update both, and an independent copy stops following', async () => {
  const f = await fixture()
  await linked(f)
  expect((await edit(f, 'a', 'Walk at 7')).status).toBe(200)
  expect((await f.find('b'))?.content?.md).toBe('Walk at 7')
  expect((await edit(f, 'b', 'Walk at 8')).status).toBe(200)
  expect((await f.find('a'))?.content?.md).toBe('Walk at 8')
  // Make an independent copy: b keeps its text, and edits stop flowing.
  expect((await f.push({ id: 'b', syncId: null })).status).toBe(200)
  await edit(f, 'a', 'Walk at 9')
  expect((await f.find('b'))?.content?.md).toBe('Walk at 8')
  expect((await f.find('a'))?.content?.md).toBe('Walk at 9')
})

it('a buried copy is left alone, and catches up when it comes back', async () => {
  const f = await fixture()
  await linked(f)
  expect((await f.push({ id: 'b', deletedAt: 5 })).status).toBe(200)
  await edit(f, 'a', 'Vet on Friday')
  expect((await f.find('b'))?.content?.md).toBe('Walk at 6')
  expect((await f.find('a'))?.content?.md).toBe('Vet on Friday')
  expect((await f.push({ id: 'b', deletedAt: null })).status).toBe(200)
  expect((await f.find('b'))?.content?.md).toBe('Vet on Friday')
  // Emptying Buried bones takes one copy for good; the other stays.
  await f.push({ id: 'b', deletedAt: 9 })
  expect((await f.push({ id: 'b', purged: true })).status).toBe(200)
  expect((await edit(f, 'a', 'Vet on Monday')).status).toBe(200)
  expect((await f.find('a'))?.content?.md).toBe('Vet on Monday')
})

it('never syncs into a Toy box, and a synced note moved there unsyncs', async () => {
  const f = await fixture()
  // A synced copy straight into the Toy box is refused.
  await f.push({ ...card('a', 'shared'), content: { md: 'Shared' }, noteUpdate: state('Shared') })
  const clone = (await f.find('a'))!.noteState!
  expect((await f.push({ id: 'a', syncId: 'a', syncJoin: true }, { ...card('t', 'toybox:rex'), syncId: 'a', syncJoin: true, content: { md: 'Shared' }, noteUpdate: clone })).status).toBe(403)
  // Nor out of one.
  await f.push({ ...card('p', 'toybox:rex'), content: { md: 'Secret plan' }, noteUpdate: state('Secret plan') })
  const secret = (await f.find('p'))!.noteState!
  expect((await f.push({ id: 'p', syncId: 'p', syncJoin: true }, { ...card('leak', 'shared'), syncId: 'p', syncJoin: true, content: { md: 'Secret plan' }, noteUpdate: secret })).status).toBe(403)
  // Moving a synced copy into the Toy box makes it independent and private.
  await f.push({ id: 'a', syncId: 'a', syncJoin: true }, { ...card('b', 'other'), syncId: 'a', syncJoin: true, content: { md: 'Shared' }, noteUpdate: clone })
  expect((await f.push({ id: 'b', boardId: 'toybox:rex' })).status).toBe(200)
  expect((await f.find('b'))?.syncId).toBeNull()
  await edit(f, 'b', 'Secret plan, now private')
  expect((await f.find('a'))?.content?.md).toBe('Shared')
  const seen = JSON.stringify(await f.pull('fido'))
  expect(seen).toContain('Shared')
  expect(seen).not.toContain('Secret plan')
})

it("fido can't join a group he can't edit, and a copied syncId without a join is dropped", async () => {
  const f = await fixture()
  await linked(f, 'peek')
  const clone = (await f.find('a', 'fido'))!.noteState!
  // b sits on "peek", which fido only views: joining would let him rewrite it.
  expect((await f.pushAs('fido', { ...card('f1', 'kennel'), syncId: 'a', syncJoin: true, content: { md: 'Walk at 6' }, noteUpdate: clone })).status).toBe(403)
  // An older app copies every field, syncId included, but never sends syncJoin.
  expect((await f.pushAs('fido', { ...card('f2', 'kennel'), syncId: 'a', content: { md: 'Walk at 6' }, noteUpdate: state('Walk at 6') })).status).toBe(200)
  expect((await f.find('f2', 'fido'))?.syncId).toBeNull()
  await edit(f, 'f2', 'Fido was here', 'fido')
  expect((await f.find('a'))?.content?.md).toBe('Walk at 6')
  expect((await f.find('b'))?.content?.md).toBe('Walk at 6')
  // A bad syncId is a bad request.
  expect((await f.push({ id: 'a', syncId: 'no spaces!', syncJoin: true })).status).toBe(400)
})

it("a copy whose editor can't edit every copy stops syncing and keeps the edit", async () => {
  const f = await fixture()
  await f.push({ ...card('a', 'shared'), content: { md: 'Walk at 6' }, noteUpdate: state('Walk at 6') })
  const clone = (await f.find('a', 'fido'))!.noteState!
  // fido can edit "shared" now, so he may link his own copy on his kennel.
  expect((await f.pushAs('fido', { id: 'a', syncId: 'a', syncJoin: true }, { ...card('f1', 'kennel'), syncId: 'a', syncJoin: true, content: { md: 'Walk at 6' }, noteUpdate: clone })).status).toBe(200)
  // rex downgrades fido to view on "shared".
  f.sql.exec("UPDATE board_grants SET permission='view' WHERE id='g1'; UPDATE counters SET value=value+1 WHERE name='access_revision'")
  const res = await edit(f, 'f1', 'Walk at 6, fido says 7', 'fido')
  expect(res.status).toBe(200)
  expect((await res.json() as { detachedIds?: string[] }).detachedIds).toEqual(['f1'])
  expect(await f.find('f1', 'fido')).toMatchObject({ syncId: null, content: { md: 'Walk at 6, fido says 7' } })
  expect((await f.find('a'))?.content?.md).toBe('Walk at 6')
  // rex's own edits no longer reach fido's copy either.
  await edit(f, 'a', 'Walk at 8')
  expect((await f.find('f1', 'fido'))?.content?.md).toBe('Walk at 6, fido says 7')
})
