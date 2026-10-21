import { checkPositionLocks, positionWriteGuards } from './position.ts'
import { validSwatchFields } from '@doggynote/core'
import { Hono } from 'hono'
import { LABEL_FIELD, validLabelField } from '@doggynote/core'
import { isSketchContent } from '@doggynote/core'
import { isReservedId } from '@doggynote/core/agent'
import { isInkMark } from '@doggynote/core'
import type { AppEnv } from './env.ts'
import { accessGuard, bumpAccess, loadAccess, newBoardAccess, type Access } from './access.ts'
import { noteRevisionGuard, prepareSyncedNotes, syncedNoteCapabilities } from './synced-notes.ts'

// Push: field patches, merged per top-level field (last write to arrive wins).
// Pull: every object whose seq is above the client's cursor.

export const KINDS = new Set(['board', 'card', 'connection', 'comment', 'stroke'])
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
  const seen = new Set<string>()
  for (const ch of changes) {
    const { id, patch } = (ch ?? {}) as { id?: unknown; patch?: unknown }
    if (typeof id !== 'string' || !ID.test(id) || isReservedId(id)) return 'bad id'
    if (seen.has(id)) return 'duplicate object id'
    seen.add(id)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return `bad patch for ${id}`
    const keys = Object.keys(patch)
    if (!keys.length || keys.length > 256 || !keys.every((k) => KEY.test(k) || LABEL_FIELD.test(k))) return `bad keys for ${id}`
    const p = patch as Record<string, unknown>
    for (const [key, value] of Object.entries(p)) {
      if (key.startsWith('label') && !validLabelField(key.startsWith('labelName') || key.startsWith('labelColor') ? 'board' : 'card', key, value)) return `bad label field for ${id}`
    }
    if ('id' in p && p.id !== id) return `id mismatch for ${id}`
    if ('positionLocked' in p && p.positionLocked !== null && typeof p.positionLocked !== 'boolean') return `bad position lock for ${id}`
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
  // One bound patch keeps dense label catalogues below D1's parameter budget.
  let data = 'objects.data'
  for (let start = 0; start < keys.length; start += 32) {
    const sets = keys.slice(start, start + 32).map((k) => `'$.${k}', json(?8 -> '$.${k}')`).join(', ')
    data = `json_set(${data}, ${sets})`
  }
  const sql = `INSERT INTO objects (id, kind, board_id, data, seq, updated_at, updated_by, owner_id)
    VALUES (?1, ?2, ?3, ?4, (SELECT value FROM counters WHERE name = 'seq'), ?5, ?6, ?7)
    ON CONFLICT(id) DO UPDATE SET
      data = ${data},
      board_id = CASE WHEN ?3 IS NULL THEN objects.board_id ELSE ?3 END,
      owner_id = ?7,
      seq = excluded.seq, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  const args = keys.length ? [JSON.stringify(Object.fromEntries(keys.map((key) => [key, patch[key] ?? null])))] : []
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

type Existing = { data: string; id: string; kind: string; board_id: string | null; owner_id: string | null; author_id: string | null; deleted_at: number | null; purged: number | null }

// ---- comments ------------------------------------------------------------------
// The author of a comment is whoever is signed in when it's created: the server
// stamps it, so it can't be spoofed. Only the author edits or deletes a message;
// anyone can resolve a thread, and a comment follows its card between boards.
//
// Deleting a message takes it back from everyone at once: while it's deleted it
// belongs to its author alone (others get the same `{ id, hidden }` stub as a
// Toy box, so their devices drop it), it waits in the author's Buried bones in
// case it was a slip, and emptying those wipes the text for good.

const OTHERS_MAY_SET = new Set(['id', 'resolvedAt', 'boardId'])

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
  let parsed = parseChanges(await c.req.json().catch(() => null))
  if (typeof parsed === 'string') return c.json({ error: parsed }, 400)
  if (!parsed.length) return c.json({ ok: true })
  const db = c.env.DB
  const now = Date.now()
  const me = c.get('user')
  const user = me.id
  const access = await loadAccess(db, me)
  const shared = await prepareSyncedNotes(db, access, user, parsed)
  if (shared.deniedIds.length) return c.json({ error: 'This synced body cannot be changed with your current access. Unlink this instance to edit independently.', deniedIds: shared.deniedIds }, 403)
  parsed = shared.changes

  // Current board + owner of everything being written, to enforce Toy box privacy.
  const existing = new Map<string, Existing>()
  const ids = parsed.map((p) => p.id)
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    const { results } = await db
      .prepare(
        `SELECT data, id, kind, board_id, owner_id, json_extract(data, '$.authorId') AS author_id, json_extract(data, '$.deletedAt') AS deleted_at, json_extract(data, '$.purged') AS purged FROM objects WHERE id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')})`,
      )
      .bind(...chunk)
      .all<Existing>()
    for (const r of results) existing.set(r.id, r)
  }

  const deniedIds = await deniedChanges(db, access, me.id, parsed)
  if (deniedIds.length) return c.json({ error: 'You no longer have permission to change these objects', deniedIds }, 403)
  const positions = await checkPositionLocks(db, parsed)
  if (positions.lockedIds.length) return c.json({ error: 'Locked positions stayed in place. Unlock before moving them.', lockedIds: positions.lockedIds, objects: positions.objects }, 409)
  const stmts: D1PreparedStatement[] = [accessGuard(db, access.revision), noteRevisionGuard(db, access.revision, shared.revision), ...positionWriteGuards(db, access.revision, positions.versions)]
  const newIds = parsed.filter((ch) => !existing.has(ch.id)).map((ch) => ch.id)
  for (let i = 0; i < newIds.length; i += 90) stmts.push(accessGuard(db, access.revision, newIds.slice(i, i + 90)))
  for (const { id, patch } of parsed) {
    const prev = existing.get(id)
    if (prev?.owner_id && prev.owner_id !== user) return c.json({ error: "That's private to someone else" }, 403)
    const kind = typeof patch.kind === 'string' ? patch.kind : (prev?.kind ?? 'card')
    const denied = stampComment(patch, prev, kind, me)
    if (denied) return c.json({ error: denied, deniedIds: [id] }, 403)
    const boardId = typeof patch.boardId === 'string' ? patch.boardId : null
    const toybox = ownerFor(id, boardId ?? prev?.board_id ?? null)
    if (toybox && toybox !== user) return c.json({ error: "You can't put things in someone else's Inbox" }, 403)
    const owner = toybox ?? deletedCommentOwner(kind, patch, prev, user)
    const { sql, args } = upsertSql(patch)
    stmts.push(db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'seq'"))
    stmts.push(db.prepare(sql).bind(id, kind, boardId, JSON.stringify({ ...patch, id }), now, user, owner, ...args))
    // Old clients know nothing about strokes. Always propagate parent moves/purge
    // inside this same transaction, including marks inserted since our read.
    if (kind === 'card' && (boardId || patch.purged === true)) {
      stmts.push(...strokeLifecycleStatements(db, id, boardId ?? prev?.board_id ?? '', patch.purged === true, now, user))
    }
    if (kind === 'board' && !prev && !id.startsWith('toybox:')) stmts.push(newBoardAccess(db, id, user))
    if ((kind === 'board' && (!prev || 'parentId' in patch)) || (prev && boardId && boardId !== prev.board_id) || 'noteGroupId' in patch || (!!JSON.parse(prev?.data ?? '{}').noteGroupId && 'purged' in patch) || (kind === 'comment' && ('deletedAt' in patch || 'purged' in patch))) stmts.push(bumpAccess(db))
  }
  try { await db.batch(stmts) } catch (e) {
    if (String(e).includes('Access changed')) return c.json({ error: 'Access changed; refresh and retry' }, 409)
    throw e
  }
  return c.json({ ok: true, count: parsed.length })
})

