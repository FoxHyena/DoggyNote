import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { loadAccess, type Access } from './access.ts'

// Read marks for comment threads, per person. Unread itself is worked out on
// the device from the comments sync already gave it (packages/core/src/unread.ts),
// so this only stores "read up to" times. Both directions are filtered like a
// sync pull: a mark only exists for a card you can read right now, so nobody
// can store, or get back, anything about cards outside their access.

const BASELINE = '*'
const MAX_MARKS = 500
const ID = /^[a-zA-Z0-9_:-]{1,64}$/

type Row = { object_id: string; seen_at: number; kind: string | null; board_id: string | null; owner_id: string | null }

const readable = (r: Pick<Row, 'kind' | 'board_id' | 'owner_id'>, access: Access, me: string) =>
  r.kind === 'card' && (!r.owner_id || r.owner_id === me) && access.canRead(r.board_id ?? '')

export const seen = new Hono<AppEnv>()

seen.get('/seen', async (c) => {
  c.header('cache-control', 'no-store')
  const db = c.env.DB
  const me = c.get('user').id
  // The first visit starts the clock: comments from before it count as read.
  await db.prepare('INSERT OR IGNORE INTO seen (user_id, object_id, seen_at) VALUES (?1, ?2, ?3)').bind(me, BASELINE, Date.now()).run()
  const [access, { results }] = await Promise.all([
    loadAccess(db, c.get('user')),
    db.prepare('SELECT s.object_id, s.seen_at, o.kind, o.board_id, o.owner_id FROM seen s LEFT JOIN objects o ON o.id = s.object_id WHERE s.user_id = ?1').bind(me).all<Row>(),
  ])
  let since = 0
  const threads: Record<string, number> = {}
  for (const r of results) {
    if (r.object_id === BASELINE) since = r.seen_at
    else if (readable(r, access, me)) threads[r.object_id] = r.seen_at
  }
  return c.json({ since, threads })
})

seen.post('/seen', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { threads?: unknown } | null
  const marks = body?.threads
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) return c.json({ error: 'threads must be an object' }, 400)
  const entries = Object.entries(marks as Record<string, unknown>)
  if (entries.length > MAX_MARKS) return c.json({ error: `at most ${MAX_MARKS} threads at once` }, 400)
  for (const [id, at] of entries) {
    if (!ID.test(id) || id === BASELINE || typeof at !== 'number' || !Number.isFinite(at) || at < 0) return c.json({ error: 'bad read mark' }, 400)
  }
  if (!entries.length) return c.json({ ok: true })
  const db = c.env.DB
  const me = c.get('user').id
  const access = await loadAccess(db, c.get('user'))
  const allowed = new Set<string>()
  for (let i = 0; i < entries.length; i += 90) {
    const chunk = entries.slice(i, i + 90).map(([id]) => id)
    const { results } = await db.prepare(`SELECT id, kind, board_id, owner_id FROM objects WHERE id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')})`).bind(...chunk).all<Row & { id: string }>()
    for (const r of results) if (readable(r, access, me)) allowed.add(r.id)
  }
  // Cards you can't read are skipped without saying so: the answer is the same either way.
  const stmts = entries.filter(([id]) => allowed.has(id)).map(([id, at]) =>
    db.prepare('INSERT INTO seen (user_id, object_id, seen_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, object_id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)').bind(me, id, Math.round(at as number)),
  )
  if (stmts.length) await db.batch(stmts)
  return c.json({ ok: true })
})
