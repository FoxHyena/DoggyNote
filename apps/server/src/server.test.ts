import { describe, expect, it } from 'vitest'
import { app } from './app.ts'
import { hashPassword, sha256Hex, signAssetToken, verifyAssetToken, verifyPassword } from './crypto.ts'
import { deletedCommentOwner, ownerFor, parseChanges, stampComment, upsertSql } from './sync.ts'
import { decodeEntities, isFetchableUrl } from './unfurl.ts'
import { cleanFileName, contentDisposition } from './assets.ts'

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
  it('accepts namespaced ids like toybox:<user>', () => {
    expect(parseChanges({ changes: [{ id: 'toybox:abc-123', patch: { kind: 'board' } }] })).toHaveLength(1)
  })
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
    expect(sql).toContain(`json_set(objects.data, '$.x', json(?8), '$.content', json(?9))`)
    expect(sql).toContain('owner_id = ?7')
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

describe('Toy box ownership', () => {
  it('a Toy box board and everything on it belong to its user', () => {
    expect(ownerFor('toybox:u1', null)).toBe('u1')
    expect(ownerFor('card-1', 'toybox:u1')).toBe('u1')
    expect(ownerFor('card-1', 'some-board')).toBeNull()
    expect(ownerFor('card-1', null)).toBeNull()
  })
})

describe('comment authorship', () => {
  const rex = { id: 'u-rex', username: 'rex' }
  const fido = { id: 'u-fido', username: 'fido' }
  const existing = { kind: 'comment', author_id: 'u-rex' }

  it('stamps the signed-in author on a new comment, whatever the client sent', () => {
    const p: Record<string, unknown> = { kind: 'comment', text: 'hi', authorId: 'u-fido', author: 'fido' }
    expect(stampComment(p, undefined, 'comment', rex)).toBeNull()
    expect(p).toMatchObject({ authorId: 'u-rex', author: 'rex' })
  })
  it('lets the author edit and delete, and never re-assigns authorship', () => {
    const p: Record<string, unknown> = { text: 'edited', editedAt: 1, deletedAt: 2, authorId: 'u-fido' }
    expect(stampComment(p, existing, 'comment', rex)).toBeNull()
    expect(p).not.toHaveProperty('authorId')
  })
  it("lets anyone resolve a thread or move it with its card, but not edit someone else's words", () => {
    expect(stampComment({ resolvedAt: 5 }, existing, 'comment', fido)).toBeNull()
    expect(stampComment({ boardId: 'b2' }, existing, 'comment', fido)).toBeNull()
    expect(stampComment({ text: 'gotcha' }, existing, 'comment', fido)).toMatch(/author/)
    expect(stampComment({ deletedAt: 1 }, existing, 'comment', fido)).toMatch(/author/)
    expect(stampComment({ kind: 'card', x: 1 }, existing, 'card', fido)).toMatch(/author/)
  })
  it("can't turn an existing card into a comment", () => {
    expect(stampComment({ kind: 'comment' }, { kind: 'card', author_id: null }, 'comment', rex)).toBe('bad kind')
  })
  it('wipes the text when a comment is purged', () => {
    const p: Record<string, unknown> = { purged: true }
    expect(stampComment(p, existing, 'comment', rex)).toBeNull()
    expect(p.text).toBe('')
  })
  it('a deleted comment is private to its author until restored', () => {
    const live = { kind: 'comment', author_id: 'u-rex', deleted_at: null, purged: null }
    expect(deletedCommentOwner('comment', { deletedAt: 9 }, live, 'u-rex')).toBe('u-rex')
    expect(deletedCommentOwner('comment', { boardId: 'b' }, { ...live, deleted_at: 9 }, 'u-fido')).toBe('u-rex')
    expect(deletedCommentOwner('comment', { purged: true, text: '' }, { ...live, deleted_at: 9 }, 'u-rex')).toBe('u-rex')
    expect(deletedCommentOwner('comment', { deletedAt: null }, { ...live, deleted_at: 9 }, 'u-rex')).toBeNull()
    expect(deletedCommentOwner('comment', { text: 'hi' }, live, 'u-rex')).toBeNull()
    expect(deletedCommentOwner('card', { deletedAt: 9 }, undefined, 'u-rex')).toBeNull()
  })
  it('leaves other kinds alone', () => {
    const p = { x: 1 }
    expect(stampComment(p, { kind: 'card', author_id: null }, 'card', fido)).toBeNull()
    expect(p).toEqual({ x: 1 })
  })
})

describe('file downloads', () => {
  it('keeps names printable, short and pathless', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('....etcpasswd')
    expect(cleanFileName('a\u0000b\nc.pdf')).toBe('abc.pdf')
    expect(cleanFileName('   ')).toBe('file')
    expect(cleanFileName('x'.repeat(500))).toHaveLength(200)
  })
  it('always downloads, with an ASCII fallback and the UTF-8 name', () => {
    expect(contentDisposition('Pup "plan" ü.pdf')).toBe(`attachment; filename="Pup _plan_ _.pdf"; filename*=UTF-8''Pup%20%22plan%22%20%C3%BC.pdf`)
  })
})
