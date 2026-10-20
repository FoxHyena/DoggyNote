import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { requireUser } from './auth.ts'
import { randomToken } from './crypto.ts'
import { bumpAccess, isToyboxTree, loadAccess } from './access.ts'

type Obj = { id: string; kind: string; cardId?: string; from?: string; to?: string; boardId?: string; parentId?: string | null; type?: string; content?: { boardId?: string }; deletedAt?: number | null; purged?: boolean }
type ShareRow = { token: string; board_id: string; include_children: number; permission: 'view' | 'edit'; created_by: string; created_at: number; revoked_at: number | null; expires_at: number | null; allow_signup: number; scope_version: number }
const alive = (o: Obj) => !o.purged && !o.deletedAt
const visibleRelations = (items: Obj[]) => {
  const cards = new Set(items.filter((o) => o.kind === 'card' && alive(o)).map((o) => o.id))
  return items.filter((o) => o.kind === 'comment' ? !!o.cardId && cards.has(o.cardId) : o.kind === 'connection' ? !!o.from && !!o.to && cards.has(o.from) && cards.has(o.to) : true)
}
const WEEK = 7 * 86_400_000
export const shares = new Hono<AppEnv>()
const wire = (s: ShareRow) => ({ token: s.token, boardId: s.board_id, includeChildren: !!s.include_children, permission: s.permission, createdAt: s.created_at, expiresAt: s.expires_at, allowSignup: !!s.allow_signup, scopeVersion: s.scope_version ?? 0 })

async function permittedLink(db: D1Database, token: string, signup = false): Promise<ShareRow | null> {
  const s = await db.prepare("SELECT * FROM shares WHERE token=?1 AND permission='edit' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?2)").bind(token, Date.now()).first<ShareRow>()
  if (!s || (signup && !s.allow_signup)) return null
  const creator = await db.prepare('SELECT id, is_admin FROM users WHERE id=?1').bind(s.created_by).first<{ id: string; is_admin: number }>()
  if (!creator) return null
  const a = await loadAccess(db, { id: creator.id, isAdmin: !!creator.is_admin })
  const root = await db.prepare("SELECT data FROM objects WHERE id=?1 AND kind='board'").bind(s.board_id).first<{ data: string }>()
  return a.canManage(s.board_id) && root && alive(JSON.parse(root.data)) ? s : null
}
export async function validateBoardSignup(db: D1Database, token: string): Promise<{ boardId: string } | null> {
  const s = await permittedLink(db, token, true)
  return s ? { boardId: s.board_id } : null
}
export async function boardSignupStatements(db: D1Database, token: string, userId: string): Promise<D1PreparedStatement[]> {
  const s = await permittedLink(db, token, true)
  if (!s) throw new Error('Board invitation is unavailable')
  return [grantStatement(db, s.board_id, userId, 'edit', s.created_by, token, !!s.include_children), bumpAccess(db)]
}
function grantStatement(db: D1Database, boardId: string, userId: string, permission: 'view' | 'edit', creator: string, source: string | null, includeChildren = true) {
  return db.prepare('INSERT INTO board_grants (id,board_id,user_id,permission,source_token,created_by,created_at,include_children) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)').bind(crypto.randomUUID(), boardId, userId, permission, source, creator, Date.now(), includeChildren ? 1 : 0)
}

