import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { auth, requireUser, users } from './auth.ts'
import { stickers, telegramWebhook } from './stickers.ts'
import { sync } from './sync.ts'
import { assets } from './assets.ts'
import { shares } from './shares.ts'
import { agents } from './agents.ts'
import { accessRoutes } from './access.ts'
import { desktop } from './desktop.ts'
import { isFetchableUrl, proxyImage, unfurl } from './unfurl.ts'
import { movies } from './movies.ts'
import { realtime } from './realtime.ts'

export type { Env } from './env.ts'

export const app = new Hono<AppEnv>().basePath('/api')

/** The one canonical host; www.notepad.dog sends people here. */
export const CANONICAL_HOST = 'notepad.dog'

app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if (url.hostname === `www.${CANONICAL_HOST}`) {
    url.hostname = CANONICAL_HOST
    return c.redirect(url.toString(), 301)
  }
  await next()
})

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
        'access-control-allow-headers': 'authorization, content-type, x-doggynote-protocol',
        'access-control-max-age': '86400',
        vary: 'origin',
      },
    })
  }
  await next()
  if (c.res.status === 101) return // Upgrade responses have immutable headers.
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

app.route('/', telegramWebhook)
app.route('/auth', auth)
app.route('/', assets)
app.route('/', shares)
app.route('/', accessRoutes)
app.route('/', agents)
app.route('/', realtime)
app.route('/', desktop)

const authed = new Hono<AppEnv>()
authed.use('*', requireUser)
authed.use('/sync', async (c, next) => {
  if (c.req.header('x-doggynote-protocol') !== '3') return c.json({ error: 'Update DoggyNote to edit together. Your local changes are preserved.', updateRequired: true }, 426)
  await next()
})
authed.use('/notes/*', async (c, next) => {
  if (c.req.header('x-doggynote-protocol') !== '3') return c.json({ error: 'Update DoggyNote to edit together', updateRequired: true }, 426)
  await next()
})
authed.route('/', users)
authed.route('/', sync)
authed.route('/', stickers)
authed.route('/', movies)
authed.get('/unfurl', async (c) => {
  const target = isFetchableUrl(c.req.query('url') ?? '')
  if (!target) return c.json({ error: 'Only http(s) links can be previewed' }, 400)
  try {
    return c.json(await unfurl(target))
  } catch (e) {
    return c.json({ error: `Couldn't fetch that page (${e instanceof Error ? e.message : 'error'})` }, 502)
  }
})
// Link-preview images for PNG export: other sites don't send CORS headers, so
// the browser can't read their pixels. Signed-in only, images only, size-capped.
authed.get('/proxy-image', async (c) => {
  const target = isFetchableUrl(c.req.query('url') ?? '')
  if (!target) return c.json({ error: 'Only http(s) images' }, 400)
  try {
    return await proxyImage(target)
  } catch (e) {
    return c.json({ error: `Couldn't fetch that image (${e instanceof Error ? e.message : 'error'})` }, 502)
  }
})
app.route('/', authed)

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => {
  console.error('[doggynote]', err)
  return c.json({ error: 'Server error' }, 500)
})
