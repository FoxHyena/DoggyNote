import { SYNC_GROUP_LIMIT, decodeUpdate, holdsAll, isLiveSynced, mergeNoteStates, noteDocument, noteState, syncIdOf } from '@doggynote/core'
import * as Y from 'yjs'
import type { Access } from './access.ts'
import type { IncomingChange } from './sync.ts'

// Synced notes (packages/core/src/synced.ts). The server is the only place a
// copy joins a group or receives another copy's text:
//
// - Joining needs `syncJoin: true`, and edit access to every copy already in
//   the group. Without the flag a `syncId` is dropped, so older apps (which
//   copy every field) make independent copies.
// - A Toy box never holds a synced note (rule 10). Joining from or into one is
//   refused; moving a synced note into a Toy box unsyncs it in the same write.
// - When a copy's text changes, or it joins or comes back from Buried bones,
//   every live copy is written with the merged state in the same batch. Those
//   writes go through the normal note path, so their guards, seq and room
//   notifications are the usual ones.
// - Editing rights: if the writer can't edit every live copy, nothing is
//   written to the others. The writer's own copy leaves the group in that same
//   write (it keeps their edit), and the response lists it in `detachedIds`.
// - Agent proposals go through the same merge (`agentFanOut`).

const ID = /^[a-zA-Z0-9_:-]{1,64}$/

export type SyncRow = { id: string; data: string; seq: number; board_id: string | null; owner_id: string | null; deleted_at: number | null; purged: number | null; note_state: string | null; note_revision: number | null; kind: string; author_id: string | null }
type Member = { id: string; seq: number; board_id: string | null; owner_id: string | null; data: string; state: string | null; revision: number | null }

export type SyncPlan = { error?: string; deniedIds?: string[]; extra: IncomingChange[]; extraRows: SyncRow[]; fanned: Set<string>; detached: string[] }

async function members(db: D1Database, syncId: string): Promise<Member[]> {
  const { results } = await db.prepare(`SELECT o.id, o.seq, o.board_id, o.owner_id, o.data, n.state, n.revision FROM objects o LEFT JOIN note_states n ON n.id=o.id WHERE json_extract(o.data,'$.syncId')=?1 AND o.kind='card' AND COALESCE(json_extract(o.data,'$.purged'),0)=0 LIMIT ${SYNC_GROUP_LIMIT * 4}`).bind(syncId).all<Member>()
  return results
}

