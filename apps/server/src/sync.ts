import { Hono, type Context } from 'hono'
import { stickerObjectSchema, strokeObjectSchema, isReservedId } from '@doggynote/core/agent'
import type { AppEnv } from './env.ts'
import { accessGuard, bumpAccess, loadAccess, newBoardAccess, type Access } from './access.ts'
import { prepareNote } from './notes.ts'
import { checkPositionLocks, dropLockedLayout, positionWriteGuards } from './position.ts'
import { notifyRooms } from './realtime.ts'
import { LABEL_FIELD, isBoardInkSize, isSketchContent, isSketchPaper, isSketchTitle, validLabelField, decodeUpdate, encodeUpdate, normalizeSwatchHex, noteDocument, noteMarkdown, noteState, replaceText, type Card } from '@doggynote/core'
import * as Y from 'yjs'

// Push: field patches, merged per top-level field (last write to arrive wins).
// Pull: every object whose seq is above the client's cursor.

export const KINDS = new Set(['board', 'card', 'connection', 'comment', 'sticker', 'stroke'])
const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/
// ':' is for namespaced ids like "toybox:<userId>".
const ID = /^[a-zA-Z0-9_:-]{1,64}$/
export const MAX_CHANGES = 200
// Each key is one bound SQL parameter (plus 7 fixed); D1 allows 100 per statement.
const MAX_KEYS = 90
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
    if (!keys.length || keys.length > MAX_KEYS || !keys.every((k) => KEY.test(k))) return `bad keys for ${id}`
    const p = patch as Record<string, unknown>
    for (const key of keys) {
      const label = LABEL_FIELD.exec(key)
      if (label && !validLabelField(label[1] === 'label' ? 'card' : 'board', key, p[key])) return `bad label field for ${id}`
    }
    if ('id' in p && p.id !== id) return `id mismatch for ${id}`
    if ('positionLocked' in p && p.positionLocked !== null && typeof p.positionLocked !== 'boolean') return `bad position lock for ${id}`
    if ('kind' in p && !KINDS.has(p.kind as string)) return `bad kind for ${id}`
    if (JSON.stringify({ ...p, noteUpdate: undefined }).length > MAX_OBJECT_BYTES) return `object ${id} too large`
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

type Existing = { data: string; id: string; seq: number; kind: string; board_id: string | null; owner_id: string | null; author_id: string | null; deleted_at: number | null; purged: number | null; note_state: string | null; note_revision: number | null }

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
// Aggregate operational data only: never log bodies, note identifiers or tokens.
sync.use('*', async (c, next) => {
  if (c.req.method !== 'POST') return next()
  const start = Date.now()
  try { await next() } finally {
    console.info(JSON.stringify({ event: 'collaboration_sync', status: c.error ? 500 : c.res.status, durationMs: Date.now() - start }))
  }
})

