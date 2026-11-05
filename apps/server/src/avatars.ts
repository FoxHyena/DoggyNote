import { Hono } from 'hono'
import type { AppEnv } from './env.ts'
import { requireUser, sessionUser } from './auth.ts'
import { verifyAssetToken } from './crypto.ts'

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const key = (id: string) => `avatars/${id}.png`
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value >>> 0
})

/** Inspect the complete PNG structure, checksums and bounded raster before storing it. */
export async function validAvatarPng(bytes: Uint8Array): Promise<boolean> {
  if (bytes.length < 57 || bytes.length > MAX_AVATAR_BYTES || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const compressed: Uint8Array[] = []
  let stride = 0, header = false, ended = false, palette = false, indexed = false
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at), end = at + length + 12
    if (end > bytes.length) return false
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    let crc = 0xffffffff
    for (let i = at + 4; i < end - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]!) & 255]!
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) return false
    if (!header && type !== 'IHDR') return false
    if (type === 'IHDR') {
      if (header || length !== 13 || view.getUint32(at + 8) !== 512 || view.getUint32(at + 12) !== 512 || bytes[at + 16] !== 8 || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || bytes[at + 20] !== 0) return false
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[bytes[at + 17]!]
      if (!channels) return false
      indexed = bytes[at + 17] === 3
      stride = 512 * channels + 1; header = true
    } else if (type === 'PLTE') {
      if (compressed.length || !length || length % 3 || length > 768) return false
      palette = true
    } else if (type === 'IDAT') {
      if (indexed && !palette) return false
      compressed.push(bytes.slice(at + 8, end - 4))
    } else if (type === 'IEND') {
      if (length || !compressed.length || end !== bytes.length) return false
      ended = true; break
    } else if (['acTL', 'fcTL', 'fdAT'].includes(type) || /^[A-Z]/.test(type)) return false
    at = end
  }
  if (!ended) return false
  try {
    const reader = new Blob(compressed).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
    let count = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        for (let i = 0; i < value.length; i++) if ((count + i) % stride === 0 && value[i]! > 4) return false
        count += value.length
        if (count > stride * 512) return false
      }
      return count === stride * 512
    } finally { await reader.cancel().catch(() => {}) }
  } catch { return false }
}

export const avatars = new Hono<AppEnv>()

async function replace(c: Parameters<typeof sessionUser>[0], next: string | null) {
  const user = c.get('user')
  const [before, changed] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT avatar_id FROM users WHERE id=?1').bind(user.id),
    c.env.DB.prepare('UPDATE users SET avatar_id=?1 WHERE id=?2').bind(next, user.id),
  ])
  if (!changed.meta.changes) throw new Error('Account unavailable')
  const previous = (before.results[0] as { avatar_id: string | null } | undefined)?.avatar_id
  // The pointer is committed before cleanup. A failed cleanup must not turn a
  // successful save into a reported failure or delete the new referenced image.
  if (previous) await c.env.BUCKET.delete(key(previous)).catch(() => console.warn('[avatar] cleanup_failed'))
  c.header('cache-control', 'no-store')
  return c.json({ user: { ...user, avatarId: next } })
}

avatars.put('/me/avatar', requireUser, async (c) => {
  if ((c.req.header('content-type') ?? '').split(';')[0] !== 'image/png') return c.json({ error: 'Save a cropped PNG photo.' }, 415)
  if (Number(c.req.header('content-length')) > MAX_AVATAR_BYTES) return c.json({ error: 'The cropped photo must be under 2 MB.' }, 413)
  const reader = c.req.raw.body?.getReader()
  if (!reader) return c.json({ error: 'Choose a photo first.' }, 400)
  const parts: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_AVATAR_BYTES) { await reader.cancel(); return c.json({ error: 'The cropped photo must be under 2 MB.' }, 413) }
      parts.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  if (!await validAvatarPng(bytes)) return c.json({ error: 'That photo could not be read. Choose it again and retry.' }, 400)
  const id = crypto.randomUUID()
  try {
    await c.env.BUCKET.put(key(id), bytes, { httpMetadata: { contentType: 'image/png' } })
    return await replace(c, id)
  } catch {
    await c.env.BUCKET.delete(key(id)).catch(() => {})
    return c.json({ error: 'Could not save your photo. Your previous photo is unchanged. Try again.' }, 503)
  }
})

avatars.delete('/me/avatar', requireUser, async (c) => {
  try { return await replace(c, null) }
  catch { return c.json({ error: 'Could not remove your photo. Try again.' }, 503) }
})

avatars.get('/avatars/:userId/:avatarId', async (c) => {
  if (c.req.query('share')) return c.json({ error: 'Sign in to see profile photos.' }, 401)
  let allowed = !!await sessionUser(c)
  if (!allowed && c.req.query('t') && c.env.ASSET_TOKEN_SECRET) {
    const principal = await verifyAssetToken(c.env.ASSET_TOKEN_SECRET, c.req.query('t')!, Date.now())
    if (principal?.startsWith('session:')) allowed = !!await c.env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash=?1 AND expires_at>?2').bind(principal.slice(8), Date.now()).first()
  }
  if (!allowed) return c.json({ error: 'Sign in to see profile photos.' }, 401)
  const { userId, avatarId } = c.req.param()
  if (!UUID.test(avatarId) || !await c.env.DB.prepare('SELECT 1 FROM users WHERE id=?1 AND avatar_id=?2').bind(userId, avatarId).first()) return c.json({ error: 'Photo unavailable.' }, 404)
  const object = await c.env.BUCKET.get(key(avatarId))
  if (!object) return c.json({ error: 'Photo unavailable.' }, 404)
  return new Response(object.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" } })
})
