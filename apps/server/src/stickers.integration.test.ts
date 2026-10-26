import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { app } from './app.ts'
import { sha256Hex } from './crypto.ts'
import { boundedBytes, packFromTelegram, stillType, telegramCall, validStickerAnimation } from './telegram.ts'
import type { Env } from './env.ts'

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  for (const id of ['rex', 'fido']) {
    sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(id, id, 'unused', 0, 1)
    sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex(id), id, 1, Date.now() + 3600000)
  }
  for (const [id, user] of [['root', 'rex'], ['elsewhere', 'fido'], ['toybox:rex', 'rex']]) {
    const data = { id, kind: 'board', title: id, parentId: null, icon: 'paw', color: 'gold', createdAt: 1 }
    sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at,owner_id) VALUES(?,'board',?,1,1,?)").run(id, JSON.stringify(data), id.startsWith('toybox:') ? user : null)
    sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(id, user)
  }
  const db = {
    prepare(source: string) {
      let args: unknown[] = []
      const statement = {
        bind(...values: unknown[]) { args = values; return statement },
        query() {
          const values: unknown[] = []
          const text = source.replace(/\?(\d+)/g, (_, n: string) => { values.push(args[Number(n) - 1]); return '?' })
          return { query: sql.prepare(text), values: values as (string | number | null)[] }
        },
        async all() { const { query, values } = statement.query(); return { results: query.all(...values) } },
        async first() { const { query, values } = statement.query(); return query.get(...values) ?? null },
        async run() { const { query, values } = statement.query(); const r = query.run(...values); return { success: true, meta: { changes: Number(r.changes) } } },
      }
      return statement
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      sql.exec('BEGIN')
      try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result } catch (e) { sql.exec('ROLLBACK'); throw e }
    },
  } as unknown as D1Database
  const objects = new Map<string, { bytes: Uint8Array; type: string }>()
  const bucket = {
    put: async (key: string, bytes: Uint8Array, opts: { httpMetadata: { contentType: string } }) => objects.set(key, { bytes, type: opts.httpMetadata.contentType }),
    get: async (key: string) => { const o = objects.get(key); return o ? { body: o.bytes, httpEtag: 'fixture', writeHttpMetadata: (h: Headers) => h.set('content-type', o.type) } : null },
  } as unknown as R2Bucket
  const env: Env = { DB: db, BUCKET: bucket, TELEGRAM_BOT_TOKEN: 'never-expose-test-token', TELEGRAM_BOT_USERNAME: 'DoggyNoteTestBot', TELEGRAM_WEBHOOK_SECRET: 'fixture-webhook-secret' }
  const request = (path: string, body?: unknown, user = 'rex', method = body === undefined ? 'GET' : 'POST') => app.request(`/api${path}`, { method, headers: { authorization: `Bearer ${user}`, 'content-type': 'application/json', 'x-doggynote-protocol': '4' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  const hook = (body: unknown, secret = 'fixture-webhook-secret') => app.request('/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(body) }, env)
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
  const calls = vi.fn(async (url: string | URL | Request) => {
    const value = String(url)
    if (value.endsWith('/getStickerSet')) return Response.json({ ok: true, result: { name: 'Dogs', title: 'The dogs', stickers: [{ file_id: 'file_1', file_unique_id: 'unique_1', emoji: '🐶', width: 512, height: 512 }] } })
    if (value.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'stickers/dog.png', file_size: png.length } })
    return new Response(png)
  })
  vi.stubGlobal('fetch', calls)
  const imported = async () => {
    const result = await request('/stickers/preview', { link: 'https://t.me/addstickers/Dogs' })
    expect(result.status).toBe(200)
    expect((await request('/stickers/packs/Dogs/load', { offset: 0 })).status).toBe(200)
    const added = await request('/stickers/packs/Dogs', {})
    expect(added.status).toBe(200)
    return (await added.json() as { pack: { stickers: Record<string, unknown>[] } }).pack.stickers[0]
  }
  const placement = (s: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'placed', kind: 'sticker', boardId: 'root', x: 20, y: 40, w: 160, angle: 25, z: 1, createdAt: 1, content: Object.fromEntries(['assetId', 'stickerId', 'packName', 'emoji', 'width', 'height', 'format'].map((k) => [k, s[k]])), ...extra })
  const push = (patch: Record<string, unknown>, id = String(patch.id ?? 'placed'), user = 'rex') => request('/sync', { changes: [{ id, patch }] }, user)
  return { sql, db, env, calls, request, hook, imported, placement, push }
}
afterEach(() => vi.unstubAllGlobals())

