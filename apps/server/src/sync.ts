import { Hono } from 'hono'
import type { AppEnv } from './env.ts'

// Push: field patches, merged per top-level field (last write to arrive wins).
// Pull: every object whose seq is above the client's cursor.

export const KINDS = new Set(['board', 'card', 'connection', 'comment'])
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/
// ':' is for namespaced ids like "toybox:<userId>".
const ID = /^[a-zA-Z0-9_:-]{1,64}$/
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
  const sets = keys.map((k, i) => `'$.${k}', json(?${8 + i})`).join(', ')
  const sql = `INSERT INTO objects (id, kind, board_id, data, seq, updated_at, updated_by, owner_id)
    VALUES (?1, ?2, ?3, ?4, (SELECT value FROM counters WHERE name = 'seq'), ?5, ?6, ?7)
    ON CONFLICT(id) DO UPDATE SET
      data = ${keys.length ? `json_set(objects.data, ${sets})` : 'objects.data'},
      board_id = CASE WHEN ?3 IS NULL THEN objects.board_id ELSE ?3 END,
      owner_id = ?7,
      seq = excluded.seq, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  const args = keys.map((k) => JSON.stringify(patch[k] ?? null))
  return { sql, args }
}

// ---- privacy: personal Toy boxes ----------------------------------------------
// A Toy box is the board "toybox:<userId>". It, and every object on it, is owned
// by that user: other people can't read it (pulls get a `{ id, hidden }` stub so
// their devices drop any copy they had) and can't write to it.

export const TOYBOX_PREFIX = 'toybox:'

/** Owner of an object given its id and the board it will be on, or null if shared. */
export function ownerFor(id: string, boardId: string | null): string | null {
  if (id.startsWith(TOYBOX_PREFIX)) return id.slice(TOYBOX_PREFIX.length)
  if (boardId?.startsWith(TOYBOX_PREFIX)) return boardId.slice(TOYBOX_PREFIX.length)
  return null
}

type Existing = { id: string; kind: string; board_id: string | null; owner_id: string | null; author_id: string | null; deleted_at: number | null; purged: number | null }

// ---- comments ------------------------------------------------------------------
// The author of a comment is whoever is signed in when it's created: the server
// stamps it, so it can't be spoofed. Only the author edits or deletes a message;
// anyone can resolve a thread, and a comment follows its card between boards.
//
// Deleting a message takes it back from everyone at once: while it's deleted it
// belongs to its author alone (others get the same `{ id, hidden }` stub as a
// Toy box, so their devices drop it), it waits in the author's Buried bones in
// case it was a slip, and emptying those wipes the text for good.

const OTHERS_MAY_SET = new Set(['resolvedAt', 'boardId'])

/** Stamps or protects comment authorship in place. Returns an error message to refuse the change. */
export function stampComment(
  patch: Record<string, unknown>,
  prev: Pick<Existing, 'kind' | 'author_id'> | undefined,
  kind: string,
  me: { id: string; username: string },
): string | null {
  if (kind !== 'comment' && prev?.kind !== 'comment') return null
  if (!prev) {
    patch.authorId = me.id
    patch.author = me.username
    return null
  }
  if (prev.kind !== 'comment') return 'bad kind'
  delete patch.authorId
  delete patch.author
  if (patch.purged === true) patch.text = ''
  if (prev.author_id !== me.id && !Object.keys(patch).every((k) => OTHERS_MAY_SET.has(k))) return 'Only the author can change a comment'
  return null
}

/** A deleted (or purged) comment is private to its author; a live one is shared. */
export function deletedCommentOwner(
  kind: string,
  patch: Record<string, unknown>,
  prev: Pick<Existing, 'kind' | 'author_id' | 'deleted_at' | 'purged'> | undefined,
  me: string,
): string | null {
  if (kind !== 'comment') return null
  const deleted = 'deletedAt' in patch ? !!patch.deletedAt : !!prev?.deleted_at
  const purged = 'purged' in patch ? patch.purged === true : !!prev?.purged
  return deleted || purged ? (prev?.author_id ?? me) : null
}

export const sync = new Hono<AppEnv>()

sync.post('/sync', async (c) => {
  const parsed = parseChanges(await c.req.json().catch(() => null))
  if (typeof parsed === 'string') return c.json({ error: parsed }, 400)
  if (!parsed.length) return c.json({ ok: true })
  const db = c.env.DB
  const now = Date.now()
  const me = c.get('user')
  const user = me.id

  // Current board + owner of everything being written, to enforce Toy box privacy.
  const existing = new Map<string, Existing>()
  const ids = parsed.map((p) => p.id)
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    const { results } = await db
      .prepare(
        `SELECT id, kind, board_id, owner_id, json_extract(data, '$.authorId') AS author_id, json_extract(data, '$.deletedAt') AS deleted_at, json_extract(data, '$.purged') AS purged FROM objects WHERE id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')})`,
      )
      .bind(...chunk)
      .all<Existing>()
    for (const r of results) existing.set(r.id, r)
  }

  const stmts: D1PreparedStatement[] = []
  for (const { id, patch } of parsed) {
    const prev = existing.get(id)
    if (prev?.owner_id && prev.owner_id !== user) return c.json({ error: "That's private to someone else" }, 403)
    const kind = typeof patch.kind === 'string' ? patch.kind : (prev?.kind ?? 'card')
    const denied = stampComment(patch, prev, kind, me)
    if (denied) return c.json({ error: denied }, 403)
    const boardId = typeof patch.boardId === 'string' ? patch.boardId : null
    const toybox = ownerFor(id, boardId ?? prev?.board_id ?? null)
    if (toybox && toybox !== user) return c.json({ error: "You can't put things in someone else's Toy box" }, 403)
    const owner = toybox ?? deletedCommentOwner(kind, patch, prev, user)
    const { sql, args } = upsertSql(patch)
    stmts.push(db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'seq'"))
    stmts.push(db.prepare(sql).bind(id, kind, boardId, JSON.stringify({ ...patch, id }), now, user, owner, ...args))
  }
  await db.batch(stmts)
  return c.json({ ok: true, count: parsed.length })
})

sync.get('/sync', async (c) => {
  const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0)
  const me = c.get('user').id
  const { results } = await c.env.DB.prepare('SELECT id, data, seq, owner_id FROM objects WHERE seq > ?1 ORDER BY seq LIMIT ?2')
    .bind(since, PULL_LIMIT)
    .all<{ id: string; data: string; seq: number; owner_id: string | null }>()
  // Someone else's private object: only a stub, so devices that had a copy (it
  // was just moved into a Toy box) delete it. The data never leaves the server.
  const objects = results.map((r) => (r.owner_id && r.owner_id !== me ? { id: r.id, hidden: true } : JSON.parse(r.data)))
  const cursor = results.length ? results[results.length - 1].seq : since
  const epoch = (await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'epoch'").first<{ value: string }>())?.value ?? ''
  return c.json({ objects, cursor, more: results.length === PULL_LIMIT, epoch })
})
