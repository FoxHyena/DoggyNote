import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { requireUser } from './auth.ts'

export type AccessUser = { id: string; isAdmin: boolean }
export type BoardAccess = { id: string; parentId: string | null; ownerId: string | null; legacy: boolean }
export type Access = {
  boards: Map<string, BoardAccess>
  revision: string
  homeBoardId: string
  legacyShared: boolean
  canRead(boardId: string): boolean
  canEdit(boardId: string): boolean
  canManage(boardId: string): boolean
}
export const personalHome = (userId: string) => `home:${userId}`
export const bumpAccess = (db: D1Database) => db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'access_revision'")
export function accessGuard(db: D1Database, revision: string, absentIds: string[] = []): D1PreparedStatement {
  if (absentIds.length > 90) throw new Error('At most 90 new IDs per access guard')
  const absent = absentIds.length ? `NOT EXISTS(SELECT 1 FROM objects WHERE id IN (${absentIds.map((_, i) => `?${i + 2}`).join(',')}))` : '1'
  return db.prepare(`INSERT INTO access_write_guard (id,revision) VALUES (1,CASE WHEN ${absent} THEN ?1 ELSE -1 END) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision`).bind(Number(revision), ...absentIds)
}
export const newBoardAccess = (db: D1Database, boardId: string, userId: string) =>
  db.prepare('INSERT INTO board_access (board_id, owner_id, legacy) VALUES (?1, ?2, 0)').bind(boardId, userId)

/** Authorization always comes from protected SQL metadata, never syncable JSON. */
export async function loadAccess(db: D1Database, user: AccessUser): Promise<Access> {
  // A stable revision must bracket every authorization read. Reading the
  // counter concurrently with grants can pair stale rights with a new revision
  // and defeat the write guard during a racing revocation.
  const before = await db.prepare("SELECT value FROM counters WHERE name='access_revision'").first<{ value: number }>()
  const [{ results: rows }, { results: grants }, member] = await Promise.all([
    db.prepare("SELECT o.id, json_extract(o.data, '$.parentId') AS parent_id, a.owner_id, COALESCE(a.legacy,0) AS legacy FROM objects o LEFT JOIN board_access a ON a.board_id=o.id WHERE o.kind='board'").all<{ id: string; parent_id: string | null; owner_id: string | null; legacy: number }>(),
    db.prepare('SELECT g.board_id, g.permission, g.include_children FROM board_grants g LEFT JOIN shares s ON s.token=g.source_token WHERE g.user_id=?1 AND g.revoked_at IS NULL AND (g.source_token IS NULL OR (s.token IS NOT NULL AND s.revoked_at IS NULL))').bind(user.id).all<{ board_id: string; permission: 'view' | 'edit'; include_children: number }>(),
    db.prepare('SELECT 1 FROM legacy_members WHERE user_id=?1').bind(user.id).first(),
  ])
  const rev = await db.prepare("SELECT value FROM counters WHERE name='access_revision'").first<{ value: number }>()
  if (before?.value !== rev?.value) return loadAccess(db, user)
  const boards = new Map(rows.map((r) => [r.id, { id: r.id, parentId: r.parent_id, ownerId: r.owner_id, legacy: !!r.legacy }]))
  const direct = new Map<string, number>()
  const inherited = new Map<string, number>()
  for (const g of grants) {
    const score = g.permission === 'edit' ? 2 : 1
    direct.set(g.board_id, Math.max(direct.get(g.board_id) ?? 0, score))
    if (g.include_children) inherited.set(g.board_id, Math.max(inherited.get(g.board_id) ?? 0, score))
  }
  const level = (id: string): number => {
    const seen = new Set<string>()
    let score = 0
    let current: string | null = id
    while (current) {
      if (seen.has(current)) return 0
      seen.add(current)
      if (current.startsWith('toybox:')) return current === `toybox:${user.id}` ? 2 : 0
      const b = boards.get(current)
      if (!b) return score
      if (user.isAdmin || b.ownerId === user.id || (b.legacy && member)) score = 2
      score = Math.max(score, (current === id ? direct : inherited).get(current) ?? 0)
      current = b.parentId
    }
    return score
  }
  return {
    boards, revision: String(rev?.value ?? 1), homeBoardId: personalHome(user.id), legacyShared: !!member || user.isAdmin,
    canRead: (id) => level(id) > 0,
    canEdit: (id) => level(id) === 2,
    canManage: (id) => !!boards.get(id) && !isToyboxTree(boards, id) && (user.isAdmin || boards.get(id)?.ownerId === user.id),
  }
}
export function isToyboxTree(boards: Map<string, BoardAccess>, id: string): boolean {
  const seen = new Set<string>()
  let current: string | null = id
  while (current && !seen.has(current)) {
    if (current.startsWith('toybox:')) return true
    seen.add(current)
    current = boards.get(current)?.parentId ?? null
  }
  return false
}

async function ensureHome(db: D1Database, user: AccessUser) {
  const id = personalHome(user.id)
  if (await db.prepare('SELECT 1 FROM objects WHERE id=?1').bind(id).first()) return
  const now = Date.now()
  await db.batch([
    db.prepare("UPDATE counters SET value=value+1 WHERE name='seq'"),
    db.prepare("INSERT OR IGNORE INTO objects (id,kind,board_id,data,seq,updated_at,updated_by,owner_id) VALUES (?1,'board',NULL,?2,(SELECT value FROM counters WHERE name='seq'),?3,?4,NULL)").bind(id, JSON.stringify({ id, kind: 'board', parentId: null, title: 'My Doghouse', icon: 'kennel', color: 'gold', createdAt: now }), now, user.id),
    db.prepare('INSERT OR IGNORE INTO board_access (board_id,owner_id,legacy) VALUES (?1,?2,0)').bind(id, user.id),
    bumpAccess(db),
  ])
}
export const accessRoutes = new Hono<AppEnv>()
accessRoutes.get('/access', requireUser, async (c) => {
  c.header('cache-control', 'no-store')
  await ensureHome(c.env.DB, c.get('user'))
  const a = await loadAccess(c.env.DB, c.get('user'))
  return c.json({ revision: a.revision, homeBoardId: a.homeBoardId, legacyShared: a.legacyShared, boards: [...a.boards.values()].filter((b) => a.canRead(b.id)).map((b) => ({ ...b, canEdit: a.canEdit(b.id), canManage: a.canManage(b.id) })) })
})