/** Shaped like a real Telegram TGS: dozens of layers of keyframed paths, well over 30k JSON values. */
function heavyAnimation() {
  const keyframes = (n: number) => Array.from({ length: n }, (_, t) => ({ t: t * 3, i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] }, s: [{ c: true, i: [[0, 0], [-10, 4], [3, 9], [0, 0]], o: [[0, 0], [10, -4], [-3, -9], [0, 0]], v: [[t, 0], [40, t], [t, 80], [0, 40]] }] }))
  const layers = Array.from({ length: 40 }, (_, l) => ({ ty: 4, ind: l + 1, ip: 0, op: 90, st: 0, ks: { o: { a: 0, k: 100 }, p: { a: 0, k: [256, 256, 0] } },
    shapes: [{ ty: 'gr', it: [{ ty: 'gr', it: [{ ty: 'sh', ks: { a: 1, k: keyframes(30) } }, { ty: 'fl', c: { a: 0, k: [0.9, 0.6, 0.3, 1] }, o: { a: 0, k: 100 } }, { ty: 'tr', p: { a: 0, k: [0, 0] } }] }] }] }))
  return { v: '5.5.2', w: 512, h: 512, fr: 30, ip: 0, op: 90, assets: [], layers }
}

it('previews without membership, prepares controlled assets, adds idempotently, and retains placed bytes after removal', async () => {
  const f = await fixture()
  try {
    expect((await f.request('/stickers/preview', { link: 'https://evil.test/steal' })).status).toBe(400)
    expect(f.calls).not.toHaveBeenCalled()
    const p = await f.request('/stickers/preview', { link: 'Dogs' })
    expect(p.status).toBe(200)
    expect((await (await f.request('/stickers')).json() as { packs: unknown[] }).packs).toHaveLength(0)
    expect((await f.request('/stickers/packs/Dogs', {})).status).toBe(409)
    expect((await f.request('/stickers/packs/Dogs/load', { offset: -1 })).status).toBe(400)
    expect((await f.request('/stickers/packs/Dogs/load', { offset: 0 }, 'fido')).status).toBe(403)
    const sticker = await f.imported()
    expect((await f.request('/stickers/packs/Dogs', {})).status).toBe(200)
    expect(f.sql.prepare('SELECT COUNT(*) n FROM sticker_memberships').get()).toEqual({ n: 1 })
    expect((await f.push(f.placement(sticker))).status).toBe(200)
    expect((await f.request('/stickers/packs/Dogs', undefined, 'rex', 'DELETE')).status).toBe(200)
    expect((await f.request(`/assets/${sticker.assetId}/thumb`)).status).toBe(200)
    expect((await f.request(`/assets/${sticker.assetId}/thumb`, undefined, 'fido')).status).toBe(403)
    expect((await f.push({ angle: -30 })).status).toBe(200)
    expect((await f.request(`/stickers/preferences/${sticker.assetId}`, { favorite: true })).status).toBe(403)
  } finally { f.sql.close() }
})