sync.get('/sync', async (c) => {
  c.header('cache-control', 'no-store')
  const a = await loadAccess(c.env.DB, c.get('user'))
  const capabilities = await syncedNoteCapabilities(c.env.DB, a, c.get('user').id)
  const reset = c.req.query('accessRevision') !== a.revision
  const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0)
  // The client restarts at zero after observing reset. Keeping the supplied
  // cursor supports pagination while it collects the replacement snapshot.
  const { results } = await c.env.DB.prepare('SELECT id, kind, board_id, data, seq, owner_id FROM objects WHERE seq > ?1 ORDER BY seq LIMIT ?2')
    .bind(since, PULL_LIMIT)
    .all<{ id: string; kind: string; board_id: string | null; data: string; seq: number; owner_id: string | null }>()
  const objects = results.flatMap((r) => {
    const readable = (!r.owner_id || r.owner_id === c.get('user').id) && a.canRead(r.kind === 'board' ? r.id : r.board_id ?? '')
    if (readable) {
      const object = JSON.parse(r.data)
      delete object.noteBodyReadOnly
      if (capabilities.has(r.id)) object.noteBodyReadOnly = capabilities.get(r.id)
      return [object]
    }
    // Authorized snapshots contain only readable IDs; deltas retain the old
    // privacy stub behavior to evict objects moved between boards.
    return reset ? [] : [{ id: r.id, hidden: true }]
  })
  const cursor = results.length ? results[results.length - 1].seq : since
  const epoch = (await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'epoch'").first<{ value: string }>())?.value ?? ''
  return c.json({ objects, cursor, more: results.length === PULL_LIMIT, epoch, accessRevision: a.revision, reset })
})