shares.get('/shares', requireUser, async (c) => {
  c.header('cache-control', 'no-store')
  const boardId = c.req.query('boardId')
  if (!boardId) return c.json({ error: 'boardId required' }, 400)
  const a = await loadAccess(c.env.DB, c.get('user'))
  if (!a.canManage(boardId)) return c.json({ error: 'Only the owner or an admin can manage sharing' }, 403)
  const [{ results: links }, { results: grants }] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM shares WHERE board_id=?1 AND revoked_at IS NULL ORDER BY created_at DESC').bind(boardId).all<ShareRow>(),
    c.env.DB.prepare('SELECT g.id,g.user_id,u.username,g.permission,g.source_token,g.created_at FROM board_grants g JOIN users u ON u.id=g.user_id LEFT JOIN shares s ON s.token=g.source_token WHERE g.board_id=?1 AND g.revoked_at IS NULL AND (g.source_token IS NULL OR s.revoked_at IS NULL) ORDER BY u.username').bind(boardId).all<{ id: string; user_id: string; username: string; permission: string; source_token: string | null; created_at: number }>(),
  ])
  return c.json({ shares: links.map(wire), members: grants.map((g) => ({ id: g.id, userId: g.user_id, username: g.username, permission: g.permission, viaLink: !!g.source_token, createdAt: g.created_at })), ownerId: a.boards.get(boardId)?.ownerId ?? null, legacy: a.boards.get(boardId)?.legacy ?? false })
})
shares.post('/shares', requireUser, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const { boardId } = body
  if (typeof boardId !== 'string' || !boardId) return c.json({ error: 'boardId required' }, 400)
  const a = await loadAccess(c.env.DB, c.get('user'))
  if (isToyboxTree(a.boards, boardId)) return c.json({ error: 'Your Inbox is private and cannot be shared' }, 400)
  if (!a.canManage(boardId)) return c.json({ error: 'Only the owner or an admin can manage sharing' }, 403)
  const root = await c.env.DB.prepare('SELECT data FROM objects WHERE id=?1').bind(boardId).first<{ data: string }>()
  if (!root || !alive(JSON.parse(root.data))) return c.json({ error: 'Board not found' }, 404)
  const permission = body.permission === 'edit' ? 'edit' : 'view'
  const token = randomToken(24)
  const now = Date.now()
  const expiresAt = permission === 'edit' ? now + WEEK : null
  await c.env.DB.prepare('INSERT INTO shares (token,board_id,include_children,created_by,created_at,permission,expires_at,allow_signup,scope_version) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1)').bind(token, boardId, body.includeChildren !== false ? 1 : 0, c.get('user').id, now, permission, expiresAt, permission === 'edit' && body.allowSignup === true ? 1 : 0).run()
  return c.json({ share: { token, boardId, includeChildren: body.includeChildren !== false, permission, createdAt: now, expiresAt, allowSignup: permission === 'edit' && body.allowSignup === true, scopeVersion: 1 } }, 201)
})
shares.delete('/shares/:token', requireUser, async (c) => {
  const s = await c.env.DB.prepare('SELECT * FROM shares WHERE token=?1').bind(c.req.param('token')).first<ShareRow>()
  if (!s) return c.json({ error: 'Link not found' }, 404)
  const a = await loadAccess(c.env.DB, c.get('user'))
  if (!a.canManage(s.board_id)) return c.json({ error: 'Only the owner or an admin can manage sharing' }, 403)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE shares SET revoked_at=?1 WHERE token=?2 AND revoked_at IS NULL').bind(Date.now(), s.token),
    c.env.DB.prepare('UPDATE board_grants SET revoked_at=?1 WHERE source_token=?2 AND revoked_at IS NULL').bind(Date.now(), s.token), bumpAccess(c.env.DB),
  ])
  return c.json({ ok: true })
})
shares.post('/boards/:boardId/members', requireUser, async (c) => {
  const boardId = c.req.param('boardId')
  const a = await loadAccess(c.env.DB, c.get('user'))
  if (!a.canManage(boardId)) return c.json({ error: 'Only the owner or an admin can manage sharing' }, 403)
  const body = await c.req.json<{ username?: unknown; permission?: unknown; includeChildren?: unknown }>().catch(() => ({}) as { username?: unknown; permission?: unknown; includeChildren?: unknown })
  if (typeof body.username !== 'string') return c.json({ error: 'Username required' }, 400)
  const u = await c.env.DB.prepare('SELECT id FROM users WHERE username=?1').bind(body.username.trim()).first<{ id: string }>()
  if (!u) return c.json({ error: 'No account with that username' }, 404)
  if (u.id === a.boards.get(boardId)?.ownerId) return c.json({ error: 'The owner already has access' }, 400)
  const permission = body.permission === 'view' ? 'view' : 'edit'
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE board_grants SET revoked_at=?1 WHERE board_id=?2 AND user_id=?3 AND source_token IS NULL AND revoked_at IS NULL').bind(Date.now(), boardId, u.id),
    grantStatement(c.env.DB, boardId, u.id, permission, c.get('user').id, null, body.includeChildren !== false), bumpAccess(c.env.DB),
  ])
  return c.json({ ok: true }, 201)
})
shares.delete('/boards/:boardId/members/:grantId', requireUser, async (c) => {
  const boardId = c.req.param('boardId')
  const a = await loadAccess(c.env.DB, c.get('user'))
  if (!a.canManage(boardId)) return c.json({ error: 'Only the owner or an admin can manage sharing' }, 403)
  await c.env.DB.batch([c.env.DB.prepare('UPDATE board_grants SET revoked_at=?1 WHERE id=?2 AND board_id=?3').bind(Date.now(), c.req.param('grantId'), boardId), bumpAccess(c.env.DB)])
  return c.json({ ok: true })
})
shares.post('/shares/:token/accept', requireUser, async (c) => {
  const s = await permittedLink(c.env.DB, c.req.param('token'))
  if (!s) return c.json({ error: 'This invitation expired or was turned off' }, 404)
  const existing = await c.env.DB.prepare('SELECT 1 FROM board_grants WHERE user_id=?1 AND source_token=?2 AND revoked_at IS NULL').bind(c.get('user').id, s.token).first()
  if (!existing) await c.env.DB.batch([grantStatement(c.env.DB, s.board_id, c.get('user').id, 'edit', s.created_by, s.token, !!s.include_children), bumpAccess(c.env.DB)])
  return c.json({ boardId: s.board_id })
})

export type ResolvedShare = { root: Obj; sharedBoards: Set<string>; objects: Obj[] }
/** Public view capabilities expose only boards their creator still looks after:
 * boards they manage, or shared-space (legacy) boards they are a member of. */