it('enforces grants, private Inbox, share scope, provenance, malformed transforms and additive old-client patches', async () => {
  const f = await fixture()
  try {
    const s = await f.imported()
    expect((await f.push(f.placement(s, { boardId: 'elsewhere' }))).status).toBe(403)
    expect((await f.push(f.placement(s), 'placed', 'fido')).status).toBe(403)
    for (const extra of [{ w: -1 }, { angle: 181 }, { columnId: 'column' }, { x: 1e30 }, { content: { ...f.placement(s).content as object, assetId: crypto.randomUUID() } }]) expect((await f.push(f.placement(s, extra))).status).toBe(403)
    expect((await f.push(f.placement(s))).status).toBe(200)
    expect((await f.push({ title: 'An old reader saves a board', id: 'root' })).status).toBe(200)
    expect(JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='placed'").get() as { data: string }).data).angle).toBe(25)
    const shareRes = await f.request('/shares', { boardId: 'root', includeChildren: false })
    expect(shareRes.status).toBe(201)
    const token = (await shareRes.json() as { share: { token: string } }).share.token
    const shared = await f.request(`/share/${token}`, undefined, 'anonymous')
    expect((await shared.json() as { objects: { kind: string }[] }).objects.some((o) => o.kind === 'sticker')).toBe(true)
    expect((await f.request(`/assets/${s.assetId}/thumb?share=${token}`, undefined, 'anonymous')).status).toBe(200)
    expect((await f.push({ boardId: 'toybox:rex' })).status).toBe(200)
    expect((await f.request(`/assets/${s.assetId}/thumb?share=${token}`, undefined, 'anonymous')).status).toBe(403)
    expect((await f.request(`/assets/${s.assetId}/thumb`, undefined, 'fido')).status).toBe(403)
    const collection = await (await f.request('/stickers', undefined, 'fido')).json() as { packs: unknown[]; preferences: unknown[] }
    expect(collection).toEqual({ packs: [], preferences: [] })
  } finally { f.sql.close() }
})

it('updates favorites and recency independently across requests and devices', async () => {
  const f = await fixture()
  try {
    const s = await f.imported()
    expect((await f.request(`/stickers/preferences/${s.assetId}`, { favorite: true })).status).toBe(200)
    expect((await f.request(`/stickers/preferences/${s.assetId}`, { recent: true })).status).toBe(200)
    const prefs = (await (await f.request('/stickers')).json() as { preferences: { favorite: number; recentAt: number }[] }).preferences
    expect(prefs[0].favorite).toBe(1); expect(prefs[0].recentAt).toBeGreaterThan(0)
    expect((await f.request(`/stickers/preferences/${s.assetId}`, { favorite: false })).status).toBe(200)
    expect((f.sql.prepare('SELECT recent_at FROM sticker_preferences').get() as { recent_at: number }).recent_at).toBe(prefs[0].recentAt)
  } finally { f.sql.close() }
})

it('pairs only after authenticated confirmation; rejects replay, expiration and wrong-account theft; deduplicates bot imports', async () => {
  const f = await fixture()
  try {
    const challenge = await f.request('/stickers/telegram/challenge', {})
    const start = new URL((await challenge.json() as { url: string }).url).searchParams.get('start')!
    const message = { from: { id: 12345, username: 'test_rex' }, chat: { id: 12345, type: 'private' } }
    const update = { update_id: 1, message: { ...message, text: `/start ${start}` } }
    expect((await f.hook(update, 'wrong-secret')).status).toBe(403)
    expect((await f.hook(update)).status).toBe(200)
    expect(f.sql.prepare('SELECT 1 FROM telegram_pairs').get()).toBeUndefined()
    expect((await f.request('/stickers/telegram/confirm', { telegramId: '12345' }, 'fido')).status).toBe(409)
    expect((await f.request('/stickers/telegram/confirm', { telegramId: 'wrong' })).status).toBe(409)
    expect((await f.request('/stickers/telegram/confirm', { telegramId: '12345' })).status).toBe(200)
    expect((await f.request('/stickers/telegram/confirm', { telegramId: '12345' })).status).toBe(409)
    const send = { update_id: 2, message: { ...message, sticker: { set_name: 'Dogs' } } }
    expect((await f.hook(send)).status).toBe(200); expect((await f.hook(send)).status).toBe(200)
    expect(f.sql.prepare('SELECT pack_name FROM telegram_pending').get()).toEqual({ pack_name: 'Dogs' })
    expect(f.sql.prepare('SELECT COUNT(*) n FROM sticker_memberships').get()).toEqual({ n: 0 })
    await f.hook({ ...send, update_id: 3 })
    expect(f.sql.prepare('SELECT COUNT(*) n FROM telegram_pending').get()).toEqual({ n: 1 })
    await f.hook({ update_id: 4, message: { ...message, sticker: {} } })
    expect((f.sql.prepare('SELECT notice FROM telegram_pending').get() as { notice: string }).notice).toMatch(/no pack information/)
    await f.request('/stickers/telegram', undefined, 'rex', 'DELETE')
    await f.hook({ ...send, update_id: 5 })
    expect(f.sql.prepare('SELECT 1 FROM telegram_pending').get()).toBeUndefined()
    const second = await f.request('/stickers/telegram/challenge', {})
    const secondStart = new URL((await second.json() as { url: string }).url).searchParams.get('start')!
    f.sql.exec('UPDATE telegram_challenges SET expires_at=0')
    await f.hook({ update_id: 6, message: { ...message, text: `/start ${secondStart}` } })
    expect((await f.request('/stickers/telegram/confirm', { telegramId: '12345' })).status).toBe(409)
    expect((await f.request('/stickers/telegram/challenge', undefined, 'rex', 'DELETE')).status).toBe(200)
  } finally { f.sql.close() }
})

it('acknowledges pairing and import with private webhook replies, while retries and unchanged suggestions stay quiet', async () => {
  const f = await fixture()
  try {
    const sender = { from: { id: 12345, username: 'test_rex' }, chat: { id: 12345, type: 'private' } }
    let id = 100
    const send = async (message: object) => {
      const update = { update_id: id++, message: { ...sender, ...message } }
      const response = await f.hook(update)
      expect(response.status).toBe(200)
      return { update, body: await response.json() }
    }
    const random = vi.spyOn(Math, 'random')
    try {
      random.mockReturnValue(0)
      const first = await send({ text: '/start' })
      random.mockReturnValue(0.999)
      const second = await send({ text: '/start' })
      for (const result of [first, second]) expect(result.body).toMatchObject({ method: 'sendMessage', chat_id: 12345, disable_notification: true, text: expect.stringContaining('use its connection link') })
      expect((first.body as { text: string }).text).not.toBe((second.body as { text: string }).text)
    } finally { random.mockRestore() }
    const challenge = await (await f.request('/stickers/telegram/challenge', {})).json() as { url: string }
    const token = new URL(challenge.url).searchParams.get('start')!
    const accepted = await send({ text: `/start ${token}` })
    expect(accepted.body).toMatchObject({ method: 'sendMessage', text: expect.stringContaining('confirm your Telegram account') })
    expect(JSON.stringify(accepted.body)).not.toContain(token)
    expect(f.sql.prepare('SELECT 1 FROM telegram_pairs').get()).toBeUndefined()
    expect(await (await f.hook(accepted.update)).json()).toEqual({ ok: true })
    expect((await send({ sticker: { set_name: 'Dogs' } })).body).toMatchObject({ text: expect.stringContaining('confirm your Telegram account') })
    expect(f.sql.prepare('SELECT 1 FROM telegram_pending').get()).toBeUndefined()
    expect((await f.request('/stickers/telegram/confirm', { telegramId: '12345' })).status).toBe(200)
    expect((await send({ text: '/help' })).body).toMatchObject({ text: expect.stringContaining('Connected to DoggyNote') })
    const sticker = await send({ sticker: { set_name: 'Dogs' } })
    expect(sticker.body).toMatchObject({ method: 'sendMessage', chat_id: 12345, text: expect.stringContaining('preview its pack and choose Add pack') })
    expect(await (await f.hook(sticker.update)).json()).toEqual({ ok: true })
    const pending = f.sql.prepare('SELECT * FROM telegram_pending').get()
    expect((await send({ sticker: { set_name: 'Dogs' } })).body).toEqual({ ok: true })
    expect(f.sql.prepare('SELECT * FROM telegram_pending').get()).toEqual(pending)
    expect((await send({ sticker: {} })).body).toMatchObject({ text: expect.stringContaining('paste a Telegram pack link') })
    expect((await send({ sticker: {} })).body).toEqual({ ok: true })
    expect(f.sql.prepare('SELECT COUNT(*) n FROM sticker_memberships').get()).toEqual({ n: 0 })
    await f.request('/stickers/telegram', undefined, 'rex', 'DELETE')
    expect((await send({ sticker: { set_name: 'Dogs' } })).body).toMatchObject({ text: expect.stringContaining('use its connection link') })
    expect(f.sql.prepare('SELECT 1 FROM telegram_pending').get()).toBeUndefined()
    // Webhooks never send messages or fetch files; a new suggestion only caches its pack's title once.
    expect(f.calls.mock.calls.map(([url]) => String(url).split('/').pop())).toEqual(['getStickerSet'])
  } finally { f.sql.close() }
})

it('names a suggestion by its pack title and clears it once that pack is added', async () => {
  const f = await fixture()
  try {
    const sender = { from: { id: 12345, username: 'test_rex' }, chat: { id: 12345, type: 'private' } }
    f.sql.exec("INSERT INTO telegram_pairs(user_id,telegram_id,label) VALUES('rex','12345','@test_rex')")
    expect((await f.hook({ update_id: 900, message: { ...sender, sticker: { set_name: 'Dogs' } } })).status).toBe(200)
    const status = async () => (await (await f.request('/stickers/telegram')).json() as { pending: { packName: string; title: string | null } | null }).pending
    expect(await status()).toMatchObject({ packName: 'Dogs', title: 'The dogs' })
    expect(f.sql.prepare('SELECT COUNT(*) n FROM sticker_memberships').get()).toEqual({ n: 0 })
    // A Telegram failure leaves the short name as the fallback rather than failing the webhook.
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    expect((await f.hook({ update_id: 901, message: { ...sender, sticker: { set_name: 'Cats' } } })).status).toBe(200)
    expect(await status()).toMatchObject({ packName: 'Cats', title: null })
    vi.stubGlobal('fetch', f.calls)
    expect((await f.hook({ update_id: 902, message: { ...sender, sticker: { set_name: 'Dogs' } } })).status).toBe(200)
    await f.imported()
    expect(await status()).toBeNull()
  } finally { f.sql.close() }
})

it('keeps webhook replies scoped to valid private pairing/import updates and explains unusable challenges', async () => {
  const f = await fixture()
  try {
    const sender = { from: { id: 12345 }, chat: { id: 12345, type: 'private' } }
    const update = { update_id: 200, message: { ...sender, text: '/start' } }
    expect((await f.hook(update, 'wrong-secret')).status).toBe(403)
    for (const message of [
      { ...sender, chat: { id: 12345, type: 'group' } },
      { ...sender, chat: { id: 999, type: 'private' } },
      { ...sender, from: { id: 12345, is_bot: true } },
      { from: { id: 0 }, chat: { id: 0, type: 'private' } },
      { from: { id: -1 }, chat: { id: -1, type: 'private' } },
    ]) expect(await (await f.hook({ ...update, message: { ...message, text: '/start' } })).json()).toEqual({ ok: true })
    expect(f.sql.prepare('SELECT 1 FROM telegram_updates').get()).toBeUndefined()
    expect(await (await f.hook({ ...update, message: { ...sender, text: 'hello' } })).json()).toEqual({ ok: true })
    const challenge = await (await f.request('/stickers/telegram/challenge', {})).json() as { url: string }
    const token = new URL(challenge.url).searchParams.get('start')!
    f.sql.exec('UPDATE telegram_challenges SET expires_at=0')
    const expired = await f.hook({ update_id: 201, message: { ...sender, text: `/start ${token}` } })
    expect(await expired.json()).toMatchObject({ method: 'sendMessage', chat_id: 12345, text: expect.stringContaining('unavailable or expired') })
    expect(f.sql.prepare('SELECT telegram_id FROM telegram_challenges').get()).toEqual({ telegram_id: null })
    expect(await (await f.hook({ update_id: 202, message: { ...sender, text: '/start malformed' } })).json()).toMatchObject({ text: expect.stringContaining('start again') })
    const fresh = await (await f.request('/stickers/telegram/challenge', {})).json() as { url: string }
    const freshToken = new URL(fresh.url).searchParams.get('start')!
    await f.hook({ update_id: 203, message: { ...sender, text: `/start ${freshToken}` } })
    const forwarded = await f.hook({ update_id: 204, message: { from: { id: 54321 }, chat: { id: 54321, type: 'private' }, text: `/start ${freshToken}` } })
    expect(await forwarded.json()).toMatchObject({ chat_id: 54321, text: expect.stringContaining('unavailable or expired') })
    expect(f.sql.prepare('SELECT telegram_id FROM telegram_challenges').get()).toEqual({ telegram_id: '12345' })
    expect(f.calls).not.toHaveBeenCalled()
  } finally { f.sql.close() }
})

it('bounds upstream resources, handles rate limits, invalid files and secret-free errors', async () => {
  const f = await fixture()
  try {
    const rate = vi.fn(async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 17 } }, { status: 429 }))
    vi.stubGlobal('fetch', rate)
    const response = await f.request('/stickers/preview', { link: 'Dogs' })
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('17')
    expect(await response.text()).not.toContain(f.env.TELEGRAM_BOT_TOKEN)
    vi.stubGlobal('fetch', async () => { throw new Error(`https://api.telegram.org/bot${f.env.TELEGRAM_BOT_TOKEN}/getFile`) })
    await expect(telegramCall(f.env, 'getFile', { file_id: 'test' })).rejects.toThrow('could not be reached securely')
    await expect(boundedBytes(new Response(new Uint8Array(20)), 10)).rejects.toThrow('limit')
    expect(stillType(new TextEncoder().encode('<svg onload="evil"/>'))).toBeNull()
    expect(() => packFromTelegram({ name: 'Dogs', title: 'Bad', stickers: [{ file_id: '../evil', file_unique_id: 'bad', width: 1, height: 1 }] }, 'Dogs')).toThrow('invalid')
    expect(() => packFromTelegram({ name: 'Dogs', title: 'Bad', stickers: Array(201).fill({}) }, 'Dogs')).toThrow('oversized')
  } finally { f.sql.close() }
})


