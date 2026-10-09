import { describe, expect, it } from 'vitest'
import { app } from './app.ts'
import { hashPassword, sha256Hex, verifyPassword } from './crypto.ts'
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