async function pushSync(c: Context<AppEnv>) {
  const body = await c.req.json().catch(() => null)
  const noteId = c.req.param('noteId')
  let vector: Uint8Array | undefined
  if (noteId && body?.stateVector !== undefined) {
    try { vector = decodeUpdate(body.stateVector); Y.decodeStateVector(vector) } catch { return c.json({ error: 'Invalid state vector' }, 400) }
  }
  let parsed = parseChanges(noteId ? { changes: [{ id: noteId, patch: { noteUpdate: body?.update } }] } : body)
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
        `SELECT o.data, o.id, o.seq, o.kind, o.board_id, o.owner_id, json_extract(o.data, '$.authorId') AS author_id, json_extract(o.data, '$.deletedAt') AS deleted_at, json_extract(o.data, '$.purged') AS purged, n.state AS note_state, n.revision AS note_revision FROM objects o LEFT JOIN note_states n ON n.id=o.id WHERE o.id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')})`,
      )
      .bind(...chunk)
      .all<Existing>()
    for (const r of results) existing.set(r.id, r)
  }

  const access = await loadAccess(db, me)
  const deniedIds = await deniedChanges(db, access, me.id, parsed)
  if (deniedIds.length) return c.json({ error: 'You no longer have permission to change these objects', deniedIds }, 403)
  const positions = await checkPositionLocks(db, parsed)
  // Additive for older apps: never an error. Locked layout is dropped, the rest saved.
  parsed = dropLockedLayout(parsed, positions.lockedIds)
  const stmts: D1PreparedStatement[] = [accessGuard(db, access.revision), ...positionWriteGuards(db, access.revision, positions.versions)]
  const newIds = parsed.filter((ch) => !existing.has(ch.id)).map((ch) => ch.id)
  for (let i = 0; i < newIds.length; i += 90) stmts.push(accessGuard(db, access.revision, newIds.slice(i, i + 90)))
  for (const { id, patch } of parsed) {
    const prev = existing.get(id)
    if ('noteState' in patch) return c.json({ error: 'noteState is server-owned' }, 400)
    if ('noteUpdate' in patch && (typeof patch.noteUpdate !== 'string' || !patch.noteUpdate)) return c.json({ error: 'Invalid note update' }, 400)
    const prospective = { ...(prev ? JSON.parse(prev.data) : {}), ...patch }
    const restoring = patch.noteRestore === true
    if ('noteRestore' in patch && (!restoring || prospective.kind !== 'card' || prospective.type !== 'note' || patch.purged !== false || !patch.noteUpdate || (prev?.deleted_at && patch.deletedAt !== null && patch.deletedAt !== 0))) return c.json({ error: 'Invalid note restoration' }, 400)
    delete patch.noteRestore
    let note: Awaited<ReturnType<typeof prepareNote>> | undefined
    if (prospective.kind === 'card' && prospective.type === 'note' && ('content' in patch || 'noteUpdate' in patch)) {
      if (prev && (prev.deleted_at || prev.purged) && 'noteUpdate' in patch && !restoring) return c.json({ error: 'This note was removed', deniedIds: [id] }, 403)
      if (prev && 'content' in patch && !('noteUpdate' in patch)) return c.json({ error: 'Notes require collaborative updates', deniedIds: [id] }, 403)
      try {
        note = await prepareNote(db, id, noteMarkdown(prospective as Card<'note'>), patch.noteUpdate as string | undefined, prev?.seq ?? 0, prev?.note_state ? { state: prev.note_state, revision: prev.note_revision! } : null)
      } catch { return c.json({ error: 'Invalid or oversized note update' }, 400) }
      delete patch.noteUpdate
      patch.content = { md: note.md }
      stmts.push(note.guard)
    } else if ('noteUpdate' in patch) return c.json({ error: 'Only notes accept text updates' }, 400)
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
    if (note) stmts.push(note.write)
    if (kind === 'board' && !prev && !id.startsWith('toybox:')) stmts.push(newBoardAccess(db, id, user))
    if ((kind === 'board' && (!prev || 'parentId' in patch)) || (prev && boardId && boardId !== prev.board_id) || (kind === 'comment' && ('deletedAt' in patch || 'purged' in patch))) stmts.push(bumpAccess(db))
  }
  try { await db.batch(stmts) } catch (e) {
    if (String(e).includes('Access changed')) return c.json({ error: 'Access changed; refresh and retry' }, 409)
    if (String(e).includes('Note changed')) return c.json({ error: 'Note changed; retry' }, 409)
    throw e
  }
  await notifyRooms(c.env, parsed.flatMap(({ id, patch }) => [String(patch.boardId ?? existing.get(id)?.board_id ?? (patch.kind === 'board' ? id : '')), existing.get(id)?.board_id ?? '']))
  if (noteId) {
    const row = await db.prepare('SELECT state FROM note_states WHERE id=?1').bind(noteId).first<{ state: string }>()
    const document = noteDocument(row?.state)
    try { return c.json({ ok: true, update: encodeUpdate(Y.encodeStateAsUpdate(document, vector)) }) } finally { document.destroy() }
  }
  return c.json({ ok: true, count: parsed.length, ...(positions.lockedIds.length ? { lockedIds: positions.lockedIds } : {}) })
}
sync.post('/sync', pushSync)
sync.post('/notes/:noteId/sync', pushSync)

