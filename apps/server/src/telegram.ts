import { normalizeStickerPack, type StickerAsset } from '@doggynote/core'
import type { Env } from './env.ts'

export type PackSticker = StickerAsset & { available: boolean; error?: string; animationError?: string; keywords?: string[] }
export type StickerPack = { name: string; title: string; stickers: PackSticker[] }
export type TelegramSticker = { file_id: string; file_unique_id: string; width: number; height: number; emoji?: string; is_animated?: boolean; is_video?: boolean; thumbnail?: { file_id: string }; keywords?: string[] }
export class TelegramError extends Error {
  constructor(message: string, public retryAfter = 0, public status = 502) { super(message) }
}

/** Read incrementally: upstream content-length is neither required nor trusted. */
export async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok) throw new TelegramError('Telegram could not deliver this asset. Try again.')
  if (Number(response.headers.get('content-length')) > limit) throw new TelegramError('This sticker exceeds the download limit.')
  const reader = response.body?.getReader()
  if (!reader) throw new TelegramError('Telegram returned an empty response.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit) throw new TelegramError('This sticker exceeds the download limit.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

/** URLs containing credentials exist only in this module; all errors are deliberately generic. */
export async function telegramCall(env: Env, method: 'getStickerSet' | 'getFile', body: Record<string, string>): Promise<unknown> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new TelegramError('Telegram imports are not configured. Ask the server owner to configure the sticker bot.', 0, 503)
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(12_000) })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (env.DEV_DIAG === '1') {
      const message = e instanceof Error ? e.message : ''
      console.log('[telegram transport category]', JSON.stringify({ type: name, redirect: /redirect/i.test(message), certificate: /certificate|TLS|SSL/i.test(message), abort: /abort/i.test(message), network: /network|fetch|connect/i.test(message) }))
    }
    throw new TelegramError(name === 'TimeoutError' || name === 'AbortError' ? 'Telegram timed out. Please try again.' : 'Telegram could not be reached securely. Please try again.')
  }
  if (response.status >= 300 && response.status < 400) throw new TelegramError('Telegram returned an unexpected redirect. Try again later.')
  const data = JSON.parse(new TextDecoder().decode(await boundedBytes(new Response(response.body, { status: 200, headers: response.headers }), 1024 * 1024))) as { ok?: boolean; result?: unknown; error_code?: number; parameters?: { retry_after?: number } }
  if (response.status === 429 || data.error_code === 429) throw new TelegramError('Telegram is busy. Please wait before retrying.', Math.min(3600, Math.max(1, Number(data.parameters?.retry_after) || 30)), 429)
  if (!response.ok || data.ok !== true) throw new TelegramError(method === 'getStickerSet' ? 'That pack could not be found. Check its link and try again.' : 'This sticker is temporarily unavailable.', 0, method === 'getStickerSet' ? 404 : 502)
  return data.result
}

export function packFromTelegram(value: unknown, name: string): { pack: StickerPack; upstream: TelegramSticker[] } {
  const set = value as { name?: unknown; title?: unknown; stickers?: unknown[] }
  if (!set || typeof set.title !== 'string' || !set.title.length || set.title.length > 128 || typeof set.name !== 'string' || normalizeStickerPack(set.name)?.toLowerCase() !== name.toLowerCase() || !Array.isArray(set.stickers) || !set.stickers.length || set.stickers.length > 200) throw new TelegramError('Telegram returned an invalid or oversized pack.')
  const upstream = set.stickers.map((value) => {
    const s = value as TelegramSticker
    if (!s || typeof s.file_id !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(s.file_id) || typeof s.file_unique_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(s.file_unique_id) || ![s.width, s.height].every((n) => Number.isInteger(n) && n >= 1 && n <= 512) || s.width / s.height > 16 || s.height / s.width > 16) throw new TelegramError('Telegram returned invalid sticker metadata.')
    return s
  })
  return { pack: { name: set.name, title: set.title, stickers: upstream.map((s) => ({ assetId: crypto.randomUUID(), stickerId: s.file_unique_id, packName: set.name as string, emoji: typeof s.emoji === 'string' ? s.emoji.slice(0, 64) : '', width: s.width, height: s.height, format: s.is_animated ? 'tgs' : s.is_video ? 'webm' : 'static', available: false, keywords: Array.isArray(s.keywords) ? s.keywords.filter((k) => typeof k === 'string').slice(0, 20).map((k) => k.slice(0, 64)) : [] })) }, upstream }
}

async function download(env: Env, fileId: string, limit: number): Promise<Uint8Array> {
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(fileId)) throw new TelegramError('Invalid Telegram file identifier.')
  const file = await telegramCall(env, 'getFile', { file_id: fileId }) as { file_path?: string; file_size?: number }
  if (typeof file.file_path !== 'string' || !/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(file.file_path) || file.file_path.split('/').includes('..') || Number(file.file_size) > limit) throw new TelegramError('Telegram returned an invalid or oversized file.')
  try {
    const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(12_000), redirect: 'manual' })
    return await boundedBytes(response, limit)
  } catch { throw new TelegramError('Sticker download failed. Try again.') }
}