it('rejects redirects without following them, and bounds shape-only animation playback', async () => {
  const f = await fixture()
  try {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 302, headers: { location: 'https://unrelated.example/file' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(telegramCall(f.env, 'getStickerSet', { name: 'Dogs' })).rejects.toThrow('unexpected redirect')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
    const animation = { w: 512, h: 512, fr: 30, ip: 0, op: 60, assets: [], layers: [{ ty: 4, shapes: [{ ty: 'el', p: { k: [256, 256] } }] }] }
    expect(validStickerAnimation(animation)).toBe(true)
    for (const bad of [{ ...animation, fr: 300 }, { ...animation, op: 1000 }, { ...animation, fonts: {} }, { ...animation, assets: [{ p: 'https://evil.example/p.png' }] }, { ...animation, layers: [{ ty: 5 }] }, { ...animation, layers: [{ x: 'expression' }] }]) expect(validStickerAnimation(bad)).toBe(false)
    let nested: unknown = {}; for (let i = 0; i < 80; i++) nested = { child: nested }
    expect(validStickerAnimation({ ...animation, extra: nested })).toBe(false)
    expect(validStickerAnimation({ ...animation, extra: Array(500_001).fill(0) })).toBe(false)
    for (const bad of [{ ...animation, layers: [{ ty: 2 }] }, { ...animation, layers: [{ ks: { p: { x: 'thisComp.layer(1)' } } }] }, JSON.parse('{"w":512,"h":512,"fr":30,"ip":0,"op":60,"layers":[{"__proto__":{}}]}')]) expect(validStickerAnimation(bad)).toBe(false)
    expect(validStickerAnimation(heavyAnimation())).toBe(true)
    const bomb = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'))
    new DataView(bomb.buffer).setUint32(16, 100_000)
    expect(stillType(bomb)).toBeNull()
  } finally { f.sql.close() }
})

it('keeps every sent pack as its own titled suggestion until it is added or dismissed', async () => {
  const f = await fixture()
  try {
    const sender = { from: { id: 12345, username: 'test_rex' }, chat: { id: 12345, type: 'private' } }
    f.sql.exec("INSERT INTO telegram_pairs(user_id,telegram_id,label) VALUES('rex','12345','@test_rex')")
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (!String(url).endsWith('/getStickerSet')) return f.calls(url)
      const name = JSON.parse(String(init.body)).name as string; fetched.push(name)
      return Response.json({ ok: true, result: { name, title: `${name} title`, stickers: [{ file_id: 'file_1', file_unique_id: `unique_${name}`, width: 512, height: 512 }] } })
    })
    let id = 1000, now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now += 1000)
    const send = (set_name: string) => f.hook({ update_id: id++, message: { ...sender, sticker: { set_name } } })
    const listed = async () => (await (await f.request('/stickers/telegram')).json() as { suggestions: { packName: string; title: string }[] }).suggestions
    await send('Alpha'); await send('Beta2024x')
    // Titles are cached before a suggestion is saved, so it never appears under its short name.
    expect(await listed()).toMatchObject([{ packName: 'Beta2024x', title: 'Beta2024x title' }, { packName: 'Alpha', title: 'Alpha title' }])
    await send('alpha')
    expect((await listed()).map((s) => s.packName)).toEqual(['Alpha', 'Beta2024x'])
    expect(fetched).toEqual(['Alpha', 'Beta2024x'])
    expect((await f.request('/stickers/telegram/suggestions/Beta2024x', undefined, 'rex', 'DELETE')).status).toBe(200)
    expect((await listed()).map((s) => s.packName)).toEqual(['Alpha'])
    expect((await f.request('/stickers/preview', { link: 'Alpha' })).status).toBe(200)
    expect((await f.request('/stickers/packs/Alpha/load', { offset: 0 })).status).toBe(200)
    expect((await f.request('/stickers/packs/Alpha', {})).status).toBe(200)
    expect(await listed()).toEqual([])
    // A pack already in the collection is not suggested again, even after it is removed.
    await send('Alpha'); expect(await listed()).toEqual([])
    await f.request('/stickers/packs/Alpha', undefined, 'rex', 'DELETE'); expect(await listed()).toEqual([])
    await send('Gamma'); await f.request('/stickers/telegram', undefined, 'rex', 'DELETE')
    expect(f.sql.prepare('SELECT COUNT(*) n FROM telegram_suggestions').get()).toEqual({ n: 0 })
  } finally { vi.restoreAllMocks(); f.sql.close() }
})

