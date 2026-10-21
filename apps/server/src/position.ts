import { POSITION_FIELDS, changesPosition, positionLocks, type Card } from '@doggynote/core'
import type { IncomingChange } from './sync.ts'

/** Check editor locks on the server too, so offline/old clients cannot move a locked card. */
export async function checkPositionLocks(db: D1Database, changes: IncomingChange[]) {
  // Typing, colour and other content pushes never move anything: skip the reads
  // and the per-board write guard, so busy boards don't contend on them.
  if (!changes.some((c) => POSITION_FIELDS.some((key) => key in c.patch))) return { versions: new Map<string, number>(), lockedIds: [] as string[], objects: [] as Card[] }
  const boardIds = new Set<string>()
  const ids = changes.map((c) => c.id)
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    const { results } = await db.prepare(`SELECT DISTINCT board_id FROM objects WHERE id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')}) AND kind='card'`).bind(...chunk).all<{ board_id: string }>()
    for (const row of results) if (row.board_id) boardIds.add(row.board_id)
  }
  for (const ch of changes) if (typeof ch.patch.boardId === 'string') boardIds.add(ch.patch.boardId)
  const versions = new Map<string, number>()
  const cards: Card[] = []
  const boards = [...boardIds]
  for (let i = 0; i < boards.length; i += 90) {
    const chunk = boards.slice(i, i + 90)
    const { results } = await db.prepare(`SELECT data,seq,board_id FROM objects WHERE kind='card' AND board_id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')})`).bind(...chunk).all<{ data: string; seq: number; board_id: string }>()
    for (const row of results) versions.set(row.board_id, (versions.get(row.board_id) ?? 0) + row.seq)
    for (const id of chunk) if (!versions.has(id)) versions.set(id, 0)
    cards.push(...results.map((r) => JSON.parse(r.data) as Card))
  }
  const byId = new Map(cards.map((c) => [c.id, c]))
  const lockPatches = new Map(changes.map((c) => [c.id, c.patch]))
  const locked = positionLocks(cards.map((c) => {
    const patch = lockPatches.get(c.id)
    // A queued move followed by a new lock is one merged patch. Only an
    // existing lock blocks that move; explicit unlocks remove existing locks.
    return patch && 'positionLocked' in patch && patch.positionLocked !== true ? { ...c, positionLocked: false } : c
  }))
  const lockedIds: string[] = []
  for (const { id, patch } of changes) {
    const prev = byId.get(id)
    if (!prev || !changesPosition(prev, patch as Partial<Card>)) continue
    if (locked.has(id) || (typeof patch.columnId === 'string' && locked.has(patch.columnId))) lockedIds.push(id)
  }
  return { versions, lockedIds, objects: cards.filter((c) => lockedIds.includes(c.id) || locked.has(c.id)) }
}

/** Uses the existing atomic write guard; no new schema/migration is necessary. */
export function positionWriteGuards(db: D1Database, accessRevision: string, versions: Map<string, number>) {
  // Per-board sequence sums increase on every card write, including insertion.
  // Unrelated boards do not contend, and a racing lock in this family retries.
  return [...versions].map(([boardId, version]) => db.prepare("INSERT INTO access_write_guard(id,revision) VALUES (1,CASE WHEN (SELECT COALESCE(SUM(seq),0) FROM objects WHERE kind='card' AND board_id=?1)=?2 THEN ?3 ELSE -1 END) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision").bind(boardId, version, Number(accessRevision)))
}
