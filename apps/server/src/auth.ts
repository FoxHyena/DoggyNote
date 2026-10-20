import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv, User } from './env.ts'
import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto.ts'

export const SESSION_COOKIE = 'dn_session'
const SESSION_DAYS = 90
const DAY = 86_400_000

type UserRow = { id: string; username: string; pw_hash: string; is_admin: number }

const toUser = (r: { id: string; username: string; is_admin: number }): User => ({ id: r.id, username: r.username, isAdmin: !!r.is_admin })

function tokenFrom(c: Context<AppEnv>): string | null {
  const h = c.req.header('authorization')
  if (h?.startsWith('Bearer ')) return h.slice(7).trim() || null
  return getCookie(c, SESSION_COOKIE) ?? null
}

/** The signed-in user for this request (cookie or bearer), or null. Reads D1 every time. */
export async function sessionUser(c: Context<AppEnv>): Promise<{ user: User; hash: string } | null> {
  const token = tokenFrom(c)
  if (!token) return null
  const hash = await sha256Hex(token)
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
  )
    .bind(hash, Date.now())
    .first<{ id: string; username: string; is_admin: number }>()
  return row ? { user: toUser(row), hash } : null
}

/** Session gate: cookie (browser) or bearer token (desktop app). Read from D1 every request so logout/revoke is immediate. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!tokenFrom(c)) return c.json({ error: 'Not signed in' }, 401)
  const s = await sessionUser(c)
  if (!s) return c.json({ error: 'Session expired' }, 401)
  c.set('user', s.user)
  c.set('sessionHash', s.hash)
  await next()
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')?.isAdmin) return c.json({ error: 'Admins only' }, 403)
  await next()
}

export const validUsername = (u: unknown): u is string => typeof u === 'string' && /^[a-zA-Z0-9_.-]{2,32}$/.test(u)
export const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 200


/** Shared by login and invitation signup. Raw session secrets never enter D1. */
export async function establishSession(c: Context<AppEnv>, user: User, bearer = false, context: { boardId?: string } = {}) {
  const token = randomToken()
  const now = Date.now()
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(await sha256Hex(token), user.id, now, now + SESSION_DAYS * DAY, (c.req.header('user-agent') ?? '').slice(0, 200)).run()
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 })
  return c.json({ user, ...context, ...(bearer ? { token } : {}) })
}

export const auth = new Hono<AppEnv>()

auth.post('/login', async (c) => {
  const body = await c.req.json<{ username?: unknown; password?: unknown; bearer?: unknown }>().catch(() => ({}) as Record<string, unknown>)
  const { username, password } = body
  if (typeof username !== 'string' || typeof password !== 'string') return c.json({ error: 'Username and password required' }, 400)
  const row = await c.env.DB.prepare('SELECT id, username, pw_hash, is_admin FROM users WHERE username = ?1').bind(username).first<UserRow>()
  // Verify against a dummy hash when the user doesn't exist so timing doesn't reveal usernames.
  const ok = await verifyPassword(password, row?.pw_hash ?? 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  if (!row || !ok) return c.json({ error: 'Wrong username or password' }, 401)

  return establishSession(c, toUser(row), body.bearer === true)
})

auth.post('/logout', async (c) => {
  const token = tokenFrom(c)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256Hex(token)).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

export const users = new Hono<AppEnv>()

users.get('/me', (c) => c.json({ user: c.get('user') }))

users.post('/me/password', async (c) => {
  const { current, next } = await c.req.json<{ current?: unknown; next?: unknown }>().catch(() => ({}) as Record<string, unknown>)
  if (typeof current !== 'string' || !validPassword(next)) return c.json({ error: 'New password must be at least 8 characters' }, 400)
  const user = c.get('user')
  const row = await c.env.DB.prepare('SELECT pw_hash FROM users WHERE id = ?1').bind(user.id).first<{ pw_hash: string }>()
  if (!row || !(await verifyPassword(current, row.pw_hash))) return c.json({ error: 'Current password is wrong' }, 401)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET pw_hash = ?1 WHERE id = ?2').bind(await hashPassword(next), user.id),
    // Sign out every other device.
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2').bind(user.id, c.get('sessionHash')),
    c.env.DB.prepare('UPDATE agent_credentials SET revoked_at = ?1 WHERE user_id = ?2').bind(Date.now(), user.id),
  ])
  return c.json({ ok: true })
})

users.get('/users', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at').all<{
    id: string
    username: string
    is_admin: number
    created_at: number
  }>()
  return c.json({ users: results.map((r) => ({ ...toUser(r), createdAt: r.created_at })) })
})

users.post('/users', requireAdmin, async (c) => {
  const { username, password, isAdmin } = await c.req.json<{ username?: unknown; password?: unknown; isAdmin?: unknown }>().catch(() => ({}) as Record<string, unknown>)
  if (!validUsername(username)) return c.json({ error: 'Username: 2–32 letters, numbers, . _ -' }, 400)
  if (!validPassword(password)) return c.json({ error: 'Password must be at least 8 characters' }, 400)
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare('INSERT INTO users (id, username, pw_hash, is_admin, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(id, username, await hashPassword(password), isAdmin === true ? 1 : 0, Date.now())
      .run()
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: 'That username is taken' }, 409)
    throw e
  }
  return c.json({ user: { id, username, isAdmin: isAdmin === true } }, 201)
})

