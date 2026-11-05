import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { loadAccess } from './access.ts'

/** Favourites and last-opened times, per person. Only boards you can still open come back. */
export const boardPreferences = new Hono<AppEnv>()
boardPreferences.use('*', async (c, next) => { c.header('cache-control', 'no-store'); await next() })

boardPreferences.get('/board-preferences', async (c) => {
  const user = c.get('user')
  const [{ results }, access] = await Promise.all([
    c.env.DB.prepare('SELECT board_id, favorite_at, opened_at FROM board_preferences WHERE user_id=?1').bind(user.id).all<{ board_id: string; favorite_at: number | null; opened_at: number | null }>(),
    loadAccess(c.env.DB, user),
  ])
  // A revoked share or someone else's Inbox never comes back, even by ID.
  return c.json({ preferences: results.filter((r) => access.canRead(r.board_id)).map((r) => ({ boardId: r.board_id, favoriteAt: r.favorite_at, openedAt: r.opened_at })) })
})

boardPreferences.post('/board-preferences/:boardId', async (c) => {
  const boardId = c.req.param('boardId'), user = c.get('user')
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !Object.keys(body).length || Object.keys(body).some((k) => !['favorite', 'opened'].includes(k)) || ('favorite' in body && typeof body.favorite !== 'boolean') || ('opened' in body && body.opened !== true)) return c.json({ error: 'Invalid board preference.' }, 400)
  if (!(await loadAccess(c.env.DB, user)).canRead(boardId)) return c.json({ error: 'You can’t open this board.' }, 403)
  const now = Date.now()
  // Starring again keeps the original star time, so a retried star doesn't reorder Favourites.
  await c.env.DB.prepare(`INSERT INTO board_preferences (user_id, board_id, favorite_at, opened_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(user_id, board_id) DO UPDATE SET favorite_at = CASE WHEN ?5 THEN (CASE WHEN excluded.favorite_at IS NULL THEN NULL ELSE COALESCE(favorite_at, excluded.favorite_at) END) ELSE favorite_at END, opened_at = COALESCE(excluded.opened_at, opened_at)`)
    .bind(user.id, boardId, body.favorite ? now : null, body.opened ? now : null, 'favorite' in body ? 1 : 0).run()
  return c.json({ ok: true, at: now })
})