it('prepares two assets per range concurrently and simultaneous ranges retain every completed entry', async () => {
  const f = await fixture()
  try {
    const png = readFileSync(new URL('../../web/e2e/fixtures/stickers/0.png', import.meta.url))
    let active = 0, peak = 0
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/getStickerSet')) return Response.json({ ok: true, result: { name: 'Dogs', title: 'The dogs', stickers: Array.from({ length: 12 }, (_, i) => ({ file_id: `file_${i}`, file_unique_id: `unique_${i}`, width: 256, height: 256 })) } })
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      if (url.endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: `stickers/${JSON.parse(String(init?.body)).file_id}.png`, file_size: png.length } })
      return new Response(png)
    })
    expect((await f.request('/stickers/preview', { link: 'Dogs' })).status).toBe(200)
    // A smaller step prepares exactly that many.
    expect((await f.request('/stickers/packs/Dogs/load', { offset: 0, count: 3 })).status).toBe(200)
    const stepped = JSON.parse((f.sql.prepare("SELECT manifest FROM sticker_packs WHERE name='dogs'").get() as { manifest: string }).manifest)
    expect(stepped.stickers.map((s: { available: boolean }) => s.available).slice(0, 4)).toEqual([true, true, true, false])
    f.sql.exec("UPDATE sticker_packs SET manifest=json_set(manifest,'$.stickers[0].available',json('false'),'$.stickers[1].available',json('false'),'$.stickers[2].available',json('false')) WHERE name='dogs'")
    peak = 0
    const results = await Promise.all([0, 6].map((offset) => f.request('/stickers/packs/Dogs/load', { offset })))
    expect(results.map((r) => r.status)).toEqual([200, 200])
    expect(peak).toBe(4)
    expect((await f.request('/stickers/packs/Dogs/load', { offset: 0, count: 7 })).status).toBe(400)
    const manifest = JSON.parse((f.sql.prepare("SELECT manifest FROM sticker_packs WHERE name='dogs'").get() as { manifest: string }).manifest)
    expect(manifest.stickers.filter((s: { available: boolean }) => s.available)).toHaveLength(12)
    expect((await f.request('/stickers/packs/Dogs', {})).status).toBe(200)
  } finally { f.sql.close() }
})

