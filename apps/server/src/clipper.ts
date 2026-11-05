import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { CLIPPER_REDIRECT, type Board, type BoardInboxItem, type Card, type ClipperBoard } from '@doggynote/core'
import type { AppEnv } from './env.ts'
import { requireUser } from './auth.ts'
import { accessGuard, isLiveBoard, isToyboxTree, loadAccess } from './access.ts'
import { b64url, randomToken, sha256Hex } from './crypto.ts'
import { putImageAsset } from './assets.ts'
import { notifyRooms } from './realtime.ts'

const DAY = 86_400_000
const uuid = z.uuid()
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
function fail(status: 400 | 401 | 403 | 404 | 409, message: string): never { throw new HTTPException(status, { message }) }
const url = z.string().max(8192).refine((value) => { try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false } })
const source = z.strictObject({ pageUrl: url, pageTitle: z.string().max(1000), imageUrl: url })
const sizes = z.array(z.enum(['thumb', 'small', 'medium', 'full'])).length(4).refine((v) => new Set(v).size === 4)
const image = z.strictObject({ assetId: uuid, width: z.number().int().positive().max(80_000_000), height: z.number().int().positive().max(80_000_000), sizes }).refine((value) => value.width * value.height <= 80_000_000)
const clipSchema = z.strictObject({ id: uuid, boardId: z.string().min(1).max(200), image, source })
type ClipRow = { id: string; board_id: string; asset_id: string; created_by: string; data: string; state: BoardInboxItem['state']; placed_card_id: string | null; request_hash: string; created_at: number }
const itemOf = (row: ClipRow): BoardInboxItem => ({ ...JSON.parse(row.data), state: row.state, ...(row.placed_card_id ? { placedCardId: row.placed_card_id } : {}) })

async function body<T extends z.ZodType>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(await c.req.json().catch(() => null))
  if (!result.success) fail(400, 'Invalid clipper request')
  return result.data
}

/** Deleted ancestors and private Inboxes cannot be clip destinations. */
async function boardInfo(c: Context<AppEnv>, id: string, edit: boolean) {
  const access = await loadAccess(c.env.DB, c.get('user'))
  if (!(edit ? access.canEdit(id) : access.canRead(id)) || isToyboxTree(access.boards, id)) fail(403, 'Board unavailable or access changed')
  if (!await isLiveBoard(c.env.DB, id)) fail(403, 'Board unavailable')
  return access
}

const requireClipper: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = c.req.header('authorization')?.match(/^Bearer (dn_clip_[A-Za-z0-9_-]{43})$/)?.[1]
  if (!raw) return c.json({ error: 'Connect DoggyNote to save images' }, 401)
  const row = await c.env.DB.prepare(`SELECT k.id,u.id AS user_id,u.username,u.is_admin FROM clipper_credentials k JOIN users u ON u.id=k.user_id
    WHERE k.token_hash=?1 AND k.revoked_at IS NULL AND k.expires_at>?2`).bind(await sha256Hex(raw), Date.now()).first<{ id: string; user_id: string; username: string; is_admin: number }>()
  if (!row) return c.json({ error: 'This connection expired or was revoked. Connect DoggyNote again.' }, 401)
  c.set('user', { id: row.user_id, username: row.username, isAdmin: !!row.is_admin })
  c.set('clipperId', row.id)
  await c.env.DB.prepare('UPDATE clipper_credentials SET last_used_at=?1 WHERE id=?2').bind(Date.now(), row.id).run()
  await next()
}
const credentialGuard = (c: Context<AppEnv>) => c.env.DB.prepare('INSERT OR REPLACE INTO clipper_write_guard(id,credential_id,checked_at) VALUES(1,?1,?2)').bind(c.get('clipperId'), Date.now())
const boardGuard = (c: Context<AppEnv>, boardId: string, columnId?: string) => c.env.DB.prepare('INSERT OR REPLACE INTO inbox_write_guard(id,board_id,column_id) VALUES(1,?1,?2)').bind(boardId, columnId ?? null)