/** Shared by sync and agent proposals; checks the entire prospective batch. */
export async function deniedChanges(db: D1Database, access: Access, userId: string, changes: IncomingChange[]): Promise<string[]> {
  const old = new Map<string, { data: Record<string, unknown>; owner: string | null }>()
  const load = async (ids: string[]) => {
    const missing = [...new Set(ids)].filter((id) => !old.has(id))
    for (let i = 0; i < missing.length; i += 90) {
      const chunk = missing.slice(i, i + 90)
      const { results } = await db.prepare(`SELECT id,data,owner_id FROM objects WHERE id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')})`).bind(...chunk).all<{ id: string; data: string; owner_id: string | null }>()
      for (const row of results) old.set(row.id, { data: JSON.parse(row.data) as Record<string, unknown>, owner: row.owner_id })
    }
  }
  await load(changes.map((c) => c.id))
  const references: string[] = []
  for (const c of changes) {
    const o = { ...old.get(c.id)?.data, ...c.patch }
    for (const ref of [o.boardId, o.parentId, o.columnId, o.cardId, o.from, o.to, (o.content as { boardId?: string } | undefined)?.boardId]) if (typeof ref === 'string') references.push(ref)
  }
  await load(references)
  const next = new Map<string, Record<string, unknown>>([...access.boards.values()].map((b) => [b.id, { id: b.id, kind: 'board', parentId: b.parentId }]))
  for (const [id, r] of old) next.set(id, r.data)
  for (const { id, patch } of changes) next.set(id, { ...next.get(id), ...patch, id })
  const createdBoards = new Set(changes.filter((c) => !old.has(c.id) && c.patch.kind === 'board').map((c) => c.id))
  const editable = (id: string) => createdBoards.has(id) || access.canEdit(id)
  const readable = (id: string) => createdBoards.has(id) || access.canRead(id)
  const denied: string[] = []
  for (const { id, patch } of changes) {
    const prev = old.get(id)
    const o = next.get(id)!
    let ok = !prev?.owner || prev.owner === userId
    if (prev && o.kind !== prev.data.kind) ok = false
    if (!prev && !KINDS.has(o.kind as string)) ok = false
    if ('ownerId' in patch || 'owner_id' in patch || 'legacy' in patch) ok = false
    if (id.startsWith('home:') && (!prev || ('parentId' in patch && (patch.parentId ?? null) !== (prev.data.parentId ?? null)) || patch.deletedAt || patch.purged)) ok = false
    if (id.startsWith('toybox:') && (id !== `toybox:${userId}` || o.kind !== 'board' || o.parentId != null)) ok = false
    for (const [key, value] of Object.entries(patch)) if (LABEL_FIELD.test(key) && !validLabelField(o.kind, key, value)) ok = false
    if (o.kind === 'board') {
      if (prev && !access.canEdit(id)) ok = false
      if (prev && 'parentId' in patch && (patch.parentId ?? null) !== (prev.data.parentId ?? null) && !access.canManage(id)) ok = false
      const parent = o.parentId ?? null
      if ((!prev || ('parentId' in patch && (patch.parentId ?? null) !== (prev.data.parentId ?? null))) && parent !== null && (typeof parent !== 'string' || next.get(parent)?.kind !== 'board' || !editable(parent))) ok = false
      const seen = new Set([id])
      let p: unknown = parent
      while (typeof p === 'string') {
        if (seen.has(p)) { ok = false; break }
        seen.add(p)
        p = next.get(p)?.parentId
      }
    } else {
      const board = o.boardId
      if (typeof board !== 'string' || next.get(board)?.kind !== 'board' || !editable(board)) ok = false
      if (prev && (typeof prev.data.boardId !== 'string' || !editable(prev.data.boardId))) ok = false
      if (o.kind === 'card') {
        const metadata = next.get(board as string)
        for (const [key, value] of Object.entries(patch)) {
          if (/^label[a-f0-9]{32}$/.test(key) && value === true && !validLabelField('board', `labelName${key.slice(5)}`, metadata?.[`labelName${key.slice(5)}`])) ok = false
          if (/^label[a-f0-9]{32}$/.test(key) && value === true && !metadata?.[`labelName${key.slice(5)}`]) ok = false
        }
        if (!['note', 'todo', 'board', 'image', 'link', 'column', 'file', 'movie', 'swatch', 'sketch', 'ink'].includes(o.type as string)) ok = false
        if (o.type === 'swatch' && !o.purged && !validSwatchFields(o)) ok = false
        if (o.type === 'sketch' && !o.purged && !isSketchContent(o.content)) ok = false
        if ((o.type === 'column' || o.type === 'ink') && o.columnId != null) ok = false
        if (o.type === 'ink' && !o.purged) {
          const logical = o.content as { width?: unknown; height?: unknown } | undefined
          const dimension = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max
          if (!dimension(logical?.width, 8322) || !dimension(logical?.height, 8322) ||
            !dimension(o.w, 10_000) || !dimension(o.h, 100_000) ||
            typeof o.x !== 'number' || !Number.isFinite(o.x) || Math.abs(o.x) > 1_000_000 ||
            typeof o.y !== 'number' || !Number.isFinite(o.y) || Math.abs(o.y) > 1_000_000) ok = false
        }
        if (o.columnId) {
          const col = next.get(o.columnId as string)
          if (col?.kind !== 'card' || col.type !== 'column' || col.boardId !== board || col.id === id) ok = false
        }
        if (o.type === 'board') {
          const target = (o.content as { boardId?: string } | undefined)?.boardId
          if (!target || next.get(target)?.kind !== 'board' || !readable(target)) ok = false
        }
        // Any card that names an asset (images, files, movie posters) grants reading it.
        if (!o.purged) {
          const assetId = (o.content as { assetId?: string } | undefined)?.assetId
          // A card reference must not be usable to steal somebody else's asset.
          if (assetId && (prev?.data.content as { assetId?: string } | undefined)?.assetId !== assetId) {
            const uploader = await db.prepare('SELECT created_by FROM assets WHERE id=?1 ORDER BY created_at,size LIMIT 1').bind(assetId).first<{ created_by: string }>()
            if (uploader && uploader.created_by !== userId) {
              const { results: refs } = await db.prepare("SELECT board_id,owner_id FROM objects WHERE kind='card' AND json_extract(data,'$.content.assetId')=?1 AND COALESCE(json_extract(data,'$.purged'),0)=0").bind(assetId).all<{ board_id: string; owner_id: string | null }>()
              if (!refs.some((r) => (!r.owner_id || r.owner_id === userId) && readable(r.board_id))) ok = false
            }
          }
        }
      }
      if (o.kind === 'comment') {
        const card = next.get(o.cardId as string)
        if (card?.kind !== 'card' || card.boardId !== board || (!prev && (card.deletedAt || card.purged))) ok = false
      }
      if (o.kind === 'stroke') {
        const card = next.get(o.cardId as string)
        const purgingWithOwner = card?.purged === true && o.purged === true
        const removingWithOwner = !!card?.deletedAt && !!o.deletedAt && !card.purged
        if (card?.kind !== 'card' || !['image', 'sketch', 'ink'].includes(card.type as string) || card.boardId !== board || ((card.purged || card.deletedAt) && !purgingWithOwner && !removingWithOwner) || !isInkMark(o as unknown)) ok = false
        // A stroke's identity cannot be reassigned to another image to leak or
        // overwrite its history. Copy operations create a fresh identity.
        if (prev && o.cardId !== prev.data.cardId) ok = false
        const image = card?.content as { width?: number; height?: number } | undefined
        if (!image || !Number.isFinite(image.width) || !Number.isFinite(image.height) || !Array.isArray(o.points) ||
          !(o.points as { x: number; y: number }[]).every((p) => p.x <= image.width! && p.y <= image.height!)) ok = false
      }
      if (o.kind === 'connection' && !o.purged && !o.deletedAt) {
        for (const endpoint of [o.from, o.to]) {
          const card = next.get(endpoint as string)
          if (card?.kind !== 'card' || card.boardId !== board || card.deletedAt || card.purged) ok = false
        }
      }
    }
    if (!ok) denied.push(id)
  }
  return denied
}