/** Validates sync fields in place and plans the fan-out. */
export async function planSyncedNotes(db: D1Database, access: Access, changes: IncomingChange[], existing: Map<string, SyncRow>): Promise<SyncPlan> {
  const plan: SyncPlan = { extra: [], extraRows: [], fanned: new Set(), detached: [] }
  const prospective = new Map<string, Record<string, unknown>>()
  const joins = new Map<string, string[]>()
  const touched = new Set<string>()
  for (const { id, patch } of changes) {
    const prev = existing.get(id)
    const before = prev ? JSON.parse(prev.data) as Record<string, unknown> : undefined
    const joining = patch.syncJoin === true
    delete patch.syncJoin
    if ('syncId' in patch && patch.syncId !== null && (typeof patch.syncId !== 'string' || !ID.test(patch.syncId))) return { ...plan, error: `bad syncId for ${id}` }
    const was = syncIdOf(before as never)
    // Only an explicit join may set or change a group.
    if ('syncId' in patch && patch.syncId !== null && patch.syncId !== was && !joining) patch.syncId = was
    const o: Record<string, unknown> = { ...before, ...patch, id }
    const sync = typeof o.syncId === 'string' ? o.syncId : null
    if (sync) {
      const owned = !!prev?.owner_id || String(o.boardId ?? '').startsWith('toybox:') || id.startsWith('toybox:')
      const note = o.kind === 'card' && o.type === 'note'
      if (!note || owned) {
        // A deliberate join gets a clear refusal; a move into a Toy box just unsyncs.
        if (joining && sync !== was) return { ...plan, error: "Synced notes can't go in a Toy box", deniedIds: [id] }
        patch.syncId = null
        o.syncId = null
      }
    }
    prospective.set(id, o)
    const now = syncIdOf(o as never)
    if (!now) continue
    // Checked even for a buried copy: it could be restored later.
    const joined = now !== was
    if (joined) { joins.set(now, [...(joins.get(now) ?? []), id]); touched.add(now) }
    if (!isLiveSynced(o as never)) continue
    const revived = (!!before?.deletedAt && 'deletedAt' in patch) || (!!before?.purged && patch.purged === false)
    if (joined || revived || 'noteUpdate' in patch || 'content' in patch) touched.add(now)
  }
  if (!touched.size) return plan
  const batchIds = new Set(changes.map((c) => c.id))
  for (const group of touched) {
    const others = (await members(db, group)).filter((m) => !batchIds.has(m.id))
    if (joins.has(group)) {
      // Joining shares this group's text with you and yours with it: you need
      // to be able to edit every copy, and none may be private.
      const refused = others.some((m) => m.owner_id || !access.canEdit(m.board_id ?? ''))
      const inBatch = [...prospective.values()].filter((o) => syncIdOf(o as never) === group && isLiveSynced(o as never)).length
      const live = others.filter((m) => isLiveSynced(JSON.parse(m.data))).length
      if (refused || live + inBatch > SYNC_GROUP_LIMIT) return { ...plan, error: refused ? "You can't sync with a copy you can't edit" : 'That note has too many synced copies', deniedIds: joins.get(group) }
    }
    const live = others.filter((m) => !m.owner_id && isLiveSynced(JSON.parse(m.data)))
    const inGroup = changes.filter((c) => syncIdOf(prospective.get(c.id) as never) === group && isLiveSynced(prospective.get(c.id) as never))
    if (live.some((m) => !access.canEdit(m.board_id ?? ''))) {
      // You can't edit every copy: yours stops syncing and keeps your edit.
      for (const c of inGroup) { c.patch.syncId = null; plan.detached.push(c.id) }
      continue
    }
    // This batch's copies: their stored state plus what this push adds.
    const local = changes.filter((c) => syncIdOf(prospective.get(c.id) as never) === group && isLiveSynced(prospective.get(c.id) as never)).map((c) => {
      const prev = existing.get(c.id)
      if (!c.patch.noteUpdate) return prev?.note_state ?? null
      const doc = noteDocument(prev?.note_state ?? undefined)
      try { Y.applyUpdate(doc, decodeUpdate(String(c.patch.noteUpdate))); return noteState(doc) } catch { return null } finally { doc.destroy() }
    })
    const merged = mergeNoteStates([...local, ...live.map((m) => m.state)])
    for (const c of changes) {
      if (syncIdOf(prospective.get(c.id) as never) !== group || !isLiveSynced(prospective.get(c.id) as never)) continue
      if (!c.patch.noteUpdate && holdsAll(existing.get(c.id)?.note_state, merged.state)) continue
      c.patch.noteUpdate = merged.state
      plan.fanned.add(c.id)
    }
    for (const m of live) {
      if (holdsAll(m.state, merged.state)) continue
      plan.extra.push({ id: m.id, patch: { noteUpdate: merged.state } })
      plan.fanned.add(m.id)
    }
  }
  if (plan.extra.length) {
    const ids = plan.extra.map((c) => c.id)
    const { results } = await db.prepare(`SELECT o.data, o.id, o.seq, o.kind, o.board_id, o.owner_id, json_extract(o.data, '$.authorId') AS author_id, json_extract(o.data, '$.deletedAt') AS deleted_at, json_extract(o.data, '$.purged') AS purged, n.state AS note_state, n.revision AS note_revision FROM objects o LEFT JOIN note_states n ON n.id=o.id WHERE o.id IN (${ids.map((_, j) => `?${j + 1}`).join(',')})`).bind(...ids).all<SyncRow>()
    plan.extraRows = results
  }
  return plan
}

/**
 * The same merge for an approved agent proposal that edits note `o` (mutated in
 * place: its syncId may be cleared, its text becomes the merged text). Returns
 * the statements that write the other copies, gated like the proposal's own.
 */
export async function agentFanOut(db: D1Database, access: Access, o: Record<string, unknown>, state: string, exclude: Set<string>, opts: { gate: string; gateId: string; now: number; userId: string }) {
  const group = syncIdOf(o as never)
  if (!group) return null
  if (String(o.boardId ?? '').startsWith('toybox:')) { o.syncId = null; return null }
  if (!isLiveSynced(o as never)) return null
  const live = (await members(db, group)).filter((m) => !exclude.has(m.id) && !m.owner_id && isLiveSynced(JSON.parse(m.data)))
  if (live.some((m) => !access.canEdit(m.board_id ?? ''))) { o.syncId = null; return { detached: true, state, md: null, stmts: [], boards: [] } }
  const merged = mergeNoteStates([state, ...live.map((m) => m.state)])
  const stmts: D1PreparedStatement[] = [], boards: string[] = []
  for (const m of live) {
    if (holdsAll(m.state, merged.state)) continue
    boards.push(m.board_id ?? '')
    stmts.push(
      db.prepare(`INSERT OR REPLACE INTO note_write_guard(id,revision,object_seq) SELECT ?2,?3,?4 WHERE ${opts.gate}`).bind(opts.gateId, m.id, m.revision ?? 0, m.seq),
      db.prepare(`UPDATE counters SET value=value+1 WHERE name='seq' AND ${opts.gate}`).bind(opts.gateId),
      db.prepare(`UPDATE objects SET data=json_set(data,'$.content.md',?2), seq=(SELECT value FROM counters WHERE name='seq'), updated_at=?3, updated_by=?4 WHERE id=?5 AND ${opts.gate}`).bind(opts.gateId, merged.md, opts.now, opts.userId, m.id),
      db.prepare(`INSERT INTO note_states(id,state,revision) SELECT ?2,?3,?4 WHERE ${opts.gate} ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision`).bind(opts.gateId, m.id, merged.state, (m.revision ?? 0) + 1),
    )
  }
  return { detached: false, state: merged.state, md: merged.md, stmts, boards }
}