sync.get('/sync', async (c) => {
  c.header('cache-control', 'no-store')
  const a = await loadAccess(c.env.DB, c.get('user'))
  const reset = c.req.query('accessRevision') !== a.revision
  const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0)
  // The client restarts at zero after observing reset. Keeping the supplied
  // cursor supports pagination while it collects the replacement snapshot.
  const { results } = await c.env.DB.prepare('SELECT o.id, o.kind, o.board_id, o.data, o.seq, o.owner_id, n.state AS note_state FROM objects o LEFT JOIN note_states n ON n.id=o.id WHERE o.seq > ?1 ORDER BY o.seq LIMIT ?2')
    .bind(since, PULL_LIMIT)
    .all<{ id: string; kind: string; board_id: string | null; data: string; seq: number; owner_id: string | null; note_state: string | null }>()
  const legacyNotes = results.filter((r) => !r.note_state && (!r.owner_id || r.owner_id === c.get('user').id) && a.canRead(r.board_id ?? '') && JSON.parse(r.data).type === 'note' && !JSON.parse(r.data).purged)
  for (let i = 0; i < legacyNotes.length; i += 90) {
    const chunk = legacyNotes.slice(i, i + 90)
    await c.env.DB.batch(chunk.map((r) => {
      const document = noteDocument()
      replaceText(document.getText('markdown'), noteMarkdown(JSON.parse(r.data)))
      const state = noteState(document); document.destroy()
      return c.env.DB.prepare('INSERT OR IGNORE INTO note_states(id,state,revision) SELECT ?1,?2,1 WHERE EXISTS(SELECT 1 FROM objects WHERE id=?1 AND seq=?3)').bind(r.id, state, r.seq)
    }))
    const { results: seeded } = await c.env.DB.prepare(`SELECT id,state FROM note_states WHERE id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')})`).bind(...chunk.map((r) => r.id)).all<{ id: string; state: string }>()
    for (const row of chunk) row.note_state = seeded.find((n) => n.id === row.id)?.state ?? null
  }
  const objects: Record<string, unknown>[] = []
  for (const r of results) {
    const readable = (!r.owner_id || r.owner_id === c.get('user').id) && a.canRead(r.kind === 'board' ? r.id : r.board_id ?? '')
    if (readable) {
      const object = JSON.parse(r.data)
      if (object.kind === 'card' && object.type === 'note' && !object.purged) {
        if (r.note_state) object.noteState = r.note_state
      }
      objects.push(object)
      continue
    }
    // Authorized snapshots contain only readable IDs; deltas retain the old
    // privacy stub behavior to evict objects moved between boards.
    if (!reset) objects.push({ id: r.id, hidden: true })
  }
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
    // Label names and colours live on boards, memberships on cards.
    for (const key of Object.keys(patch)) if (LABEL_FIELD.test(key) && !validLabelField(o.kind, key, patch[key])) ok = false
    if (id.startsWith('home:') && (!prev || ('parentId' in patch && (patch.parentId ?? null) !== (prev.data.parentId ?? null)) || patch.deletedAt || patch.purged)) ok = false
    if (id.startsWith('toybox:') && (id !== `toybox:${userId}` || o.kind !== 'board' || o.parentId != null)) ok = false
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
        if (!['note', 'todo', 'board', 'image', 'link', 'column', 'file', 'movie', 'swatch', 'sketch', 'ink'].includes(o.type as string)) ok = false
        // A sketch's paper colour goes straight into CSS on every device: only canonical #RRGGBB.
        if (o.type === 'sketch' && !o.purged && (!isSketchContent(o.content) || (o.sketchPaper != null && !isSketchPaper(o.sketchPaper)) || (o.sketchTitle != null && !isSketchTitle(o.sketchTitle)))) ok = false
        // Only sketches carry a sketch title or paper.
        if (o.type !== 'sketch' && ('sketchTitle' in patch || 'sketchPaper' in patch)) ok = false
        // Ink drawn on the board sits on the board, never in a column.
        if (o.type === 'ink' && !o.purged && (!isBoardInkSize(o.content) || o.columnId != null)) ok = false
        // A colour card's HEX goes straight into CSS on every device: only canonical #RRGGBB.
        if (o.type === 'swatch' && !o.purged) { const hex = (o.content as { hex?: unknown } | undefined)?.hex; if (normalizeSwatchHex(hex) !== hex) ok = false }
        if (o.type === 'column' && o.columnId != null) ok = false
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
      if (o.kind === 'sticker') {
        if (!stickerObjectSchema.safeParse(o).success) ok = false
        const content = o.content as { assetId?: string } | undefined
        if (!o.purged && JSON.stringify(prev?.data.content) !== JSON.stringify(content)) {
          const assetId = content?.assetId
          const source = await db.prepare("SELECT s.value FROM sticker_assets a JOIN sticker_packs p ON p.name=a.pack_name,json_each(p.manifest,'$.stickers') s WHERE a.asset_id=?1 AND a.available=1 AND json_extract(s.value,'$.assetId')=?1 AND json_extract(s.value,'$.available')=1").bind(assetId ?? '').first<{ value: string }>()
          if (!source) ok = false
          else {
            const known = JSON.parse(source.value) as Record<string, unknown>
            if (Object.keys(content ?? {}).some((key) => JSON.stringify(known[key]) !== JSON.stringify((content as Record<string, unknown>)[key]))) ok = false
            const member = await db.prepare('SELECT 1 FROM sticker_memberships WHERE user_id=?1 AND pack_name=?2').bind(userId, String(known.packName).toLowerCase()).first()
            if (!member) {
              const { results: refs } = await db.prepare("SELECT board_id,owner_id FROM objects WHERE kind='sticker' AND json_extract(data,'$.content.assetId')=?1 AND COALESCE(json_extract(data,'$.purged'),0)=0").bind(assetId).all<{ board_id: string; owner_id: string | null }>()
              if (!refs.some((r) => (!r.owner_id || r.owner_id === userId) && readable(r.board_id))) ok = false
            }
          }
        }
      }
      if (o.kind === 'stroke') {
        // Its geometry is drawn as SVG and canvas paths on every device.
        if (!o.purged && !strokeObjectSchema.safeParse(o).success) ok = false
        // Ink belongs to a sketch or board ink card on the same board.
        if (prev && o.cardId !== prev.data.cardId) ok = false
        if (!prev || 'boardId' in patch) {
          const card = next.get(o.cardId as string)
          if (card?.kind !== 'card' || (card.type !== 'sketch' && card.type !== 'ink') || card.boardId !== board || (!prev && (card.deletedAt || card.purged))) ok = false
        }
      }
      if (o.kind === 'comment') {
        const card = next.get(o.cardId as string)
        if (card?.kind !== 'card' || card.boardId !== board || (!prev && (card.deletedAt || card.purged))) ok = false
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