/** Unique sequence values keep pagination correct even on very dense images. */
export function strokeLifecycleStatements(db: D1Database, cardId: string, boardId: string, purge: boolean, now: number, userId: string): D1PreparedStatement[] {
  const where = "kind='stroke' AND json_extract(data,'$.cardId')=?1 AND (board_id<>?2 OR (?3=1 AND COALESCE(json_extract(data,'$.purged'),0)=0))"
  const owner = ownerFor(cardId, boardId)
  return [
    db.prepare(`UPDATE counters SET value=value+(SELECT COUNT(*) FROM objects WHERE ${where}) WHERE name='seq'`).bind(cardId, boardId, purge ? 1 : 0),
    db.prepare(`WITH affected AS MATERIALIZED (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM objects WHERE ${where})
      UPDATE objects SET board_id=?2, owner_id=?4, data=CASE WHEN ?3=1 THEN json_set(data,'$.boardId',?2,'$.purged',json('true')) ELSE json_set(data,'$.boardId',?2) END,
      seq=(SELECT value FROM counters WHERE name='seq')-(SELECT COUNT(*) FROM affected)+(SELECT n FROM affected WHERE affected.id=objects.id), updated_at=?5, updated_by=?6
      WHERE id IN (SELECT id FROM affected)`).bind(cardId, boardId, purge ? 1 : 0, owner, now, userId),
  ]
}
