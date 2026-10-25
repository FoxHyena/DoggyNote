import { Hono } from 'hono'
import { normalizeStickerPack } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import { randomToken, sha256Hex } from './crypto.ts'
import type { AppEnv } from './env.ts'
import { packFromTelegram, storeTelegramAnimation, storeTelegramSticker, telegramCall, boundedBytes, TelegramError, type StickerPack, type TelegramSticker } from './telegram.ts'

export const stickers = new Hono<AppEnv>()
type PackRow = { name: string; title: string; manifest: string; upstream: string }
const packRow = (db: D1Database, name: string) => db.prepare('SELECT * FROM sticker_packs WHERE name=?1').bind(name.toLowerCase()).first<PackRow>()
/** The cached pack row, fetching its metadata from Telegram once when it is missing. */
async function ensurePackRow(env: AppEnv['Bindings'], name: string) {
  const row = await packRow(env.DB, name)
  if (row) return row
  const { pack, upstream } = packFromTelegram(await telegramCall(env, 'getStickerSet', { name }), name)
  await env.DB.prepare('INSERT OR IGNORE INTO sticker_packs(name,title,manifest,upstream,updated_at) VALUES(?1,?2,?3,?4,?5)').bind(name.toLowerCase(), pack.title, JSON.stringify(pack), JSON.stringify(upstream), Date.now()).run()
  return (await packRow(env.DB, name))!
}
const jsonBody = async (c: { req: { json: () => Promise<unknown> } }) => await c.req.json().catch(() => null) as Record<string, unknown> | null

stickers.use('*', async (c, next) => { c.header('cache-control', 'no-store'); await next() })
stickers.onError((e, c) => {
  // Never propagate upstream exceptions: fetch errors can contain bot URLs.
  const error = e instanceof TelegramError ? e : new TelegramError('Sticker request failed. Please try again.')
  if (error.retryAfter) c.header('retry-after', String(error.retryAfter))
  return c.json({ error: error.message, retryAfter: error.retryAfter }, error.status as 400 | 404 | 429 | 502 | 503)
})

stickers.get('/stickers', async (c) => {
  const db = c.env.DB, user = c.get('user').id
  const { results } = await db.prepare('SELECT p.manifest,m.added_at FROM sticker_memberships m JOIN sticker_packs p ON p.name=m.pack_name WHERE m.user_id=?1 ORDER BY m.added_at').bind(user).all<{ manifest: string; added_at: number }>()
  const { results: preferences } = await db.prepare('SELECT asset_id AS assetId,favorite,recent_at AS recentAt FROM sticker_preferences WHERE user_id=?1').bind(user).all()
  return c.json({ packs: results.map((r) => JSON.parse(r.manifest)), preferences })
})

stickers.post('/stickers/preview', async (c) => {
  const name = normalizeStickerPack((await jsonBody(c))?.link)
  if (!name) return c.json({ error: 'Use a Telegram addstickers link or a pack short name.' }, 400)
  const row = await ensurePackRow(c.env, name)
  await c.env.DB.prepare('INSERT INTO sticker_previews(user_id,pack_name,expires_at) VALUES(?1,?2,?3) ON CONFLICT(user_id,pack_name) DO UPDATE SET expires_at=excluded.expires_at').bind(c.get('user').id, name.toLowerCase(), Date.now() + 3600_000).run()
  const added = !!await c.env.DB.prepare('SELECT 1 FROM sticker_memberships WHERE user_id=?1 AND pack_name=?2').bind(c.get('user').id, name.toLowerCase()).first()
  return c.json({ pack: JSON.parse(row.manifest), added })
})

