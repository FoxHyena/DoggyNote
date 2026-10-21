import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import * as Y from 'yjs'
import { decodeUpdate, noteDocument, noteState } from '@doggynote/core'
import { sync } from './sync.ts'
import type { AppEnv, Env } from './env.ts'
import { BoardRoom } from './realtime.ts'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  sql.exec("INSERT INTO users VALUES('rex','rex','hash',0,1),('fido','fido','hash',0,1),('stranger','stranger','hash',1,1)")
  sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run('room-session', 'rex', Date.now(), Date.now() + 60_000)
  sql.exec(`INSERT INTO objects(id,kind,data,seq,updated_at) VALUES('root','board','{"id":"root","kind":"board","parentId":null,"title":"Root"}',1,1);
    INSERT INTO board_access VALUES('root','rex',0);
    INSERT INTO board_grants(id,board_id,user_id,permission,include_children,created_by,created_at) VALUES('grant','root','fido','edit',1,'rex',1);
    UPDATE counters SET value=1 WHERE name='seq'`)
  let beforeBatch: (() => void) | undefined
  let tail = Promise.resolve<unknown>(null)
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
    batch(statements: { run(): Promise<unknown> }[]) {
      const result = tail.then(async () => {
        const hook = beforeBatch; beforeBatch = undefined; hook?.()
        sql.exec('BEGIN')
        try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results } catch (e) { sql.exec('ROLLBACK'); throw e }
      })
      tail = result.catch(() => {})
      return result
    },
  } as unknown as D1Database
  const app = new Hono<AppEnv>().basePath('/api')
  app.use('*', async (c, next) => { const id = c.req.header('x-test-user') ?? 'rex'; c.set('user', { id, username: id, isAdmin: id === 'stranger' }); await next() })
  app.route('/', sync)
  const request = (path: string, body?: unknown, user = 'rex') => app.request(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-test-user': user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: db } as Env)
  const push = (patch: object, user = 'rex', id = 'note') => request('/sync', { changes: [{ id, patch }] }, user)
  const create = () => push({ id: 'note', kind: 'card', type: 'note', boardId: 'root', x: 0, y: 0, w: 260, h: 80, z: 1, content: { md: 'baseline' }, createdAt: 1 })
  const snapshot = async (user = 'rex') => (await (await request('/sync?since=0', undefined, user)).json() as { objects: { id: string; content: { md: string }; noteState: string }[] }).objects.find((o) => o.id === 'note')!
  return { sql, db, request, push, create, snapshot, beforeBatch: (fn: () => void) => { beforeBatch = fn } }
}

it('merges disconnected authors durably, retries races, and treats repeated updates idempotently', async () => {
  const f = fixture()
  try {
    expect((await f.create()).status).toBe(200)
    const initial = await f.snapshot(), a = noteDocument(initial.noteState), b = noteDocument(initial.noteState)
    a.getText('markdown').insert(0, 'rex '); b.getText('markdown').insert(8, ' fido')
    const results = await Promise.all([f.push({ noteUpdate: noteState(a) }), f.push({ noteUpdate: noteState(b) }, 'fido')])
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true)
    expect((await f.push({ noteUpdate: noteState(a) })).status).toBe(200)
    expect((await f.request('/notes/note/sync', { update: noteState(b) }, 'fido')).status).toBe(200)
    const merged = await f.snapshot()
    expect(merged.content.md).toBe('rex baseline fido')
    expect(noteDocument(merged.noteState).getText('markdown').toString()).toBe(merged.content.md)
    expect((await f.push({ noteUpdate: noteState(a) })).status).toBe(200)
    expect((await f.snapshot()).content.md).toBe(merged.content.md)
    a.destroy(); b.destroy()
  } finally { f.sql.close() }
})

