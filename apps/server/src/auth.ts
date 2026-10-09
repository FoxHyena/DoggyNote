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

const validUsername = (u: unknown): u is string => typeof u === 'string' && /^[a-zA-Z0-9_.-]{2,32}$/.test(u)
const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 200

export const auth = new Hono<AppEnv>()

auth.post('/login', async (c) => {
  const body = await c.req.json<{ username?: unknown; password?: unknown; bearer?: unknown }>().catch(() => ({}) as Record<string, unknown>)
  const { username, password } = body
  if (typeof username !== 'string' || typeof password !== 'string') return c.json({ error: 'Username and password required' }, 400)
  const row = await c.env.DB.prepare('SELECT id, username, pw_hash, is_admin FROM users WHERE username = ?1').bind(username).first<UserRow>()
  // Verify against a dummy hash when the user doesn't exist so timing doesn't reveal usernames.
  const ok = await verifyPassword(password, row?.pw_hash ?? 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  if (!row || !ok) return c.json({ error: 'Wrong username or password' }, 401)

  const token = randomToken()
  const now = Date.now()
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(await sha256Hex(token), row.id, now, now + SESSION_DAYS * DAY, (c.req.header('user-agent') ?? '').slice(0, 200))
    .run()
  const secure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 })
  return c.json({ user: toUser(row), ...(body.bearer === true ? { token } : {}) })
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
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(id),
  ])
  return c.json({ ok: true })
})
