import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { unreadThreads, readMark, type Comment, type Seen } from '@doggynote/core'
import { app } from './app.ts'
import { sha256Hex } from './crypto.ts'
import type { Env } from './env.ts'

// Unread is worked out on the device from what sync gives it plus its read marks.
// These tests run that same calculation on what the server really sends each person.

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  for (const id of ['rex', 'fido']) {
    sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(id, id, 'unused', 0, 1)
    sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex(id), id, 1, Date.now() + 3600000)
  }
  // rex owns everything; fido may edit "shared" only.
  for (const id of ['shared', 'private', 'toybox:rex']) {
    const data = { id, kind: 'board', title: id, parentId: null, icon: 'paw', color: 'gold', createdAt: 1 }
    sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at,owner_id) VALUES(?,'board',?,1,1,?)").run(id, JSON.stringify(data), id.startsWith('toybox:') ? 'rex' : null)
    sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(id, 'rex')
  }
  sql.prepare("INSERT INTO board_grants(id,board_id,user_id,permission,include_children,created_by,created_at) VALUES('g','shared','fido','edit',1,'rex',1)").run()
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
  const push = (user: string, ...changes: Record<string, unknown>[]) => request('/sync', { changes: changes.map((patch) => ({ id: patch.id, patch })) }, user)
  const card = (id: string, boardId: string) => ({ id, kind: 'card', type: 'note', boardId, x: 0, y: 0, w: 200, h: 60, z: 1, color: 'none', createdAt: 1, content: { md: id } })
  const comment = (id: string, cardId: string, boardId: string, text = id) => ({ id, kind: 'comment', boardId, cardId, authorId: 'x', author: 'x', text, createdAt: 1 })
  const getSeen = async (user: string) => (await (await request('/seen', undefined, user)).json()) as Seen
  const markSeen = (user: string, threads: Record<string, unknown>) => request('/seen', { threads }, user)
  /** Exactly what a device of this person computes: its pull, its read marks. */
  const unread = async (user: string) => {
    const objects = ((await (await request('/sync?since=0', undefined, user)).json()) as { objects: Record<string, unknown>[] }).objects
    const comments = objects.filter((o): o is Comment => o.kind === 'comment' && !o.hidden)
    const threads = new Map<string, Comment[]>()
    for (const c of comments) threads.set(c.cardId, [...(threads.get(c.cardId) ?? []), c])
    return { threads, objects, list: unreadThreads(threads, await getSeen(user), user) }
  }
  // Both start reading from the beginning of time, so every test comment is new.
  const resetBaseline = () => sql.prepare("UPDATE seen SET seen_at=0 WHERE object_id='*'").run()
  return { sql, request, push, card, comment, getSeen, markSeen, unread, resetBaseline }
}

it('counts comments by others since the read mark, never your own, and marking a thread read clears it', async () => {
  const f = await fixture()
  await f.getSeen('rex'); await f.getSeen('fido'); f.resetBaseline()
  expect((await f.push('rex', f.card('ball', 'shared'))).status).toBe(200)
  expect((await f.push('fido', f.comment('c1', 'ball', 'shared', 'arf'))).status).toBe(200)
  expect((await f.push('rex', f.comment('c2', 'ball', 'shared', 'woof'))).status).toBe(200)

  let rex = await f.unread('rex')
  expect(rex.list.map((t) => [t.cardId, t.count, t.latest.text])).toEqual([['ball', 1, 'arf']])
  // fido's thread holds rex's reply, but not his own words.
  expect((await f.unread('fido')).list.map((t) => [t.cardId, t.count, t.latest.text])).toEqual([['ball', 1, 'woof']])

  // The server stamps arrival time; a forged one is ignored.
  expect((await f.push('fido', { ...f.comment('c3', 'ball', 'shared', 'again'), postedAt: 1 })).status).toBe(200)
  rex = await f.unread('rex')
  const c3 = rex.objects.find((o) => o.id === 'c3') as Comment
  expect(c3.postedAt).toBeGreaterThan(1)
  expect(rex.list[0]).toMatchObject({ count: 2, latest: { id: 'c3' } })

  expect((await f.markSeen('rex', { ball: readMark(rex.threads.get('ball')!, 'rex') })).status).toBe(200)
  expect((await f.getSeen('rex')).threads.ball).toBe(c3.postedAt)
  expect((await f.unread('rex')).list).toEqual([])
  // Marks only move forward: an older device can't make a thread unread again.
  await f.markSeen('rex', { ball: 5 })
  expect((await f.getSeen('rex')).threads.ball).toBe(c3.postedAt)
  // Your own reply never makes it unread for you.
  await f.push('rex', f.comment('c4', 'ball', 'shared', 'mine'))
  expect((await f.unread('rex')).list).toEqual([])
})