export const clipper = new Hono<AppEnv>()
for (const path of ['/clipper/*', '/clipper-connections', '/clipper-connections/*', '/boards/:board/inbox', '/boards/:board/inbox/*']) clipper.use(path, async (c, next) => { c.header('cache-control', 'no-store'); await next() })
clipper.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  if (String(error).includes('Access changed')) return c.json({ error: 'Board access changed. Refresh and try again.' }, 409)
  if (String(error).includes('Clipper connection expired')) return c.json({ error: 'Connection expired. Connect DoggyNote again.' }, 401)
  console.error('[clipper]', error)
  return c.json({ error: 'Could not save this clip. Please retry.' }, 500)
})

// The browser session grants consent; the extension receives only a one-use code.
clipper.post('/clipper/authorize', requireUser, async (c) => {
  const input = await body(c, z.strictObject({ challenge: secret, state: secret, redirectUri: z.literal(CLIPPER_REDIRECT) }))
  const code = randomToken(), now = Date.now()
  const results = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM clipper_codes WHERE expires_at<?1 OR used_at IS NOT NULL').bind(now),
    c.env.DB.prepare(`INSERT INTO clipper_codes(token_hash,user_id,challenge,redirect_uri,expires_at)
      SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=?6 AND user_id=?2 AND expires_at>?7)`)
      .bind(await sha256Hex(code), c.get('user').id, input.challenge, input.redirectUri, now + 5 * 60_000, c.get('sessionHash'), now),
  ])
  if (!results[1].meta.changes) fail(401, 'Your session expired. Sign in and connect again.')
  const redirect = new URL(input.redirectUri)
  redirect.searchParams.set('code', code); redirect.searchParams.set('state', input.state)
  return c.json({ redirect: redirect.toString() })
})
clipper.post('/clipper/exchange', async (c) => {
  const input = await body(c, z.strictObject({ code: secret, verifier: secret, redirectUri: z.literal(CLIPPER_REDIRECT) }))
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.verifier))))
  const codeHash = await sha256Hex(input.code), now = Date.now(), id = crypto.randomUUID(), token = `dn_clip_${randomToken()}`
  const tokenHash = await sha256Hex(token), expiresAt = now + 90 * DAY
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO clipper_credentials(id,user_id,token_hash,created_at,expires_at)
      SELECT ?1,user_id,?2,?3,?4 FROM clipper_codes WHERE token_hash=?5 AND challenge=?6 AND redirect_uri=?7 AND used_at IS NULL AND expires_at>?3`)
      .bind(id, tokenHash, now, expiresAt, codeHash, challenge, input.redirectUri),
    c.env.DB.prepare('UPDATE clipper_codes SET used_at=?1 WHERE token_hash=?2 AND EXISTS(SELECT 1 FROM clipper_credentials WHERE id=?3)').bind(now, codeHash, id),
  ])
  if (!results[0].meta.changes) fail(401, 'Connection request expired or was already used. Connect again.')
  const user = await c.env.DB.prepare('SELECT u.id,u.username FROM users u JOIN clipper_credentials k ON k.user_id=u.id WHERE k.id=?1').bind(id).first()
  return c.json({ id, token, expiresAt, user }, 201)
})

clipper.get('/clipper-connections', requireUser, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,last_used_at AS lastUsedAt FROM clipper_credentials WHERE user_id=?1 ORDER BY created_at DESC').bind(c.get('user').id).all()
  return c.json({ connections: results })
})
clipper.delete('/clipper-connections/:id', requireUser, async (c) => {
  await c.env.DB.prepare('UPDATE clipper_credentials SET revoked_at=?1 WHERE id=?2 AND user_id=?3').bind(Date.now(), c.req.param('id'), c.get('user').id).run()
  return c.json({ ok: true })
})
clipper.delete('/clipper/connection', requireClipper, async (c) => {
  await c.env.DB.prepare('UPDATE clipper_credentials SET revoked_at=?1 WHERE id=?2').bind(Date.now(), c.get('clipperId')).run()
  return c.json({ ok: true })
})

clipper.get('/clipper/boards', requireClipper, async (c) => {
  const access = await loadAccess(c.env.DB, c.get('user'))
  const { results } = await c.env.DB.prepare("SELECT data FROM objects WHERE kind='board'").all<{ data: string }>()
  const all = new Map(results.map((r) => { const b = JSON.parse(r.data) as Board; return [b.id, b] }))
  const boards: ClipperBoard[] = []
  for (const board of all.values()) {
    if (!access.canEdit(board.id) || isToyboxTree(access.boards, board.id)) continue
    const names: string[] = [], seen = new Set<string>()
    let current: Board | undefined = board, available = true
    while (current) {
      if (seen.has(current.id) || current.deletedAt || current.purged) { available = false; break }
      seen.add(current.id)
      // Do not disclose names of ancestors outside a direct grant's scope.
      if (access.canRead(current.id)) names.unshift(current.title || 'Untitled board')
      if (!current.parentId) break
      current = all.get(current.parentId)
      if (!current) available = false
    }
    if (available) boards.push({ id: board.id, title: board.title || 'Untitled board', path: names.join(' / ') })
  }
  return c.json({ boards: boards.sort((a, b) => a.path.localeCompare(b.path)) })
})

clipper.post('/clipper/uploads', requireClipper, async (c) => {
  const { assetId } = await body(c, z.strictObject({ assetId: uuid }))
  await c.env.DB.batch([credentialGuard(c), c.env.DB.prepare(`INSERT OR IGNORE INTO clipper_uploads(asset_id,credential_id)
    SELECT ?1,?2 WHERE NOT EXISTS(SELECT 1 FROM assets WHERE id=?1) AND NOT EXISTS(SELECT 1 FROM sticker_assets WHERE asset_id=?1)`).bind(assetId, c.get('clipperId'))])
  const owner = await c.env.DB.prepare('SELECT k.user_id FROM clipper_uploads p JOIN clipper_credentials k ON k.id=p.credential_id WHERE p.asset_id=?1').bind(assetId).first<{ user_id: string }>()
  if (owner?.user_id !== c.get('user').id) fail(409, 'Image identifier already belongs to another upload')
  return c.json({ ok: true })
})
clipper.put('/clipper/assets/:id/:size', requireClipper, async (c) => {
  const owner = await c.env.DB.prepare('SELECT k.user_id FROM clipper_uploads p JOIN clipper_credentials k ON k.id=p.credential_id WHERE p.asset_id=?1').bind(c.req.param('id')).first<{ user_id: string }>()
  if (owner?.user_id !== c.get('user').id) fail(403, 'Allocate this image upload first')
  return putImageAsset(c)
})

clipper.post('/clipper/clips', requireClipper, async (c) => {
  const input = await body(c, clipSchema), access = await boardInfo(c, input.boardId, true)
  const hash = await sha256Hex(JSON.stringify(input)), now = Date.now(), me = c.get('user')
  const existing = await c.env.DB.prepare('SELECT * FROM board_inbox WHERE id=?1').bind(input.id).first<ClipRow>()
  if (existing) {
    if (existing.created_by !== me.id || existing.request_hash !== hash) fail(409, 'This clip identifier was already used')
    return c.json({ item: itemOf(existing) })
  }
  const owner = await c.env.DB.prepare('SELECT k.user_id FROM clipper_uploads p JOIN clipper_credentials k ON k.id=p.credential_id WHERE p.asset_id=?1').bind(input.image.assetId).first<{ user_id: string }>()
  if (owner?.user_id !== me.id) fail(403, 'This image belongs to another account')
  const { results: assets } = await c.env.DB.prepare('SELECT size FROM assets WHERE id=?1 AND created_by=?2').bind(input.image.assetId, me.id).all<{ size: string }>()
  if (!input.image.sizes.every((size) => assets.some((a) => a.size === size))) fail(409, 'Image upload is incomplete. Retry saving.')
  const item: BoardInboxItem = { ...input, createdAt: now, createdBy: me.username, state: 'pending' }
  await c.env.DB.batch([accessGuard(c.env.DB, access.revision), boardGuard(c, input.boardId), credentialGuard(c),
    c.env.DB.prepare('INSERT OR IGNORE INTO board_inbox(id,board_id,asset_id,created_by,request_hash,data,created_at,changed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)')
      .bind(item.id, item.boardId, item.image.assetId, me.id, hash, JSON.stringify(item), now)])
  const saved = await c.env.DB.prepare('SELECT * FROM board_inbox WHERE id=?1').bind(item.id).first<ClipRow>()
  if (!saved || saved.created_by !== me.id || saved.request_hash !== hash) fail(409, 'This clip identifier was already used')
  await notifyRooms(c.env, [input.boardId])
  return c.json({ item: itemOf(saved) }, 201)
})

clipper.get('/boards/:board/inbox', requireUser, async (c) => {
  const id = c.req.param('board')
  await boardInfo(c, id, false)
  const { results } = await c.env.DB.prepare("SELECT * FROM board_inbox WHERE board_id=?1 AND state='pending' ORDER BY created_at DESC,id").bind(id).all<ClipRow>()
  return c.json({ items: results.map(itemOf), count: results.length })
})

clipper.post('/boards/:board/inbox/:id/place', requireUser, async (c) => {
  const id = c.req.param('board'), access = await boardInfo(c, id, true)
  const at = await body(c, z.strictObject({ x: z.number().finite().min(-1e8).max(1e8), y: z.number().finite().min(-1e8).max(1e8), columnId: z.string().max(200).optional() }))
  const row = await c.env.DB.prepare('SELECT * FROM board_inbox WHERE id=?1 AND board_id=?2').bind(c.req.param('id'), id).first<ClipRow>()
  if (!row) fail(404, 'Clip unavailable')
  if (row.state === 'discarded') fail(409, 'This clip was discarded')
  const cardId = row.placed_card_id ?? `clip-${row.id}`
  if (row.state === 'placed') return c.json({ cardId })
  if (at.columnId) {
    const parent = await c.env.DB.prepare("SELECT 1 FROM objects WHERE id=?1 AND board_id=?2 AND json_extract(data,'$.type')='column' AND COALESCE(json_extract(data,'$.deletedAt'),0)=0 AND COALESCE(json_extract(data,'$.purged'),0)=0").bind(at.columnId, id).first()
    if (!parent) fail(409, 'This column is no longer available')
  }
  const clip = itemOf(row), now = Date.now(), w = Math.min(260, clip.image.width)
  const card: Card<'image'> = { id: cardId, kind: 'card', type: 'image', boardId: id, x: at.x, y: at.y, w,
    h: Math.round(w * clip.image.height / clip.image.width) + 30, z: now, color: 'none', createdAt: now,
    columnId: at.columnId ?? null, order: now, content: { ...clip.image, source: clip.source } }
  // Every write uses the same transition gate. Racing placements return the first card.
  const gate = "EXISTS(SELECT 1 FROM board_inbox WHERE id=?1 AND state='pending')"
  await c.env.DB.batch([accessGuard(c.env.DB, access.revision), boardGuard(c, id, at.columnId),
    c.env.DB.prepare(`UPDATE counters SET value=value+1 WHERE name='seq' AND ${gate}`).bind(row.id),
    c.env.DB.prepare(`INSERT INTO objects(id,kind,board_id,data,seq,updated_at,updated_by,owner_id)
      SELECT ?2,'card',?3,?4,(SELECT value FROM counters WHERE name='seq'),?5,?6,NULL WHERE ${gate}`)
      .bind(row.id, cardId, id, JSON.stringify(card), now, c.get('user').id),
    c.env.DB.prepare("UPDATE board_inbox SET state='placed',placed_card_id=?2,changed_at=?3 WHERE id=?1 AND state='pending'").bind(row.id, cardId, now),
  ])
  await notifyRooms(c.env, [id])
  const saved = await c.env.DB.prepare('SELECT state,placed_card_id FROM board_inbox WHERE id=?1').bind(row.id).first<ClipRow>()
  if (saved?.state !== 'placed') fail(409, 'Clip changed. Refresh the Inbox.')
  return c.json({ cardId: saved.placed_card_id })
})

for (const action of ['discard', 'restore'] as const) clipper.post(`/boards/:board/inbox/:id/${action}`, requireUser, async (c) => {
  const id = c.req.param('board'), access = await boardInfo(c, id, true)
  const from = action === 'discard' ? 'pending' : 'discarded', to = action === 'discard' ? 'discarded' : 'pending'
  await c.env.DB.batch([accessGuard(c.env.DB, access.revision), boardGuard(c, id), c.env.DB.prepare('UPDATE board_inbox SET state=?1,changed_at=?2 WHERE id=?3 AND board_id=?4 AND state=?5').bind(to, Date.now(), c.req.param('id'), id, from)])
  await notifyRooms(c.env, [id])
  return c.json({ ok: true })
})