users.delete('/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  if (id === c.get('user').id) return c.json({ error: "You can't remove yourself" }, 400)
  const target = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?1').bind(id).first<{ is_admin: number }>()
  if (!target) return c.json({ error: 'Person not found' }, 404)
  if (target.is_admin) {
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').first<{ n: number }>()
    if ((count?.n ?? 0) <= 1) return c.json({ error: 'Cannot remove the final admin' }, 400)
  }
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(id),
  ])
  return c.json({ ok: true })
})

// Invitation and recovery links carry a high-entropy secret; only its hash is stored.
type AccountLink = {
  id: string; kind: 'invite' | 'recovery'; user_id: string | null; expires_at: number;
  revoked_at: number | null; used_at: number | null; username?: string
}
const linkError = 'This link has expired, was revoked, or has already been used.'
const activeLink = async (c: Context<AppEnv>, token: string, kind: AccountLink['kind']) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  return c.env.DB.prepare(`SELECT l.*, u.username FROM account_links l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.token_hash = ?1 AND l.kind = ?2 AND l.expires_at > ?3 AND l.revoked_at IS NULL AND l.used_at IS NULL`)
    .bind(await sha256Hex(token), kind, Date.now()).first<AccountLink>()
}

for (const kind of ['invite', 'recovery'] as const) {
  auth.get(`/${kind}/:token`, async (c) => {
    c.header('cache-control', 'no-store')
    const link = await activeLink(c, c.req.param('token'), kind)
    if (!link) return c.json({ error: linkError }, 410)
    return c.json({ kind, expiresAt: link.expires_at, ...(kind === 'recovery' ? { username: link.username } : {}) })
  })
}

auth.post('/signup', async (c) => {
  const body = await c.req.json<{ token?: unknown; boardToken?: unknown; username?: unknown; password?: unknown; bearer?: unknown }>().catch(() => ({} as Record<string, unknown>))
  if (!validUsername(body.username)) return c.json({ error: 'Username: 2–32 letters, numbers, . _ -' }, 400)
  if (!validPassword(body.password)) return c.json({ error: 'Password must be 8–200 characters' }, 400)
  const id = crypto.randomUUID()
  const now = Date.now()
  const passwordHash = await hashPassword(body.password)
  const token = typeof body.token === 'string' ? body.token : ''
  const boardToken = typeof body.boardToken === 'string' ? body.boardToken : ''
  let boardId: string | undefined
  let statements: D1PreparedStatement[]
  if (token) {
    if (!(await activeLink(c, token, 'invite'))) return c.json({ error: linkError }, 410)
    const tokenHash = await sha256Hex(token)
    statements = [
      c.env.DB.prepare(`INSERT INTO users (id, username, pw_hash, is_admin, created_at)
        SELECT ?1, ?2, ?3, 0, ?4 FROM account_links
        WHERE token_hash = ?5 AND kind = 'invite' AND expires_at > ?4 AND revoked_at IS NULL AND used_at IS NULL`)
        .bind(id, body.username, passwordHash, now, tokenHash),
      c.env.DB.prepare(`UPDATE account_links SET used_at = ?1, redeemed_by = ?2 WHERE token_hash = ?3 AND EXISTS (SELECT 1 FROM users WHERE id = ?2)`)
        .bind(now, id, tokenHash),
    ]
  } else if (boardToken) {
    const { validateBoardSignup, boardSignupStatements } = await import('./shares.ts')
    const board = await validateBoardSignup(c.env.DB, boardToken)
    if (!board) return c.json({ error: 'This board link does not allow signup or is no longer available.' }, 410)
    boardId = board.boardId
    try {
      statements = [c.env.DB.prepare(`INSERT INTO users (id, username, pw_hash, is_admin, created_at) VALUES (?1, ?2, ?3, 0, ?4)`).bind(id, body.username, passwordHash, now),
        ...await boardSignupStatements(c.env.DB, boardToken, id)]
    } catch (e) {
      if (String(e).includes('Board invitation is unavailable')) return c.json({ error: 'This board invitation is no longer available.' }, 410)
      throw e
    }
  } else return c.json({ error: 'An invitation is required to create an account.' }, 400)
  try {
    const result = await c.env.DB.batch(statements)
    if (!result[0]?.meta.changes) return c.json({ error: linkError }, 410)
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ error: 'That username is taken' }, 409)
    if (String(e).includes('Board invitation is unavailable')) return c.json({ error: 'This board invitation is no longer available.' }, 410)
    throw e
  }
  // Navigation context is returned by the server; it never grants access itself.
  return establishSession(c, { id, username: body.username, isAdmin: false }, body.bearer === true, { ...(boardId ? { boardId } : {}) })
})