it('the first visit starts the clock: older comments count as read', async () => {
  const f = await fixture()
  await f.push('rex', f.card('ball', 'shared'))
  await f.push('fido', f.comment('old', 'ball', 'shared'))
  f.sql.prepare("UPDATE objects SET data=json_set(data,'$.postedAt',1000) WHERE id='old'").run()
  const seen = await f.getSeen('rex')
  expect(seen.since).toBeGreaterThan(1000)
  expect((await f.unread('rex')).list).toEqual([])
  // A later visit keeps the original start.
  expect((await f.getSeen('rex')).since).toBe(seen.since)
})

it("validates read marks", async () => {
  const f = await fixture()
  expect((await f.markSeen('rex', [] as unknown as Record<string, unknown>)).status).toBe(400)
  expect((await f.markSeen('rex', { ball: 'yesterday' })).status).toBe(400)
  expect((await f.markSeen('rex', { '*': 1 })).status).toBe(400)
  expect((await f.markSeen('rex', { 'bad id!': 1 })).status).toBe(400)
  expect((await f.markSeen('rex', Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`c${i}`, 1])))).status).toBe(400)
  expect((await f.request('/seen', undefined, 'nobody')).status).toBe(401)
})

it("fido never gets unread state or counts for rex's Inbox, private boards or deleted comments", async () => {
  const f = await fixture()
  await f.getSeen('rex'); await f.getSeen('fido'); f.resetBaseline()
  await f.push('rex', f.card('open', 'shared'), f.card('secret', 'private'), f.card('inbox', 'toybox:rex'))
  // rex talks to himself in private, and posts (then deletes) a slip on the shared board.
  await f.push('rex', f.comment('p1', 'secret', 'private', 'private plans'), f.comment('t1', 'inbox', 'toybox:rex', 'inbox note'), f.comment('slip', 'open', 'shared', 'oops'))
  await f.push('rex', { id: 'slip', deletedAt: 5 })
  // Someone else's comment in rex's Inbox is refused outright.
  expect((await f.push('fido', f.comment('f1', 'inbox', 'toybox:rex'))).status).toBe(403)

  const fido = await f.unread('fido')
  expect(fido.list).toEqual([])
  const leaked = JSON.stringify(fido.objects)
  for (const text of ['private plans', 'inbox note', 'oops']) expect(leaked).not.toContain(text)

  // Marks for cards fido can't read are dropped without a word, and never come back.
  expect((await f.markSeen('fido', { secret: 99, inbox: 99, nowhere: 99, open: 99 })).status).toBe(200)
  expect((await f.getSeen('fido')).threads).toEqual({ open: 99 })
  const rows = f.sql.prepare("SELECT object_id FROM seen WHERE user_id='fido' AND object_id!='*'").all()
  expect(rows).toEqual([{ object_id: 'open' }])

  // Restored, the comment is shared again and counts; deleted, it stops counting.
  await f.push('rex', { id: 'slip', deletedAt: null })
  f.sql.prepare("UPDATE seen SET seen_at=0 WHERE user_id='fido'").run()
  expect((await f.unread('fido')).list.map((t) => [t.cardId, t.count])).toEqual([['open', 1]])

  // Losing access hides the board's marks too.
  f.sql.prepare("UPDATE board_grants SET revoked_at=1 WHERE id='g'").run()
  f.sql.prepare("UPDATE counters SET value=value+1 WHERE name='access_revision'").run()
  expect((await f.getSeen('fido')).threads).toEqual({})
  expect((await f.unread('fido')).list).toEqual([])
  // rex's own comments never count for rex.
  expect((await f.unread('rex')).list).toEqual([])
})