export function stillType(bytes: Uint8Array): string | null {
  if (bytes.length < 30) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => new TextDecoder().decode(bytes.slice(offset, offset + 4))
  let w = 0, h = 0, type: string | null = null
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP' && view.getUint32(4, true) === bytes.length - 8) {
    type = 'image/webp'
    if (tag(12) === 'VP8X') {
      w = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      h = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    } else if (tag(12) === 'VP8L' && bytes[20] === 0x2f) {
      w = 1 + ((bytes[21] | bytes[22] << 8) & 0x3fff)
      h = 1 + ((bytes[22] >> 6 | bytes[23] << 2 | bytes[24] << 10) & 0x3fff)
    } else if (tag(12) === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      w = view.getUint16(26, true) & 0x3fff; h = view.getUint16(28, true) & 0x3fff
    }
  } else if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) && tag(12) === 'IHDR') {
    type = 'image/png'; w = view.getUint32(16); h = view.getUint32(20)
  }
  return w >= 1 && h >= 1 && w <= 512 && h <= 512 ? type : null
}

/** A real Telegram TGS (64 KB gzipped) decompresses to a few hundred thousand JSON values. */
const ANIMATION_NODES = 500_000, ANIMATION_DEPTH = 64

/** Bounded shape-only Lottie; reject external media, fonts, text and deep payloads. */
export function validStickerAnimation(value: unknown): boolean {
  const a = value as { fr?: number; ip?: number; op?: number; w?: number; h?: number; assets?: unknown[]; layers?: unknown[]; fonts?: unknown; chars?: unknown }
  if (!a || !Number.isFinite(a.fr) || a.fr! < 1 || a.fr! > 60 || !Number.isFinite(a.ip) || !Number.isFinite(a.op) || a.op! <= a.ip! || (a.op! - a.ip!) / a.fr! > 3 || a.w !== 512 || a.h !== 512 || !Array.isArray(a.layers) || a.layers.length > 100 || !Array.isArray(a.assets ?? []) || (a.assets?.length ?? 0) > 50 || a.fonts || a.chars) return false
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { value: node, depth } = stack.pop()!
    if (depth > ANIMATION_DEPTH || ++count > ANIMATION_NODES) return false
    if (!node || typeof node !== 'object') continue
    for (const [key, child] of Object.entries(node)) {
      if (++count > ANIMATION_NODES) return false
      if (['__proto__', 'constructor', 'prototype'].includes(key) || (['p', 'u', 'x'].includes(key) && typeof child === 'string') || (key === 'ty' && [2, 5, 6].includes(child as number))) return false
      if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 })
    }
  }
  return true
}

export async function storeTelegramSticker(env: Env, sticker: PackSticker, raw: TelegramSticker, userId: string) {
  // Telegram supplies transparent WEBP thumbnails for animated/video stickers.
  // A missing or invalid still is an explicit unavailable sticker, never a black box.
  const stillFile = sticker.format === 'static' ? raw.file_id : raw.thumbnail?.file_id
  if (!stillFile) throw new TelegramError('No transparent still is available for this sticker. Retry later.')
  const still = await download(env, stillFile, 1024 * 1024)
  const mime = stillType(still)
  if (!mime) throw new TelegramError('Telegram did not provide a supported transparent still.')
  await env.BUCKET.put(`${sticker.assetId}/thumb`, still, { httpMetadata: { contentType: mime } })
  await env.DB.prepare('INSERT OR IGNORE INTO assets(id,size,mime,bytes,created_by,created_at) VALUES(?1,?2,?3,?4,?5,?6)').bind(sticker.assetId, 'thumb', mime, still.length, userId, Date.now()).run()
  // Keep original animation only after a usable still exists.
  await storeTelegramAnimation(env, sticker, raw, userId)
}

/** Playback validation occurs before storage; malformed/unbounded Lottie never reaches a renderer.
 * A failure leaves the still and records `animationError`, which a later load retries. */
export async function storeTelegramAnimation(env: Env, sticker: PackSticker, raw: TelegramSticker, userId: string) {
  if (sticker.format !== 'static') {
    try {
      const original = await download(env, raw.file_id, sticker.format === 'tgs' ? 256 * 1024 : 1024 * 1024)
      let body: Uint8Array = original, contentType = 'video/webm'
      if (sticker.format === 'tgs') {
        const stream = new Blob([original.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'))
        body = await boundedBytes(new Response(stream), 2 * 1024 * 1024)
        const animation: unknown = JSON.parse(new TextDecoder().decode(body))
        if (!validStickerAnimation(animation)) throw new TelegramError('This animation exceeds the supported playback limits.')
        contentType = 'application/json'
      } else if (original[0] !== 0x1a || original[1] !== 0x45 || original[2] !== 0xdf || original[3] !== 0xa3) throw new TelegramError('Invalid video sticker.')
      await env.BUCKET.put(`${sticker.assetId}/full`, body, { httpMetadata: { contentType } })
      await env.DB.prepare('INSERT OR IGNORE INTO assets(id,size,mime,bytes,created_by,created_at) VALUES(?1,?2,?3,?4,?5,?6)').bind(sticker.assetId, 'full', contentType, body.length, userId, Date.now()).run()
      delete sticker.animationError
    } catch (e) {
      if (e instanceof TelegramError && e.retryAfter) throw e
      sticker.animationError = e instanceof TelegramError ? e.message : 'Animation is unavailable; a still is ready.'
    }
  }
}
