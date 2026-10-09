import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { requireUser } from './auth.ts'
import { randomToken } from './crypto.ts'

// View-only share links. A link exposes one board and (optionally) every board
// reachable from it through live board cards. Revoking takes effect at once:
// responses are never cached.

type Obj = {
  id: string
  kind: string
  boardId?: string
  parentId?: string | null
  type?: string
  content?: { boardId?: string }
  deletedAt?: number | null
  purged?: boolean
}

const alive = (o: Obj) => !o.purged && !o.deletedAt

export const shares = new Hono<AppEnv>()

shares.get('/shares', requireUser, async (c) => {
  const boardId = c.req.query('boardId')
  if (!boardId) return c.json({ error: 'boardId required' }, 400)
  const { results } = await c.env.DB.prepare(
    'SELECT token, board_id, include_children, created_at FROM shares WHERE board_id = ?1 AND revoked_at IS NULL ORDER BY created_at DESC',
  )
    .bind(boardId)
    .all<{ token: string; board_id: string; include_children: number; created_at: number }>()
  return c.json({ shares: results.map((r) => ({ token: r.token, boardId: r.board_id, includeChildren: !!r.include_children, createdAt: r.created_at })) })
})

shares.post('/shares', requireUser, async (c) => {
  const { boardId, includeChildren } = await c.req.json<{ boardId?: unknown; includeChildren?: unknown }>().catch(() => ({}) as Record<string, unknown>)
  if (typeof boardId !== 'string' || !boardId) return c.json({ error: 'boardId required' }, 400)
  const exists = await c.env.DB.prepare("SELECT 1 FROM objects WHERE id = ?1 AND kind = 'board'").bind(boardId).first()
  if (!exists) return c.json({ error: 'Board not found (has it synced yet?)' }, 404)
  const token = randomToken(18)
  const now = Date.now()
  await c.env.DB.prepare('INSERT INTO shares (token, board_id, include_children, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(token, boardId, includeChildren === false ? 0 : 1, c.get('user').id, now)
    .run()
  return c.json({ share: { token, boardId, includeChildren: includeChildren !== false, createdAt: now } }, 201)
})

shares.delete('/shares/:token', requireUser, async (c) => {
  await c.env.DB.prepare('UPDATE shares SET revoked_at = ?1 WHERE token = ?2 AND revoked_at IS NULL').bind(Date.now(), c.req.param('token')).run()
  return c.json({ ok: true })
})

export type ResolvedShare = { root: Obj; sharedBoards: Set<string>; objects: Obj[] }

/**
 * Everything a share link exposes: its root board, every board reachable
 * through live board cards (when inner boards are included), and their objects.
 * Null if the link is unknown, revoked, or its board is gone.
 */
export async function resolveShare(db: D1Database, token: string): Promise<ResolvedShare | null> {
  const share = await db
    .prepare('SELECT board_id, include_children FROM shares WHERE token = ?1 AND revoked_at IS NULL')
    .bind(token)
    .first<{ board_id: string; include_children: number }>()
  if (!share) return null

  const load = async (sql: string, ...args: unknown[]) =>
    (await db.prepare(sql).bind(...args).all<{ data: string }>()).results.map((r) => JSON.parse(r.data) as Obj)

  const root = (await load("SELECT data FROM objects WHERE id = ?1 AND kind = 'board'", share.board_id))[0]
  if (!root || !alive(root)) return null

  const out: Obj[] = [root]
  const seen = new Set([root.id])
  const queue = [root.id]
  while (queue.length) {
    const boardId = queue.shift()!
    const items = (await load('SELECT data FROM objects WHERE board_id = ?1', boardId)).filter(alive)
    out.push(...items)
    if (!share.include_children) continue
    // Follow live board cards into child boards.
    const childIds = items.filter((o) => o.kind === 'card' && o.type === 'board' && o.content?.boardId).map((o) => o.content!.boardId!)
    const fresh = childIds.filter((id) => !seen.has(id))
    if (!fresh.length) continue
    const placeholders = fresh.map((_, i) => `?${i + 1}`).join(',')
    const boards = (await load(`SELECT data FROM objects WHERE kind = 'board' AND id IN (${placeholders})`, ...fresh)).filter(alive)
    for (const b of boards) {
      seen.add(b.id)
      out.push(b)
      queue.push(b.id)
    }
  }
  // Child boards whose content isn't shared still need their board object for the tile.
  if (!share.include_children) {
    const childIds = out.filter((o) => o.kind === 'card' && o.type === 'board').map((o) => o.content?.boardId).filter((x): x is string => !!x)
    if (childIds.length) {
      const placeholders = childIds.map((_, i) => `?${i + 1}`).join(',')
      out.push(...(await load(`SELECT data FROM objects WHERE kind = 'board' AND id IN (${placeholders})`, ...childIds)).filter(alive))
    }
  }
  return { root, sharedBoards: seen, objects: out }
}

/** Public: the objects behind a share link. */
shares.get('/share/:token', async (c) => {
  c.header('cache-control', 'no-store')
  const res = await resolveShare(c.env.DB, c.req.param('token'))
  if (!res) return c.json({ error: 'This link has been turned off or never existed' }, 404)
  return c.json({ rootBoardId: res.root.id, sharedBoards: [...res.sharedBoards], objects: res.objects })
})
