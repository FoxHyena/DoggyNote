import { Hono } from 'hono'
import type { AppEnv } from './env.ts'

// Push: field patches, merged per top-level field (last write to arrive wins).
// Pull: every object whose seq is above the client's cursor.

export const KINDS = new Set(['board', 'card', 'connection'])
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/
const ID = /^[a-zA-Z0-9_-]{1,64}$/
export const MAX_CHANGES = 200
const MAX_OBJECT_BYTES = 256 * 1024
const PULL_LIMIT = 1000

export type IncomingChange = { id: string; patch: Record<string, unknown> }

/** Validate a push body. Returns the changes or an error string. */
export function parseChanges(body: unknown): IncomingChange[] | string {
  const changes = (body as { changes?: unknown })?.changes
  if (!Array.isArray(changes)) return 'changes must be an array'
  if (changes.length > MAX_CHANGES) return `at most ${MAX_CHANGES} changes per push`
  const out: IncomingChange[] = []
  for (const ch of changes) {
    const { id, patch } = (ch ?? {}) as { id?: unknown; patch?: unknown }
    if (typeof id !== 'string' || !ID.test(id)) return 'bad id'
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return `bad patch for ${id}`
    const keys = Object.keys(patch)
    if (!keys.length || keys.length > 40 || !keys.every((k) => KEY.test(k))) return `bad keys for ${id}`
    const p = patch as Record<string, unknown>
    if ('id' in p && p.id !== id) return `id mismatch for ${id}`
    if ('kind' in p && !KINDS.has(p.kind as string)) return `bad kind for ${id}`
    if (JSON.stringify(p).length > MAX_OBJECT_BYTES) return `object ${id} too large`
    out.push({ id, patch: p })
  }
  return out
}

/**
 * SQL for one change. New objects insert the whole patch; existing ones get
 * json_set per top-level key, which replaces values (unlike json_patch, which
 * deep-merges and would keep stale nested fields).
 */
export function upsertSql(patch: Record<string, unknown>): { sql: string; args: unknown[] } {
  const keys = Object.keys(patch).filter((k) => k !== 'id')
  const sets = keys.map((k, i) => `'$.${k}', json(?${7 + i})`).join(', ')
  const sql = `INSERT INTO objects (id, kind, board_id, data, seq, updated_at, updated_by)
    VALUES (?1, ?2, ?3, ?4, (SELECT value FROM counters WHERE name = 'seq'), ?5, ?6)
    ON CONFLICT(id) DO UPDATE SET
      data = ${keys.length ? `json_set(objects.data, ${sets})` : 'objects.data'},
      board_id = CASE WHEN ?3 IS NULL THEN objects.board_id ELSE ?3 END,
      seq = excluded.seq, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  const args = keys.map((k) => JSON.stringify(patch[k] ?? null))
  return { sql, args }
}

export const sync = new Hono<AppEnv>()

sync.post('/sync', async (c) => {
  const parsed = parseChanges(await c.req.json().catch(() => null))
  if (typeof parsed === 'string') return c.json({ error: parsed }, 400)
  if (!parsed.length) return c.json({ ok: true })
  const db = c.env.DB
  const now = Date.now()
  const user = c.get('user').id
  const stmts: D1PreparedStatement[] = []
  for (const { id, patch } of parsed) {
    const { sql, args } = upsertSql(patch)
    const kind = typeof patch.kind === 'string' ? patch.kind : 'card'
    const boardId = typeof patch.boardId === 'string' ? patch.boardId : null
    stmts.push(db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'seq'"))
    stmts.push(db.prepare(sql).bind(id, kind, boardId, JSON.stringify({ ...patch, id }), now, user, ...args))
  }
  await db.batch(stmts)
  return c.json({ ok: true, count: parsed.length })
})

sync.get('/sync', async (c) => {
  const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0)
  const { results } = await c.env.DB.prepare('SELECT data, seq FROM objects WHERE seq > ?1 ORDER BY seq LIMIT ?2')
    .bind(since, PULL_LIMIT)
    .all<{ data: string; seq: number }>()
  const objects = results.map((r) => JSON.parse(r.data))
  const cursor = results.length ? results[results.length - 1].seq : since
  const epoch = (await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'epoch'").first<{ value: string }>())?.value ?? ''
  return c.json({ objects, cursor, more: results.length === PULL_LIMIT, epoch })
})
