import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { auth, requireUser, users } from './auth.ts'
import { sync } from './sync.ts'
import { assets } from './assets.ts'
import { shares } from './shares.ts'
import { isFetchableUrl, unfurl } from './unfurl.ts'

export type { Env } from './env.ts'

export const app = new Hono<AppEnv>().basePath('/api')

// The desktop app calls the API cross-origin with a bearer token. Only listed
// origins get CORS headers; cookies are never allowed cross-origin.
app.use('*', async (c, next) => {
  const origin = c.req.header('origin')
  const allowed = origin && (c.env?.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).includes(origin)
  if (allowed && c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '86400',
        vary: 'origin',
      },
    })
  }
  await next()
  // Always vary on Origin: otherwise a browser can reuse a cached no-CORS copy
  // (e.g. from an <img>) for a later CORS request and fail it.
  c.res.headers.append('vary', 'origin')
  if (allowed) c.res.headers.set('access-control-allow-origin', origin)
})

// Mutations must be JSON (or an image upload), which a cross-site HTML form
// can't send without a CORS preflight. Together with SameSite=Lax cookies this
// closes CSRF.
app.use('*', async (c, next) => {
  if (c.req.method === 'POST') {
    const type = c.req.header('content-type') ?? ''
    if (!type.startsWith('application/json')) return c.json({ error: 'JSON body required' }, 415)
  }
  await next()
})

app.get('/health', (c) => c.json({ ok: true, woof: true }))

// Local debugging only: test builds of the desktop app report their state here,
// and it lands in the wrangler log. Off unless DEV_DIAG=1 (never set in production).
app.post('/diag', async (c) => {
  if (c.env?.DEV_DIAG !== '1') return c.json({ error: 'Not found' }, 404)
  console.log('[diag]', JSON.stringify(await c.req.json().catch(() => null)))
  return c.json({ ok: true })
})

app.route('/auth', auth)
app.route('/', assets)
app.route('/', shares)

const authed = new Hono<AppEnv>()
authed.use('*', requireUser)
authed.route('/', users)
authed.route('/', sync)
authed.get('/unfurl', async (c) => {
  const target = isFetchableUrl(c.req.query('url') ?? '')
  if (!target) return c.json({ error: 'Only http(s) links can be previewed' }, 400)
  try {
    return c.json(await unfurl(target))
  } catch (e) {
    return c.json({ error: `Couldn't fetch that page (${e instanceof Error ? e.message : 'error'})` }, 502)
  }
})
app.route('/', authed)

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  console.error('[doggynote]', err)
  return c.json({ error: 'Server error' }, 500)
})