it('stores a real-sized TGS animation, and a later load retries an animation that failed before', async () => {
  const f = await fixture()
  try {
    const png = readFileSync(new URL('../../web/e2e/fixtures/stickers/0.png', import.meta.url))
    const tgs = new Uint8Array(await new Response(new Blob([JSON.stringify(heavyAnimation())]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    expect(tgs.length).toBeLessThan(64 * 1024)
    let broken = true
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/getStickerSet')) return Response.json({ ok: true, result: { name: 'Dogs', title: 'The dogs', stickers: [{ file_id: 'anim', file_unique_id: 'unique_anim', width: 512, height: 512, is_animated: true, thumbnail: { file_id: 'still' } }] } })
      if (url.endsWith('/getFile')) { const id = JSON.parse(String(init?.body)).file_id; return Response.json({ ok: true, result: { file_path: `stickers/${id}.${id === 'still' ? 'png' : 'tgs'}`, file_size: 10 } }) }
      if (url.endsWith('.png')) return new Response(png)
      return new Response(broken ? new Uint8Array([1, 2, 3]) : tgs)
    })
    const manifest = () => JSON.parse((f.sql.prepare("SELECT manifest FROM sticker_packs WHERE name='dogs'").get() as { manifest: string }).manifest).stickers[0]
    expect((await f.request('/stickers/preview', { link: 'Dogs' })).status).toBe(200)
    expect((await f.request('/stickers/packs/Dogs/load', { offset: 0 })).status).toBe(200)
    expect(manifest()).toMatchObject({ available: true, animationError: expect.any(String) })
    expect((await f.request('/stickers/packs/Dogs', {})).status).toBe(200)
    const id = manifest().assetId
    expect((await f.request(`/assets/${id}/full`)).status).toBe(404)
    broken = false
    expect((await f.request('/stickers/packs/Dogs/load', { offset: 0 })).status).toBe(200)
    expect(manifest().available).toBe(true)
    expect(manifest().animationError).toBeUndefined()
    const full = await f.request(`/assets/${id}/full`)
    expect(full.status).toBe(200)
    expect((await full.json() as { layers: unknown[] }).layers).toHaveLength(40)
  } finally { f.sql.close() }
})