auth.post('/reset', async (c) => {
  const body = await c.req.json<{ token?: unknown; password?: unknown }>().catch(() => ({} as Record<string, unknown>))
  if (typeof body.token !== 'string' || !validPassword(body.password)) return c.json({ error: 'Password must be 8–200 characters' }, 400)
  const link = await activeLink(c, body.token, 'recovery')
  if (!link?.user_id) return c.json({ error: linkError }, 410)
  const currentSession = await sessionUser(c)
  const redemption = crypto.randomUUID()
  const now = Date.now()
  const tokenHash = await sha256Hex(body.token)
  const guard = `EXISTS (SELECT 1 FROM account_links WHERE token_hash = ?3 AND redemption_id = ?4)`
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE account_links SET used_at = ?1, redemption_id = ?2 WHERE token_hash = ?3 AND kind = 'recovery' AND expires_at > ?1 AND used_at IS NULL AND revoked_at IS NULL`)
      .bind(now, redemption, tokenHash),
    c.env.DB.prepare(`UPDATE users SET pw_hash = ?1 WHERE id = ?2 AND ${guard}`).bind(await hashPassword(body.password), link.user_id, tokenHash, redemption),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?2 AND ?1 IS NOT NULL AND ${guard}`).bind(now, link.user_id, tokenHash, redemption),
    c.env.DB.prepare(`UPDATE agent_credentials SET revoked_at = ?1 WHERE user_id = ?2 AND ${guard}`).bind(now, link.user_id, tokenHash, redemption),
    c.env.DB.prepare(`UPDATE account_links SET revoked_at = ?1 WHERE user_id = ?2 AND kind = 'recovery' AND used_at IS NULL AND ${guard}`).bind(now, link.user_id, tokenHash, redemption),
  ])
  if (!result[0]?.meta.changes) return c.json({ error: linkError }, 410)
  if (currentSession?.user.id === link.user_id) deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

users.get('/admin/invites', requireAdmin, async (c) => {
  c.header('cache-control', 'no-store')
  const { results } = await c.env.DB.prepare(`SELECT l.id, l.created_at AS createdAt, l.expires_at AS expiresAt, l.revoked_at AS revokedAt,
    l.used_at AS usedAt, u.username AS acceptedBy FROM account_links l LEFT JOIN users u ON u.id = l.redeemed_by
    WHERE l.kind = 'invite' ORDER BY l.created_at DESC LIMIT 100`).all()
  return c.json({ invitations: results })
})

users.post('/admin/invites', requireAdmin, async (c) => {
  const token = randomToken()
  const id = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = now + 7 * DAY
  await c.env.DB.prepare(`INSERT INTO account_links (id, token_hash, kind, created_by, created_at, expires_at) VALUES (?1, ?2, 'invite', ?3, ?4, ?5)`)
    .bind(id, await sha256Hex(token), c.get('user').id, now, expiresAt).run()
  return c.json({ invitation: { id, createdAt: now, expiresAt }, url: `${new URL(c.req.url).origin}/signup/${token}` }, 201)
})

users.delete('/admin/invites/:id', requireAdmin, async (c) => {
  await c.env.DB.prepare(`UPDATE account_links SET revoked_at = ?1 WHERE id = ?2 AND kind = 'invite' AND used_at IS NULL`).bind(Date.now(), c.req.param('id')).run()
  return c.json({ ok: true })
})

users.post('/users/:id/recovery', requireAdmin, async (c) => {
  const id = c.req.param('id')
  if (!(await c.env.DB.prepare('SELECT id FROM users WHERE id = ?1').bind(id).first())) return c.json({ error: 'Person not found' }, 404)
  const now = Date.now()
  const token = randomToken()
  const expiresAt = now + 3_600_000
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE account_links SET revoked_at = ?1 WHERE user_id = ?2 AND kind = 'recovery' AND used_at IS NULL`).bind(now, id),
    c.env.DB.prepare(`INSERT INTO account_links (id, token_hash, kind, user_id, created_by, created_at, expires_at) VALUES (?1, ?2, 'recovery', ?3, ?4, ?5, ?6)`)
      .bind(crypto.randomUUID(), await sha256Hex(token), id, c.get('user').id, now, expiresAt),
  ])
  return c.json({ url: `${new URL(c.req.url).origin}/reset/${token}`, expiresAt }, 201)
})

users.get('/users/:id/sessions', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT token_hash AS id, created_at AS createdAt, expires_at AS expiresAt, user_agent AS device
    FROM sessions WHERE user_id = ?1 AND expires_at > ?2 ORDER BY created_at DESC`).bind(c.req.param('id'), Date.now()).all<{ id: string }>()
  return c.json({ sessions: results.map((s) => ({ ...s, current: s.id === c.get('sessionHash') })) })
})

users.delete('/users/:id/sessions/:session', requireAdmin, async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token_hash = ?2').bind(c.req.param('id'), c.req.param('session')).run()
  return c.json({ ok: true })
})

users.delete('/users/:id/sessions', requireAdmin, async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(c.req.param('id')),
    c.env.DB.prepare('UPDATE agent_credentials SET revoked_at = ?1 WHERE user_id = ?2').bind(Date.now(), c.req.param('id')),
  ])
  return c.json({ ok: true })
})
