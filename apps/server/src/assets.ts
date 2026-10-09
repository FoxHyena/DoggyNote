import { Hono, type Context } from 'hono'
import type { AppEnv } from './env.ts'
import { requireUser, sessionUser } from './auth.ts'
import { signAssetToken, verifyAssetToken } from './crypto.ts'
import { resolveShare } from './shares.ts'

// Images live in R2 as "<assetId>/<size>", uploaded files as "<assetId>/file".
// Reading either needs one of:
//   - a session (cookie, or bearer): the browser editor
//   - ?t=<asset token>: the desktop app, whose cross-origin <img> can't send a bearer header
//   - ?share=<share token>: a share viewer, and only for images on the boards that link covers

const SIZES = new Set(['thumb', 'small', 'medium', 'full'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BYTES = 15 * 1024 * 1024
const DAY = 86_400_000
/** Same limit as MAX_FILE_BYTES in @doggynote/core. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024
const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i

export const assets = new Hono<AppEnv>()

/**
 * Asset tokens expire at the end of the next UTC day, so a token (and every
 * image URL built from it) stays the same all day and browser caching still works.
 */
assets.get('/assets/token', requireUser, async (c) => {
  const secret = c.env.ASSET_TOKEN_SECRET
  if (!secret) return c.json({ error: 'Image tokens are not configured on this server' }, 500)
  const expiresAt = (Math.floor(Date.now() / DAY) + 2) * DAY
  return c.json({ token: await signAssetToken(secret, c.get('user').id, expiresAt), expiresAt })
})

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

type Access = 'ok' | 'unauthenticated' | 'forbidden'

/** True if every card using this image sits in someone else's Toy box. */
async function privateToSomeoneElse(c: Context<AppEnv>, assetId: string, userId: string): Promise<boolean> {
  const { results } = await c.env.DB.prepare(
    "SELECT owner_id FROM objects WHERE kind = 'card' AND json_extract(data, '$.content.assetId') = ?1",
  )
    .bind(assetId)
    .all<{ owner_id: string | null }>()
  return results.length > 0 && results.every((r) => r.owner_id && r.owner_id !== userId)
}

async function canRead(c: Context<AppEnv>, assetId: string): Promise<Access> {
  const session = await sessionUser(c)
  if (session) return (await privateToSomeoneElse(c, assetId, session.user.id)) ? 'forbidden' : 'ok'

  const t = c.req.query('t')
  if (t) {
    const secret = c.env.ASSET_TOKEN_SECRET
    const userId = secret ? await verifyAssetToken(secret, t, Date.now()) : null
    if (!userId) return 'unauthenticated'
    // A removed account's tokens stop working at once.
    const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?1').bind(userId).first()
    if (!exists) return 'unauthenticated'
    return (await privateToSomeoneElse(c, assetId, userId)) ? 'forbidden' : 'ok'
  }

  const share = c.req.query('share')
  if (share) {
    const resolved = await resolveShare(c.env.DB, share)
    if (!resolved) return 'unauthenticated' // unknown or turned off
    const { results } = await c.env.DB.prepare(
      "SELECT board_id, data FROM objects WHERE kind = 'card' AND json_extract(data, '$.content.assetId') = ?1",
    )
      .bind(assetId)
      .all<{ board_id: string; data: string }>()
    const shown = results.some((r) => {
      const card = JSON.parse(r.data) as { deletedAt?: number | null; purged?: boolean }
      return !card.purged && !card.deletedAt && resolved.sharedBoards.has(r.board_id)
    })
    return shown ? 'ok' : 'forbidden'
  }

  return 'unauthenticated'
}

assets.get('/assets/:id/:size', async (c) => {
  const { id, size } = c.req.param()
  if (!UUID.test(id) || !SIZES.has(size)) return c.json({ error: 'bad asset path' }, 400)
  const access = await canRead(c, id)
  if (access === 'unauthenticated') return c.json({ error: 'Sign in or use a share link to see this image' }, 401)
  if (access === 'forbidden') return c.json({ error: "This image isn't yours to see" }, 403)
  const obj = await c.env.BUCKET.get(`${id}/${size}`)
  if (!obj) return c.json({ error: 'not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  // Private: browsers may cache (bytes never change), shared caches and CDNs may not.
  headers.set('cache-control', 'private, max-age=31536000, immutable')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(obj.body, { headers })
})

// ---- uploaded files ------------------------------------------------------------

/** Keeps a file name printable and short; the original is only ever a label. */
export function cleanFileName(name: string): string {
  const n = name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 200)
  return n || 'file'
}

/** `attachment` with an ASCII fallback plus the UTF-8 name (RFC 6266). */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** Streams the body straight to R2; nothing is buffered in the Worker. */
assets.put('/files/:id', requireUser, async (c) => {
  const id = c.req.param('id')
  if (!UUID.test(id)) return c.json({ error: 'bad file id' }, 400)
  const len = Number(c.req.header('content-length') ?? NaN)
  if (!Number.isFinite(len)) return c.json({ error: 'content-length required' }, 411)
  if (len > MAX_FILE_BYTES) return c.json({ error: 'Files can be up to 50 MB' }, 413)
  const body = c.req.raw.body
  if (!body) return c.json({ error: 'empty file' }, 400)
  // Immutable, like images.
  if (await c.env.BUCKET.head(`${id}/file`)) return c.json({ ok: true }, 200)
  const raw = (c.req.header('content-type') ?? '').split(';')[0].trim()
  const type = MIME.test(raw) ? raw : 'application/octet-stream'
  const name = cleanFileName(c.req.query('name') ?? '')
  await c.env.BUCKET.put(`${id}/file`, body, { httpMetadata: { contentType: type }, customMetadata: { name } })
  await c.env.DB.prepare('INSERT OR IGNORE INTO assets (id, size, mime, bytes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(id, 'file', type, len, c.get('user').id, Date.now())
    .run()
  return c.json({ ok: true }, 201)
})

assets.get('/files/:id', async (c) => {
  const id = c.req.param('id')
  if (!UUID.test(id)) return c.json({ error: 'bad file id' }, 400)
  const access = await canRead(c, id)
  if (access === 'unauthenticated') return c.json({ error: 'Sign in or use a share link to get this file' }, 401)
  if (access === 'forbidden') return c.json({ error: "This file isn't yours to get" }, 403)
  const obj = await c.env.BUCKET.get(`${id}/file`)
  if (!obj) return c.json({ error: 'not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('content-length', String(obj.size))
  headers.set('cache-control', 'private, max-age=31536000, immutable')
  // Someone else's upload must never run as a page on our origin (an .html or
  // .svg file would otherwise be script with our cookies): always a download,
  // sniffing off, and sandboxed even if a browser renders it anyway.
  headers.set('content-disposition', contentDisposition(obj.customMetadata?.name ?? 'file'))
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-security-policy', "sandbox; default-src 'none'")
  return new Response(obj.body, { headers })
})