/** Small batches respect the Worker's upstream-request budget, including animated files. */
stickers.post('/stickers/packs/:name/load', async (c) => {
  const name = normalizeStickerPack(c.req.param('name'))
  if (!name) return c.json({ error: 'Invalid pack.' }, 400)
  const user = c.get('user').id, db = c.env.DB
  const grant = await db.prepare('SELECT 1 FROM sticker_previews WHERE user_id=?1 AND pack_name=?2 AND expires_at>?3 UNION SELECT 1 FROM sticker_memberships WHERE user_id=?1 AND pack_name=?2').bind(user, name.toLowerCase(), Date.now()).first()
  if (!grant) return c.json({ error: 'Open the pack preview first.' }, 403)
  const row = await packRow(db, name)
  if (!row) return c.json({ error: 'Pack not found.' }, 404)
  const body = await jsonBody(c), offset = body?.offset, count = body?.count ?? 6
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 199) return c.json({ error: 'Invalid sticker range.' }, 400)
  // Older clients omit count and load six; newer ones ask for smaller steps so artwork appears steadily.
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 6) return c.json({ error: 'Invalid sticker range.' }, 400)
  const pack = JSON.parse(row.manifest) as StickerPack, raw = JSON.parse(row.upstream) as TelegramSticker[]
  let next = offset, failure: unknown
  const worker = async () => {
    while (!failure && next < Math.min(offset + count, pack.stickers.length)) {
      const i = next++
      const s = pack.stickers[i]
      if (s.available && !s.animationError) continue
      try {
        // A ready sticker whose animation failed earlier retries only its animation.
        if (s.available) await storeTelegramAnimation(c.env, s, raw[i], user)
        else await storeTelegramSticker(c.env, s, raw[i], user)
        s.available = true
        delete s.error
      } catch (e) {
        if (e instanceof TelegramError && e.retryAfter) { failure = e; return }
        s.error = e instanceof TelegramError ? e.message : 'This sticker could not be prepared. Retry.'
      }
      // Only update this entry: simultaneous requests for other ranges cannot erase it.
      await db.prepare('UPDATE sticker_packs SET manifest=json_set(manifest,?1,json(?2)) WHERE name=?3').bind(`$.stickers[${i}]`, JSON.stringify(s), name.toLowerCase()).run()
    }
  }
  await Promise.all([worker(), worker()])
  if (failure) throw failure
  return c.json({ pack: JSON.parse((await packRow(db, name))!.manifest) })
})

stickers.post('/stickers/packs/:name', async (c) => {
  const name = normalizeStickerPack(c.req.param('name'))
  if (!name) return c.json({ error: 'Invalid pack.' }, 400)
  const db = c.env.DB, user = c.get('user').id
  const grant = await db.prepare('SELECT 1 FROM sticker_previews WHERE user_id=?1 AND pack_name=?2 AND expires_at>?3 UNION SELECT 1 FROM sticker_memberships WHERE user_id=?1 AND pack_name=?2').bind(user, name.toLowerCase(), Date.now()).first()
  if (!grant) return c.json({ error: 'Preview this pack before adding it.' }, 403)
  const row = await packRow(db, name)
  if (!row || !(JSON.parse(row.manifest) as StickerPack).stickers.some((s) => s.available)) return c.json({ error: 'No usable stickers yet. Retry loading the pack.' }, 409)
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO sticker_memberships(user_id,pack_name,added_at) VALUES(?1,?2,?3)').bind(user, name.toLowerCase(), Date.now()),
    // Adding a suggested pack answers its suggestion.
    db.prepare('DELETE FROM telegram_pending WHERE user_id=?1 AND lower(pack_name)=?2').bind(user, name.toLowerCase()),
    db.prepare('DELETE FROM telegram_suggestions WHERE user_id=?1 AND pack_key=?2').bind(user, name.toLowerCase()),
  ])
  return c.json({ pack: JSON.parse(row.manifest) })
})
stickers.delete('/stickers/packs/:name', async (c) => {
  const name = normalizeStickerPack(c.req.param('name'))
  if (!name) return c.json({ error: 'Invalid pack.' }, 400)
  await c.env.DB.prepare('DELETE FROM sticker_memberships WHERE user_id=?1 AND pack_name=?2').bind(c.get('user').id, name.toLowerCase()).run()
  // Keep assets, preferences and previews: placed/trashed/undoable objects retain their bytes.
  return c.json({ ok: true })
})
stickers.post('/stickers/preferences/:assetId', async (c) => {
  const assetId = c.req.param('assetId'), db = c.env.DB, user = c.get('user').id
  const member = await db.prepare("SELECT 1 FROM sticker_memberships m JOIN sticker_assets a ON a.pack_name=m.pack_name WHERE m.user_id=?1 AND a.asset_id=?2 AND a.available=1").bind(user, assetId).first()
  if (!member) return c.json({ error: 'Add the sticker pack first.' }, 403)
  const body = await jsonBody(c)
  if (!body || Object.keys(body).some((k) => !['favorite', 'recent'].includes(k)) || ('favorite' in body && typeof body.favorite !== 'boolean') || ('recent' in body && body.recent !== true)) return c.json({ error: 'Invalid sticker preference.' }, 400)
  await db.prepare('INSERT OR IGNORE INTO sticker_preferences(user_id,asset_id) VALUES(?1,?2)').bind(user, assetId).run()
  if ('favorite' in body) await db.prepare('UPDATE sticker_preferences SET favorite=?1 WHERE user_id=?2 AND asset_id=?3').bind(body.favorite ? 1 : 0, user, assetId).run()
  if (body.recent) await db.prepare('UPDATE sticker_preferences SET recent_at=?1 WHERE user_id=?2 AND asset_id=?3').bind(Date.now(), user, assetId).run()
  return c.json({ ok: true })
})

