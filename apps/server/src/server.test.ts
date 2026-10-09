import { describe, expect, it } from 'vitest'
import { app } from './app.ts'
import { hashPassword, sha256Hex, signAssetToken, verifyAssetToken, verifyPassword } from './crypto.ts'
import { parseChanges, upsertSql } from './sync.ts'
import { decodeEntities, isFetchableUrl } from './unfurl.ts'

it('health check responds', async () => {
  const res = await app.request('/api/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, woof: true })
})

it('rejects non-JSON POSTs (CSRF guard)', async () => {
  const res = await app.request('/api/auth/login', { method: 'POST', body: 'username=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
  expect(res.status).toBe(415)
})

describe('passwords', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const h = await hashPassword('correct horse')
    expect(h).toMatch(/^pbkdf2\$100000\$/)
    expect(await verifyPassword('correct horse', h)).toBe(true)
    expect(await verifyPassword('wrong horse', h)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
  it('salts: same password, different hashes', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })
  it('sha256Hex is stable', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('sync validation', () => {
  it('accepts well-formed patches', () => {
    expect(parseChanges({ changes: [{ id: 'abc-1', patch: { x: 1, content: { a: 1 } } }] })).toEqual([{ id: 'abc-1', patch: { x: 1, content: { a: 1 } } }])
  })
  it('rejects bad ids, keys, kinds and oversize batches', () => {
    expect(parseChanges({ changes: [{ id: "x'; drop", patch: { x: 1 } }] })).toBe('bad id')
    expect(parseChanges({ changes: [{ id: 'a', patch: { "x') --": 1 } }] })).toBe('bad keys for a')
    expect(parseChanges({ changes: [{ id: 'a', patch: { kind: 'user' } }] })).toBe('bad kind for a')
    expect(parseChanges({ changes: [{ id: 'a', patch: { id: 'b' } }] })).toBe('id mismatch for a')
    expect(parseChanges({ changes: Array.from({ length: 201 }, () => ({ id: 'a', patch: { x: 1 } })) })).toMatch(/at most/)
    expect(parseChanges({})).toBe('changes must be an array')
  })
  it('upsertSql sets each top-level key with a bound JSON value', () => {
    const { sql, args } = upsertSql({ id: 'a', x: 5, content: { t: 'hi' } })
    expect(sql).toContain(`json_set(objects.data, '$.x', json(?7), '$.content', json(?8))`)
    expect(args).toEqual(['5', '{"t":"hi"}'])
  })
})

describe('unfurl helpers', () => {
  it('decodes HTML entities', () => {
    expect(decodeEntities('Tom &amp; Jerry &#39;s &#x1F436; &quot;x&quot;')).toBe(`Tom & Jerry 's 🐶 "x"`)
  })
  it('only fetches http(s)', () => {
    expect(isFetchableUrl('https://a.dog/')).not.toBeNull()
    expect(isFetchableUrl('file:///etc/passwd')).toBeNull()
    expect(isFetchableUrl('not a url')).toBeNull()
  })
})

describe('asset tokens', () => {
  const secret = 'test-secret'
  it('round-trips the user id until expiry', async () => {
    const t = await signAssetToken(secret, 'user-1', 2_000)
    expect(await verifyAssetToken(secret, t, 1_000)).toBe('user-1')
    expect(await verifyAssetToken(secret, t, 2_000)).toBeNull()
  })
  it('rejects tampering and the wrong secret', async () => {
    const t = await signAssetToken(secret, 'user-1', 9_999_999_999_999)
    const [, exp, sig] = t.split('.')
    expect(await verifyAssetToken(secret, `user-2.${exp}.${sig}`, 0)).toBeNull()
    expect(await verifyAssetToken('other', t, 0)).toBeNull()
    expect(await verifyAssetToken(secret, 'garbage', 0)).toBeNull()
    expect(await verifyAssetToken(secret, 'a.b.!!!', 0)).toBeNull()
  })
})

it('images need a credential', async () => {
  const res = await app.request('/api/assets/00000000-0000-4000-8000-000000000000/thumb', {}, { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } } as never)
  expect(res.status).toBe(401)
})

describe('desktop releases', () => {
  const manifest = { version: '0.1.42', dmg: 'DoggyNote_0.1.42_aarch64.dmg', platforms: { 'darwin-aarch64': { url: 'x', signature: 'y' } } }
  const files: Record<string, string> = {
    'desktop/latest.json': JSON.stringify(manifest),
    'desktop/0.1.42/DoggyNote_0.1.42_aarch64.dmg': 'DMG',
  }
  const BUCKET = {
    get: async (key: string) =>
      key in files
        ? { body: files[key], httpEtag: '"e"', writeHttpMetadata: () => undefined, json: async () => JSON.parse(files[key]) }
        : null,
  }
  const env = { BUCKET, APP_VERSION: '0.1.42', MIN_CLIENT: '0.1.0' } as never

  it('reports the deployed version', async () => {
    const res = await app.request('/api/version', {}, env)
    expect(await res.json()).toEqual({ version: '0.1.42', minClient: '0.1.0' })
  })
  it('serves the updater manifest', async () => {
    const res = await app.request('/api/desktop/latest.json', {}, env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { version: string }).version).toBe("0.1.42")
  })
  it('redirects /download to the newest disk image, which downloads', async () => {
    const res = await app.request('/api/desktop/download', {}, env)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/api/desktop/files/0.1.42/DoggyNote_0.1.42_aarch64.dmg')
    const file = await app.request(res.headers.get('location')!, {}, env)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-disposition')).toContain('attachment')
  })
  it('only serves release files, never other bucket keys', async () => {
    for (const p of ['/api/desktop/files/0.1.42/..%2F..%2Flatest.json', '/api/desktop/files/0.1.42/secret.png', '/api/desktop/files/x/DoggyNote.app.tar.gz']) {
      expect((await app.request(p, {}, env)).status).toBe(404)
    }
  })
})
