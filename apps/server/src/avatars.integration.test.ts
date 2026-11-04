import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { deflateSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { app } from './app.ts'
import { sha256Hex, signAssetToken } from './crypto.ts'
import { validAvatarPng } from './avatars.ts'
import type { Env } from './env.ts'

function png(width = 512, height = 512) {
  const chunk = (type: string, data: Buffer) => {
    const result = Buffer.alloc(data.length + 12)
    result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8)
    let crc = 0xffffffff
    for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))])
}

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  for (const id of ['rex', 'fido']) {
    sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(id, id, 'unused', 0, 1)
    sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex(id), id, 1, Date.now() + 3600000)
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
        async run() { const { query, values } = statement.query(); if (/^SELECT/i.test(source)) return { results: query.all(...values), meta: { changes: 0 } }; const r = query.run(...values); return { success: true, results: [], meta: { changes: Number(r.changes) } } },
      }
      return statement
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      sql.exec('BEGIN')
      try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result } catch (e) { sql.exec('ROLLBACK'); throw e }
    },
  } as unknown as D1Database
  const stored = new Map<string, Uint8Array>()
  let failWrite = false
  const bucket = {
    async put(key: string, value: Uint8Array) { if (failWrite) throw new Error('offline'); stored.set(key, value) },
    async get(key: string) { const value = stored.get(key); return value ? { body: value } : null },
    async delete(key: string) { stored.delete(key) },
  }
  const env = { DB: db, BUCKET: bucket, ASSET_TOKEN_SECRET: 'avatar-test-secret' } as unknown as Env
  const request = (path: string, method = 'GET', body?: BodyInit, token: string | null = 'rex', extra: Record<string, string> = {}) => app.request(`/api${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'image/png', ...extra }, body }, env)
  return { request, sql, stored, env, fail: () => { failWrite = true } }
}

it('validates complete PNG bytes and rejects wrong sizes, checksums, truncation and extra bytes', async () => {
  expect(await validAvatarPng(png())).toBe(true)
  expect(await validAvatarPng(png(256, 512))).toBe(false)
  const broken = png(); broken[50] ^= 255
  for (const bytes of [broken, png().subarray(0, 50), Buffer.concat([png(), Buffer.from('extra')]), Buffer.from('<svg/>')]) expect(await validAvatarPng(bytes)).toBe(false)
})

it('saves, replaces and removes only the current user photo; members can read it', async () => {
  const f = await fixture()
  try {
    const saved = await f.request('/me/avatar', 'PUT', png())
    expect(saved.status).toBe(200)
    const { user } = await saved.json() as { user: { id: string; avatarId: string } }
    expect(user.id).toBe('rex'); expect(f.stored.size).toBe(1)
    const path = `/avatars/rex/${user.avatarId}`
    expect((await f.request(path, 'GET', undefined, 'fido')).status).toBe(200)
    expect((await f.request('/me')).status).toBe(200)
    const changed = await (await f.request('/me/avatar', 'PUT', png())).json() as { user: { avatarId: string } }
    expect(changed.user.avatarId).not.toBe(user.avatarId)
    expect((await f.request(path)).status).toBe(404); expect(f.stored.size).toBe(1)
    expect((await f.request('/me/avatar', 'DELETE')).status).toBe(200)
    expect(f.stored.size).toBe(0)
    expect(f.sql.prepare("SELECT avatar_id FROM users WHERE id='rex'").get()).toEqual({ avatar_id: null })
  } finally { f.sql.close() }
})

it('refuses anonymous/share reads and honors session-bound desktop tokens and revocation', async () => {
  const f = await fixture()
  try {
    expect((await f.request('/me/avatar', 'PUT', png(), null)).status).toBe(401)
    const { user } = await (await f.request('/me/avatar', 'PUT', png())).json() as { user: { avatarId: string } }
    const path = `/avatars/rex/${user.avatarId}`
    expect((await f.request(path, 'GET', undefined, null)).status).toBe(401)
    expect((await f.request(`${path}?share=anything`)).status).toBe(401)
    const token = await signAssetToken(f.env.ASSET_TOKEN_SECRET!, `session:${await sha256Hex('fido')}`, Date.now() + 60000)
    expect((await f.request(`${path}?t=${token}`, 'GET', undefined, null)).status).toBe(200)
    f.sql.prepare("DELETE FROM sessions WHERE user_id='fido'").run()
    expect((await f.request(`${path}?t=${token}`, 'GET', undefined, null)).status).toBe(401)
  } finally { f.sql.close() }
})

it('keeps the old photo on storage failure and refuses invalid or oversized uploads', async () => {
  const f = await fixture()
  try {
    const saved = await (await f.request('/me/avatar', 'PUT', png())).json() as { user: { avatarId: string } }
    expect((await f.request('/me/avatar', 'PUT', '<svg/>', 'rex', { 'content-type': 'image/svg+xml' })).status).toBe(415)
    expect((await f.request('/me/avatar', 'PUT', 'not a png')).status).toBe(400)
    expect((await f.request('/me/avatar', 'PUT', new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413)
    f.fail()
    expect((await f.request('/me/avatar', 'PUT', png())).status).toBe(503)
    expect(f.stored.size).toBe(1)
    expect(f.sql.prepare("SELECT avatar_id FROM users WHERE id='rex'").get()).toEqual({ avatar_id: saved.user.avatarId })
  } finally { f.sql.close() }
})
