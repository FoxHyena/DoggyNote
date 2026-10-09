import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { requireUser } from './auth.ts'

// Images live in R2 as "<assetId>/<size>". Ids are random UUIDs, and reads are
// public so share links can show images; writes need a session.

const SIZES = new Set(['thumb', 'medium', 'full'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 15 * 1024 * 1024

export const assets = new Hono<AppEnv>()

assets.put('/assets/:id/:size', requireUser, async (c) => {
  const { id, size } = c.req.param()
  if (!UUID.test(id) || !SIZES.has(size)) return c.json({ error: 'bad asset path' }, 400)
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim()
  if (!TYPES.has(type)) return c.json({ error: `unsupported type ${type}` }, 415)
  const len = Number(c.req.header('content-length') ?? 0)
  if (len > MAX_BYTES) return c.json({ error: 'image too large' }, 413)
  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_BYTES) return c.json({ error: 'image too large' }, 413)
  // Never overwrite: an asset id's bytes are immutable (served with immutable caching).
  const existing = await c.env.BUCKET.head(`${id}/${size}`)
  if (!existing) {
    await c.env.BUCKET.put(`${id}/${size}`, body, { httpMetadata: { contentType: type } })
    await c.env.DB.prepare('INSERT OR IGNORE INTO assets (id, size, mime, bytes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(id, size, type, body.byteLength, c.get('user').id, Date.now())
      .run()
  }
  return c.json({ ok: true }, existing ? 200 : 201)
})

assets.get('/assets/:id/:size', async (c) => {
  const { id, size } = c.req.param()
  if (!UUID.test(id) || !SIZES.has(size)) return c.json({ error: 'bad asset path' }, 400)
  const obj = await c.env.BUCKET.get(`${id}/${size}`)
  if (!obj) return c.json({ error: 'not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(obj.body, { headers })
})
