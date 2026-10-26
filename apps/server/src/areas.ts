import { isArea, type AreaItem } from '@doggynote/core'
import type { IncomingChange } from './sync.ts'

/** Guard the final parent tombstone against joins arriving between sync chunks. */
export async function checkAreaRemovals(db: D1Database, changes: IncomingChange[]) {
  const versions = new Map<string, number>(), conflicts: string[] = []
  const removing = changes.filter(c => c.patch.deletedAt || c.patch.purged || 'boardId' in c.patch)
  if (!removing.length) return { versions, conflicts }
  const rows = new Map<string, AreaItem>()
  for (let i = 0; i < removing.length; i += 90) {
    const ids = removing.slice(i, i + 90).map(c => c.id)
    const { results } = await db.prepare(`SELECT data FROM objects WHERE id IN (${ids.map((_, j) => `?${j + 1}`).join(',')})`).bind(...ids).all<{ data: string }>()
    for (const row of results) { const item = JSON.parse(row.data) as AreaItem; if (isArea(item)) rows.set(item.id, item) }
  }
  const patches = new Map(changes.map(c => [c.id, c.patch]))
  for (const board of new Set([...rows.values()].map(area => area.boardId))) {
    const { results } = await db.prepare("SELECT data,seq FROM objects WHERE kind IN ('card','sticker') AND board_id=?1").bind(board).all<{ data: string; seq: number }>()
    versions.set(board, results.reduce((sum, row) => sum + row.seq, 0))
    const members = results.map(row => JSON.parse(row.data) as AreaItem)
    for (const area of rows.values()) {
      if (area.boardId !== board) continue
      const after = { ...area, ...patches.get(area.id) }
      if (!after.deletedAt && !after.purged && after.boardId === board) continue
      if (members.some(member => {
        const next = { ...member, ...patches.get(member.id) }
        return !next.deletedAt && !next.purged && next.areaId === area.id && (next.boardId !== after.boardId || after.deletedAt || after.purged)
      })) conflicts.push(area.id)
    }
  }
  return { versions, conflicts }
}