it('rolls back text, projection and metadata together on a racing permission or object revision', async () => {
  const f = fixture()
  try {
    await f.create()
    const before = await f.snapshot(), d = noteDocument(before.noteState)
    d.getText('markdown').insert(0, 'new ')
    f.beforeBatch(() => f.sql.exec("UPDATE objects SET seq=seq+1 WHERE id='note'"))
    expect((await f.push({ x: 123, noteUpdate: noteState(d) })).status).toBe(409)
    expect((await f.snapshot()).content.md).toBe('baseline')
    expect(JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='note'").get() as { data: string }).data).x).toBe(0)
    f.beforeBatch(() => f.sql.exec("UPDATE counters SET value=value+1 WHERE name='access_revision'"))
    expect((await f.push({ noteUpdate: noteState(d) })).status).toBe(409)
    expect((await f.snapshot()).content.md).toBe('baseline')
    d.destroy()
  } finally { f.sql.close() }
})

it('rejects whole-text replacement, forged state, viewers, private-board admins and stale deleted-note updates', async () => {
  const f = fixture()
  try {
    await f.create()
    const d = noteDocument((await f.snapshot()).noteState); d.getText('markdown').insert(0, 'new ')
    expect((await f.push({ content: { md: 'overwrite' } })).status).toBe(403)
    expect((await f.push({ noteState: noteState(d) })).status).toBe(400)
    expect((await f.push({ noteUpdate: null, content: { md: 'overwrite' } })).status).toBe(400)
    expect((await f.push({ noteUpdate: noteState(d) }, 'stranger')).status).toBe(403)
    f.sql.exec("UPDATE board_grants SET permission='view' WHERE id='grant'")
    expect((await f.push({ noteUpdate: noteState(d) }, 'fido')).status).toBe(403)
    await f.push({ deletedAt: Date.now() })
    expect((await f.push({ noteUpdate: noteState(d) })).status).toBe(403)
    expect((await f.snapshot()).content.md).toBe('baseline')
    d.destroy()
  } finally { f.sql.close() }
})

it('seeds legacy notes exactly once and survives an update delivered before its dependency', async () => {
  const f = fixture()
  try {
    await f.create(); f.sql.exec("DELETE FROM note_states WHERE id='note'")
    const a = await f.snapshot(), b = await f.snapshot()
    expect(a.noteState).toBe(b.noteState)
    const doc = noteDocument(a.noteState), updates: Uint8Array[] = []
    doc.on('update', (u: Uint8Array) => updates.push(u))
    doc.getText('markdown').insert(8, ' one'); doc.getText('markdown').insert(12, ' two')
    const { encodeUpdate } = await import('@doggynote/core')
    await f.push({ noteUpdate: encodeUpdate(updates[1]!) })
    await f.push({ noteUpdate: encodeUpdate(updates[0]!) })
    expect((await f.snapshot()).content.md).toBe('baseline one two')
    Y.applyUpdate(doc, decodeUpdate((await f.snapshot()).noteState))
    expect(doc.getText('markdown').toString()).toBe('baseline one two')
    doc.destroy()
  } finally { f.sql.close() }
})

/** Exercise the real room handlers with hibernation-style socket attachments. */
function roomFixture() {
  const f = fixture(), values = new Map<string, unknown>(), sockets: WebSocket[] = [], alarms: number[] = []
  const storage = {
    async get(key: string) { return values.get(key) },
    async delete(key: string) { return values.delete(key) },
    async list({ prefix }: { prefix: string }) { return new Map([...values].filter(([key]) => key.startsWith(prefix))) },
    async setAlarm(at: number) { alarms.push(at) },
    async transaction<T>(callback: (tx: typeof storage) => Promise<T>): Promise<T> { return callback(storage) },
  }
  const ctx = { storage, getWebSockets: () => sockets.filter((s) => s.readyState === 1), waitUntil: () => {} } as unknown as DurableObjectState
  const room = new BoardRoom(ctx, { DB: f.db } as Env)
  const socket = () => {
    let attachment: unknown = { seen: Date.now(), last: 0 }
    const messages: { type: string; members?: { username: string; canEdit: boolean }[] }[] = [], closed: number[] = []
    const ws = { readyState: 1, deserializeAttachment: () => structuredClone(attachment), serializeAttachment: (value: unknown) => { attachment = structuredClone(value) }, send: (message: string) => messages.push(JSON.parse(message)), close: (code = 1000) => { ws.readyState = 3; closed.push(code) } }
    sockets.push(ws as unknown as WebSocket)
    return { ws: ws as unknown as WebSocket, messages, closed, attachment: () => attachment }
  }
  const ticket = (key: string, expires = Date.now() + 30_000) => values.set(`ticket:${key}`, { user: { id: 'rex', username: 'rex', isAdmin: false }, hash: 'room-session', board: 'root', expires, canEdit: true })
  return { ...f, room, socket, ticket, values, alarms, restoreRoom: () => new BoardRoom(ctx, { DB: f.db } as Env) }
}

it('consumes room tickets once, rejects expired/malformed authentication, and restores attached sessions', async () => {
  const f = roomFixture()
  try {
    f.ticket('one-use')
    const first = f.socket()
    await f.room.webSocketMessage(first.ws, JSON.stringify({ type: 'auth', ticket: 'one-use' }))
    expect(first.messages.some((m) => m.type === 'ready')).toBe(true)
    const replay = f.socket()
    await f.room.webSocketMessage(replay.ws, JSON.stringify({ type: 'auth', ticket: 'one-use' }))
    expect(replay.closed).toContain(1008)
    f.ticket('old', Date.now() - 1)
    const expired = f.socket()
    await f.room.webSocketMessage(expired.ws, JSON.stringify({ type: 'auth', ticket: 'old' }))
    expect(expired.closed).toContain(1008)
    const malformed = f.socket()
    await f.room.webSocketMessage(malformed.ws, 'null')
    expect(malformed.closed).toContain(1008)
    // A newly created instance has no in-memory authorization cache.
    await f.restoreRoom().alarm()
    expect(first.messages.at(-1)?.members?.[0]?.username).toBe('rex')
    expect(f.alarms.length).toBeGreaterThan(0)
  } finally { f.sql.close() }
})

it('expires idle room sessions within 30 seconds and never broadcasts to a revoked session', async () => {
  const f = roomFixture()
  try {
    f.ticket('idle'); const idle = f.socket()
    await f.room.webSocketMessage(idle.ws, JSON.stringify({ type: 'auth', ticket: 'idle' }))
    idle.ws.serializeAttachment({ ...(idle.attachment() as object), seen: Date.now() - 30_001 })
    await f.room.alarm()
    expect(idle.closed).toContain(1008)
    f.ticket('revoked'); const revoked = f.socket()
    await f.room.webSocketMessage(revoked.ws, JSON.stringify({ type: 'auth', ticket: 'revoked' }))
    const before = revoked.messages.length
    f.sql.exec("DELETE FROM sessions WHERE token_hash='room-session'")
    await f.room.alarm()
    expect(revoked.closed).toContain(1008)
    expect(revoked.messages).toHaveLength(before)
  } finally { f.sql.close() }
})

it('denies private Inbox subscriptions and clears moved or deleted preview references before broadcasts', async () => {
  const f = roomFixture()
  try {
    await f.create()
    f.ticket('private')
    f.values.set('ticket:private', { ...(f.values.get('ticket:private') as object), board: 'toybox:fido' })
    const denied = f.socket()
    await f.room.webSocketMessage(denied.ws, JSON.stringify({ type: 'auth', ticket: 'private' }))
    expect(denied.closed).toContain(1008)
    f.ticket('editor'); const editor = f.socket()
    await f.room.webSocketMessage(editor.ws, JSON.stringify({ type: 'auth', ticket: 'editor' }))
    await f.room.webSocketMessage(editor.ws, JSON.stringify({ type: 'presence', pointer: null, selection: ['note'], editing: 'note', camera: { x: 0, y: 0, zoom: 1 }, width: 800, height: 600, previews: [{ id: 'note', x: 20, y: 20 }], caret: null }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((editor.attachment() as { member: { previews: unknown[] } }).member.previews).toHaveLength(1)
    f.sql.exec("UPDATE objects SET board_id='toybox:fido',data=json_set(data,'$.boardId','toybox:fido') WHERE id='note'")
    await f.room.alarm()
    const member = (editor.attachment() as { member: { previews: unknown[]; selection: string[]; editing: string | null } }).member
    expect(member.previews).toEqual([]); expect(member.selection).toEqual([]); expect(member.editing).toBeNull()
    f.sql.exec("DELETE FROM board_access WHERE board_id='root'; UPDATE counters SET value=value+1 WHERE name='access_revision'")
    const before = editor.messages.length
    await f.room.alarm()
    expect(editor.closed).toContain(1008); expect(editor.messages).toHaveLength(before)
  } finally { f.sql.close() }
})

it('allows explicit creation redo but a stale update cannot clear a purged tombstone', async () => {
  const f = fixture()
  try {
    await f.create(); const state = (await f.snapshot()).noteState
    expect((await f.push({ purged: true })).status).toBe(200)
    expect((await f.push({ purged: false, noteUpdate: state })).status).toBe(403)
    expect((await f.push({ purged: false, noteUpdate: state, noteRestore: true })).status).toBe(200)
    expect((await f.snapshot()).content.md).toBe('baseline')
    const data = JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='note'").get() as { data: string }).data)
    expect(data.purged).toBe(false); expect(data.noteRestore).toBeUndefined()
  } finally { f.sql.close() }
})