export async function resolveShare(db: D1Database, token: string): Promise<ResolvedShare | null> {
  const s = await db.prepare("SELECT * FROM shares WHERE token=?1 AND permission='view' AND revoked_at IS NULL").bind(token).first<ShareRow>()
  if (!s) return null
  const creator = await db.prepare('SELECT id,is_admin FROM users WHERE id=?1').bind(s.created_by).first<{ id: string; is_admin: number }>()
  if (!creator) return null
  const a = await loadAccess(db, { id: creator.id, isAdmin: !!creator.is_admin })
  const stewards = (id: string) => a.canManage(id) || (!!a.boards.get(id)?.legacy && a.canRead(id) && !isToyboxTree(a.boards, id))
  const { results } = await db.prepare('SELECT data FROM objects WHERE owner_id IS NULL').all<{ data: string }>()
  const all = results.map((r) => JSON.parse(r.data) as Obj)
  const root = all.find((o) => o.id === s.board_id && o.kind === 'board')
  if (!root || !alive(root) || !stewards(root.id)) return null
  if (s.scope_version >= 1) {
    // Parent ancestry is the authority. Board-card references outside this
    // closure are locked placeholders, never a route to another private root.
    const scope = new Set([root.id])
    const queue = [root.id]
    while (s.include_children && queue.length) {
      const parent = queue.shift()!
      for (const b of all) {
        if (b.kind !== 'board' || b.parentId !== parent || scope.has(b.id) || !alive(b) || !a.canRead(b.id) || isToyboxTree(a.boards, b.id)) continue
        scope.add(b.id)
        queue.push(b.id)
      }
    }
    const objects = visibleRelations(all.filter((o) => !(o.kind === 'card' && o.type === 'board' && o.content?.boardId && isToyboxTree(a.boards, o.content.boardId)) && alive(o) && (o.kind === 'board' ? scope.has(o.id) : !!o.boardId && scope.has(o.boardId)))).map((o) => o.kind === 'board' && !scope.has(o.parentId ?? '') ? { ...o, parentId: null } : o)
    const placeholders = new Set<string>()
    for (const o of objects) {
      const target = o.kind === 'card' && o.type === 'board' ? o.content?.boardId : undefined
      if (!target || scope.has(target) || placeholders.has(target)) continue
      placeholders.add(target)
      objects.push({ id: target, kind: 'board', parentId: root.id, title: 'Board', icon: 'paw', color: 'none', createdAt: 0 } as Obj)
    }
    return { root: { ...root, parentId: null }, sharedBoards: scope, objects }
  }
  // Legacy links follow board cards, but only into boards the creator manages
  // or that are nested under the root: never into a board someone else merely
  // shared with them.
  const nested = (id: string) => {
    const visited = new Set<string>()
    for (let p = a.boards.get(id)?.parentId ?? null; p && !visited.has(p); p = a.boards.get(p)?.parentId ?? null) {
      if (p === root.id) return true
      visited.add(p)
    }
    return false
  }
  const followable = (id: string) => a.canRead(id) && !isToyboxTree(a.boards, id) && (stewards(id) || nested(id))
  const seen = new Set<string>()
  const queue = [root.id]
  const out: Obj[] = []
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id) || !followable(id)) continue
    const b = all.find((o) => o.id === id && o.kind === 'board' && alive(o))
    if (!b) continue
    seen.add(id)
    out.push(b)
    const items = all.filter((o) => o.boardId === id && alive(o))
    // Never leak a restricted child's title or identifier through its tile.
    const visibleItems = visibleRelations(items.filter((o) => o.type !== 'board' || (!!o.content?.boardId && followable(o.content.boardId))))
    out.push(...visibleItems)
    for (const item of visibleItems) {
      if (item.kind !== 'card' || item.type !== 'board' || !item.content?.boardId) continue
      const child = all.find((o) => o.id === item.content!.boardId && o.kind === 'board' && alive(o))
      if (!child) continue
      if (s.include_children) queue.push(child.id)
      else if (!out.some((o) => o.id === child.id)) out.push(child)
    }
  }
  return { root, sharedBoards: seen, objects: out }
}
shares.get('/share/:token', async (c) => {
  c.header('cache-control', 'no-store')
  const edit = await permittedLink(c.env.DB, c.req.param('token'))
  if (edit) {
    const b = await c.env.DB.prepare('SELECT data FROM objects WHERE id=?1').bind(edit.board_id).first<{ data: string }>()
    return c.json({ permission: 'edit', boardId: edit.board_id, title: b ? (JSON.parse(b.data) as { title: string }).title : 'Board', allowSignup: !!edit.allow_signup, includeChildren: !!edit.include_children, expiresAt: edit.expires_at })
  }
  const res = await resolveShare(c.env.DB, c.req.param('token'))
  if (!res) return c.json({ error: 'This link has been turned off or expired' }, 404)
  return c.json({ permission: 'view', rootBoardId: res.root.id, sharedBoards: [...res.sharedBoards], objects: res.objects })
})