stickers.get('/stickers/telegram', async (c) => {
  const db = c.env.DB, user = c.get('user').id
  const pair = await db.prepare('SELECT label FROM telegram_pairs WHERE user_id=?1').bind(user).first()
  const challenge = await db.prepare('SELECT expires_at AS expiresAt,telegram_id AS telegramId,label FROM telegram_challenges WHERE user_id=?1').bind(user).first()
  const pending = await db.prepare('SELECT t.pack_name AS packName,p.title,t.notice,t.updated_at AS updatedAt FROM telegram_pending t LEFT JOIN sticker_packs p ON p.name=lower(t.pack_name) WHERE t.user_id=?1').bind(user).first()
  // Newest first; packs already in the collection are not suggested.
  const { results: suggestions } = await db.prepare('SELECT s.pack_name AS packName,p.title,s.received_at AS receivedAt FROM telegram_suggestions s LEFT JOIN sticker_packs p ON p.name=s.pack_key WHERE s.user_id=?1 AND NOT EXISTS (SELECT 1 FROM sticker_memberships m WHERE m.user_id=s.user_id AND m.pack_name=s.pack_key) ORDER BY s.received_at DESC, s.rowid DESC LIMIT 20').bind(user).all()
  return c.json({ configured: !!(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_BOT_USERNAME && c.env.TELEGRAM_WEBHOOK_SECRET), pair, challenge, pending, suggestions })
})
stickers.post('/stickers/telegram/challenge', async (c) => {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_WEBHOOK_SECRET || !/^[a-zA-Z0-9_]{5,32}$/.test(c.env.TELEGRAM_BOT_USERNAME ?? '')) return c.json({ error: 'The Telegram bot is not configured on this server. You can still paste a pack link when imports are configured.' }, 503)
  if (await c.env.DB.prepare('SELECT 1 FROM telegram_pairs WHERE user_id=?1').bind(c.get('user').id).first()) return c.json({ error: 'Disconnect the current Telegram account before reconnecting.' }, 409)
  const token = randomToken(24), expiresAt = Date.now() + 5 * 60_000
  await c.env.DB.prepare('INSERT INTO telegram_challenges(token_hash,user_id,expires_at) VALUES(?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,telegram_id=NULL,label=NULL').bind(await sha256Hex(token), c.get('user').id, expiresAt).run()
  return c.json({ url: `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}`, expiresAt })
})
stickers.post('/stickers/telegram/confirm', async (c) => {
  const user = c.get('user').id, db = c.env.DB, body = await jsonBody(c)
  if (typeof body?.telegramId !== 'string') return c.json({ error: 'Choose the incoming Telegram account.' }, 400)
  const used = await db.prepare('SELECT user_id FROM telegram_pairs WHERE telegram_id=?1 AND user_id<>?2').bind(body.telegramId, user).first()
  if (used) return c.json({ error: 'That Telegram account is already connected. Disconnect it in the other DoggyNote account, or start again with the correct Telegram account.' }, 409)
  // Bind directly from the still-live challenge in SQL. Replays cannot replace an existing pair.
  const result = await db.prepare('INSERT INTO telegram_pairs(user_id,telegram_id,label) SELECT user_id,telegram_id,label FROM telegram_challenges WHERE user_id=?1 AND telegram_id=?2 AND expires_at>?3 ON CONFLICT(user_id) DO NOTHING').bind(user, body.telegramId, Date.now()).run()
  if (!result.meta.changes) return c.json({ error: 'This pairing expired or was already used. Start again.' }, 409)
  await db.prepare('DELETE FROM telegram_challenges WHERE user_id=?1').bind(user).run()
  return c.json({ ok: true })
})
stickers.delete('/stickers/telegram/challenge', async (c) => {
  await c.env.DB.prepare('DELETE FROM telegram_challenges WHERE user_id=?1').bind(c.get('user').id).run()
  return c.json({ ok: true })
})
stickers.delete('/stickers/telegram', async (c) => {
  await c.env.DB.batch(['telegram_pairs', 'telegram_challenges', 'telegram_pending', 'telegram_suggestions'].map((table) => c.env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?1`).bind(c.get('user').id)))
  return c.json({ ok: true })
})
stickers.delete('/stickers/telegram/suggestions/:name', async (c) => {
  const name = normalizeStickerPack(c.req.param('name'))
  if (!name) return c.json({ error: 'Invalid pack.' }, 400)
  const user = c.get('user').id
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM telegram_suggestions WHERE user_id=?1 AND pack_key=?2').bind(user, name.toLowerCase()),
    c.env.DB.prepare('DELETE FROM telegram_pending WHERE user_id=?1 AND lower(pack_name)=?2').bind(user, name.toLowerCase()),
  ])
  return c.json({ ok: true })
})
stickers.delete('/stickers/telegram/pending', async (c) => {
  await c.env.DB.prepare('DELETE FROM telegram_pending WHERE user_id=?1').bind(c.get('user').id).run()
  return c.json({ ok: true })
})

/** Public webhook authenticates independently from app sessions; private chats only. */
export const telegramWebhook = new Hono<AppEnv>()
telegramWebhook.post('/telegram/webhook', async (c) => {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET, supplied = c.req.header('x-telegram-bot-api-secret-token')
  if (!secret || !supplied || await sha256Hex(secret) !== await sha256Hex(supplied)) return c.json({ error: 'Forbidden' }, 403)
  if (Number(c.req.header('content-length')) > 32_768) return c.json({ error: 'Too large' }, 413)
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(await boundedBytes(new Response(c.req.raw.body), 32_768))) } catch { return c.json({ error: 'Invalid or oversized update' }, 400) }
  const u = (value ?? {}) as { update_id?: number; message?: { from?: { id?: number; username?: string; first_name?: string; is_bot?: boolean }; chat?: { id?: number; type?: string }; text?: string; sticker?: { set_name?: string } } }
  const msg = u.message, from = msg?.from
  if (!Number.isSafeInteger(u.update_id) || u.update_id! < 0 || !from || !Number.isSafeInteger(from.id) || from.id! <= 0 || from.is_bot || msg?.chat?.type !== 'private' || msg.chat.id !== from.id) return c.json({ ok: true })
  const db = c.env.DB
  const statements: D1PreparedStatement[] = []
  // All effects and the replay marker commit together, guarded by the update id.
  const fresh = 'NOT EXISTS (SELECT 1 FROM telegram_updates WHERE id=?4)'
  const start = /^\/start ([a-zA-Z0-9_-]{20,64})$/.exec(msg.text ?? '')
  if (start) {
    const label = `@${typeof from.username === 'string' ? from.username.slice(0, 32) : `${String(from.first_name ?? 'Telegram').slice(0, 64)} (${from.id})`}`
    statements.push(db.prepare(`UPDATE telegram_challenges SET telegram_id=?1,label=?2 WHERE token_hash=?3 AND ${fresh} AND expires_at>?5 AND telegram_id IS NULL`).bind(String(from.id), label, await sha256Hex(start[1]), u.update_id, Date.now()))
  } else if (msg.sticker) {
    const name = normalizeStickerPack(msg.sticker.set_name)
    // Cache the pack's title before saving, so the app shows its real name from the start.
    // Metadata only (no files, no messages); a Telegram failure leaves the short name.
    if (name && await db.prepare(`SELECT 1 FROM telegram_pairs WHERE telegram_id=?1 AND NOT EXISTS (SELECT 1 FROM telegram_updates WHERE id=?2)`).bind(String(from.id), u.update_id).first()) await ensurePackRow(c.env, name).catch(() => {})
    statements.push(db.prepare(`INSERT INTO telegram_pending(user_id,pack_name,notice,updated_at) SELECT user_id,?1,?2,?3 FROM telegram_pairs WHERE ${fresh} AND telegram_id=?5 ON CONFLICT(user_id) DO UPDATE SET pack_name=excluded.pack_name,notice=excluded.notice,updated_at=excluded.updated_at WHERE COALESCE(telegram_pending.pack_name,'')<>COALESCE(excluded.pack_name,'') OR COALESCE(telegram_pending.notice,'')<>COALESCE(excluded.notice,'')`).bind(name, name ? null : 'This sticker has no pack information. Paste a Telegram pack link instead.', Date.now(), u.update_id, String(from.id)))
    // Each pack stays suggested until added or dismissed; sending it again moves it to the top.
    if (name) statements.push(db.prepare(`INSERT INTO telegram_suggestions(user_id,pack_key,pack_name,received_at) SELECT user_id,?1,?2,?3 FROM telegram_pairs WHERE ${fresh} AND telegram_id=?5 AND NOT EXISTS (SELECT 1 FROM sticker_memberships m WHERE m.user_id=telegram_pairs.user_id AND m.pack_name=?1) ON CONFLICT(user_id,pack_key) DO UPDATE SET received_at=excluded.received_at`).bind(name.toLowerCase(), name, Date.now(), u.update_id, String(from.id)))
  }
  statements.push(db.prepare('INSERT OR IGNORE INTO telegram_updates(id,received_at) VALUES(?1,?2)').bind(u.update_id, Date.now()))
  const results = await db.batch(statements)
  // Telegram can invoke a Bot API method from the webhook's JSON response.
  // Reply only after the atomic replay marker commits; delivery is best effort,
  // while pairing/import state remains authoritative in the authenticated app.
  if (!results.at(-1)?.meta.changes) return c.json({ ok: true })
  const reply = (kind: keyof typeof COPY.telegramBot) => {
    const choices = COPY.telegramBot[kind], text = choices[Math.floor(Math.random() * choices.length)]
    return c.json({ method: 'sendMessage', chat_id: from.id, text, disable_notification: true })
  }
  const command = typeof msg.text === 'string' && /^\/(start|help)(?:\s|$)/.exec(msg.text)
  if (start && results[0].meta.changes) return reply('confirm')
  if (command || msg.sticker) {
    const paired = await db.prepare('SELECT 1 FROM telegram_pairs WHERE telegram_id=?1').bind(String(from.id)).first()
    if (command) {
      if (paired) return reply('connected')
      if (command[1] === 'start' && msg.text!.trim() !== '/start') return reply('expired')
    } else if (paired) {
      // Repeated sends of the same pending pack/notice do not produce more notices.
      if (!results[0].meta.changes) return c.json({ ok: true })
      return reply(normalizeStickerPack(msg.sticker!.set_name) ? 'received' : 'missing')
    }
    const awaitingConfirmation = await db.prepare('SELECT 1 FROM telegram_challenges WHERE telegram_id=?1 AND expires_at>?2').bind(String(from.id), Date.now()).first()
    return reply(awaitingConfirmation ? 'confirm' : 'connect')
  }
  // No unsolicited messages or conversational replies outside pairing/import.
  return c.json({ ok: true })
})
