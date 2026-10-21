import type { Access } from './access.ts'
import type { IncomingChange } from './sync.ts'

type Note = { id: string; kind: string; type?: string; boardId?: string; noteGroupId?: unknown; content?: { md?: unknown }; purged?: boolean }
type Row = { data: string; seq: number; owner_id: string | null }
const group = (o: Note | undefined): string | null => o?.kind === 'card' && o.type === 'note' && typeof o.noteGroupId === 'string' ? o.noteGroupId : null
const validId = /^[a-zA-Z0-9_:-]{1,64}$/

/** Materialized bodies keep existing search, exports, viewers and old clients compatible. */
export async function prepareSyncedNotes(db: D1Database, access: Access, userId: string, incoming: IncomingChange[]) {
  // Read the revision before membership. The batch guard rejects a racing link,
  // unlink, move, body write or purge rather than splitting a shared body.
  const revision = (await db.prepare("SELECT value FROM counters WHERE name='seq'").first<{ value: number }>())?.value ?? 0
  const { results } = await db.prepare("SELECT data,seq,owner_id FROM objects WHERE kind='card' AND json_extract(data,'$.type')='note'").all<Row>()
  const old = new Map(results.map((r) => { const o = JSON.parse(r.data) as Note; return [o.id, { object: o, seq: r.seq, owner: r.owner_id }] }))
  const next = new Map([...old].map(([id, r]) => [id, r.object]))
  const changes = new Map(incoming.map((ch) => [ch.id, { id: ch.id, patch: { ...ch.patch } }]))
  const denied = new Set<string>()
  const writable = (id: string) => {
    const row = old.get(id)
    return !!row && (!row.owner || row.owner === userId) && access.canEdit(row.object.boardId ?? '')
  }
  const originalGroups = new Map<string, string[]>()
  const canonicalBodies = new Map<string, { seq: number; md: unknown }>()
  for (const [id, r] of old) {
    const g = group(r.object)
    if (g && !r.object.purged) {
      const members = originalGroups.get(g)
      if (members) members.push(id)
      else originalGroups.set(g, [id])
      if ((canonicalBodies.get(g)?.seq ?? -1) < r.seq) canonicalBodies.set(g, { seq: r.seq, md: r.object.content?.md })
    }
  }
  for (const ch of changes.values()) {
    // Capabilities are computed on reads, never persisted or trusted from clients.
    delete ch.patch.noteBodyReadOnly
    if ('noteBodyEdit' in ch.patch) {
      const edit = ch.patch.noteBodyEdit as { groupId?: unknown; md?: unknown } | null
      const prev = old.get(ch.id)?.object
      if (!edit || typeof edit.groupId !== 'string' || typeof edit.md !== 'string' || (group(prev) !== edit.groupId && ch.patch.noteGroupId !== edit.groupId) || prev?.purged || ('noteGroupId' in ch.patch && ch.patch.noteGroupId !== edit.groupId)) denied.add(ch.id)
      else ch.patch.content = { md: edit.md }
      delete ch.patch.noteBodyEdit
    }
    const o = { ...old.get(ch.id)?.object, ...ch.patch, id: ch.id } as Note
    if (o.noteGroupId != null && (o.kind !== 'card' || o.type !== 'note' || typeof o.noteGroupId !== 'string' || !validId.test(o.noteGroupId))) denied.add(ch.id)
    if (o.kind === 'card' && o.type === 'note') next.set(ch.id, o)
  }
  // A relink without a body write makes the existing source authoritative.
  // In particular, Redo must not revive a purged copy's stale creation text.
  const relinkBodies = new Map<string, string>()
  for (const ch of changes.values()) {
    const prev = old.get(ch.id)?.object, g = group(next.get(ch.id))
    if (g && prev && !prev.purged && group(prev) !== g && !('content' in ch.patch) && typeof prev.content?.md === 'string') {
      const prior = relinkBodies.get(g)
      if (prior !== undefined && prior !== prev.content.md) denied.add(ch.id)
      else relinkBodies.set(g, prev.content.md)
    }
  }
  const updates = new Map<string, { md: string; sources: string[] }>()
  for (const ch of changes.values()) {
    const prev = old.get(ch.id)?.object, o = next.get(ch.id)
    const g = group(o)
    if (!g || !o || o.purged) continue
    const attaching = g !== group(prev) || !!prev?.purged
    const members = originalGroups.get(g) ?? []
    const bodyChanged = 'content' in ch.patch && JSON.stringify(prev?.content) !== JSON.stringify(o.content)
    if (attaching || bodyChanged) {
      if (members.some((id) => !writable(id))) { denied.add(ch.id); continue }
      // An existing group's body wins when attaching a stale/offline copy.
      if (attaching && members.length) continue
      if (typeof o?.content?.md !== 'string') { denied.add(ch.id); continue }
      const md = relinkBodies.get(g) ?? o.content.md
      const prior = updates.get(g)
      if (prior && prior.md !== md) { denied.add(ch.id); prior.sources.forEach((id) => denied.add(id)); continue }
      if (prior) prior.sources.push(ch.id)
      else updates.set(g, { md, sources: [ch.id] })
    }
  }
  for (const [id, o] of next) {
    const g = group(o)
    if (!g || o.purged) continue
    const ch = changes.get(id)
    const prev = old.get(id)?.object
    const attaching = !!ch && (g !== group(prev) || !!prev?.purged)
    const canonical = canonicalBodies.get(g)?.md
    const md = updates.get(g)?.md ?? (attaching ? canonical : undefined)
    if (typeof md === 'string' && (o.content?.md !== md || attaching)) {
      const patch = { ...(ch?.patch ?? {}), content: { md } }
      changes.set(id, { id, patch })
    }
  }
  return { changes: [...changes.values()], deniedIds: [...denied], revision }
}

/** No hidden IDs, names or counts: only the capability for the visible note. */
export async function syncedNoteCapabilities(db: D1Database, access: Access, userId: string): Promise<Map<string, boolean>> {
  const { results } = await db.prepare("SELECT data,seq,owner_id FROM objects WHERE kind='card' AND json_extract(data,'$.type')='note' AND json_extract(data,'$.noteGroupId') IS NOT NULL AND COALESCE(json_extract(data,'$.purged'),0)=0").all<Row>()
  const deniedGroups = new Set<string>()
  for (const r of results) {
    const o = JSON.parse(r.data) as Note, g = group(o)
    if (g && ((!access.canEdit(o.boardId ?? '')) || (!!r.owner_id && r.owner_id !== userId))) deniedGroups.add(g)
  }
  return new Map(results.map((r) => { const o = JSON.parse(r.data) as Note; return [o.id, deniedGroups.has(group(o) ?? '')] }))
}

/** Reuse the existing atomic guard; a stale membership snapshot must roll back. */
export function noteRevisionGuard(db: D1Database, accessRevision: string, revision: number) {
  return db.prepare("INSERT INTO access_write_guard(id,revision) VALUES(1, CASE WHEN (SELECT value FROM counters WHERE name='seq')=?1 THEN ?2 ELSE -1 END) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision").bind(revision, Number(accessRevision))
}
