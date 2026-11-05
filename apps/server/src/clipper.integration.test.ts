import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { CLIPPER_REDIRECT } from '@doggynote/core'
import { app } from './app.ts'
import { b64url, randomToken, sha256Hex } from './crypto.ts'
import type { Env } from './env.ts'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=', 'base64'))
async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  const now = Date.now()
  for (const id of ['rex', 'fido', 'spot']) {
    sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(id, id, 'unused', id === 'rex' ? 1 : 0, now)
    sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex(`session-${id}`), id, now, now + 86400000)
  }
  function board(id: string, owner: string, parentId: string | null = null, title = id) {
    sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at) VALUES(?,'board',?,1,?)").run(id, JSON.stringify({ id, kind: 'board', title, parentId, icon: 'paw', color: 'none', createdAt: now }), now)
    sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(id, owner)
  }
  board('root', 'rex'); board('child', 'rex', 'root', 'Art'); board('other', 'fido', null, 'Art'); board('toybox:rex', 'rex')
  const blobs = new Map<string, { bytes: ArrayBuffer; mime: string }>()
  let beforeBatch: (() => void) | undefined
  let batchQueue = Promise.resolve()
  const db = {
    prepare(source: string) {
      let args: unknown[] = []
      const statement = {
        bind(...values: unknown[]) { args = values; return statement },
        query() { const values: unknown[] = []; const text = source.replace(/\?(\d+)/g, (_, n: string) => { values.push(args[Number(n) - 1]); return '?' }); return { query: sql.prepare(text), values: values as (string | number | null)[] } },
        async all() { const { query, values } = statement.query(); return { results: query.all(...values) } },
        async first() { const { query, values } = statement.query(); return query.get(...values) ?? null },
        async run() { const { query, values } = statement.query(); const result = query.run(...values); return { success: true, meta: { changes: Number(result.changes) } } },
      }
      return statement
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      const previous = batchQueue
      let unlock!: () => void
      batchQueue = new Promise<void>((resolve) => { unlock = resolve })
      await previous
      try {
        const hook = beforeBatch; beforeBatch = undefined; hook?.()
        sql.exec('BEGIN')
        try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results } catch (e) { sql.exec('ROLLBACK'); throw e }
      } finally { unlock() }
    },
  } as unknown as D1Database
  const bucket = {
    async head(id: string) { return blobs.has(id) ? {} : null },
    async put(id: string, bytes: ArrayBuffer, options: { httpMetadata: { contentType: string } }) { blobs.set(id, { bytes, mime: options.httpMetadata.contentType }) },
    async get(id: string) { const b = blobs.get(id); return b ? { body: b.bytes, httpEtag: '"test"', writeHttpMetadata(headers: Headers) { headers.set('content-type', b.mime) } } : null },
  } as unknown as R2Bucket
  const env = { DB: db, BUCKET: bucket } as Env
  const request = (path: string, body?: unknown, token = 'session-rex', method = body === undefined ? 'GET' : 'POST') => app.request(`/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-doggynote-protocol': '4' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  const verifier = 'a'.repeat(43), state = 'b'.repeat(43)
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  async function authorize() {
    const response = await request('/clipper/authorize', { challenge, state, redirectUri: CLIPPER_REDIRECT })
    expect(response.status, await response.clone().text()).toBe(200)
    const redirect = new URL((await response.json() as { redirect: string }).redirect)
    expect(redirect.searchParams.get('state')).toBe(state)
    return redirect.searchParams.get('code')!
  }
  async function connect() {
    const response = await request('/clipper/exchange', { code: await authorize(), verifier, redirectUri: CLIPPER_REDIRECT })
    expect(response.status, await response.clone().text()).toBe(201)
    return (await response.json() as { token: string }).token
  }
  const token = await connect()
  async function capture(target = 'child', clipId = crypto.randomUUID()) {
    const assetId = crypto.randomUUID()
    expect((await request('/clipper/uploads', { assetId }, token)).status).toBe(200)
    for (const size of ['thumb', 'small', 'medium', 'full']) {
      const response = await app.request(`/api/clipper/assets/${assetId}/${size}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: png }, env)
      expect(response.status, await response.clone().text()).toBe(201)
    }
    const input = { id: clipId, boardId: target, image: { assetId, width: 600, height: 800, sizes: ['thumb', 'small', 'medium', 'full'] }, source: { pageUrl: 'https://example.com/art', imageUrl: 'https://cdn.example.com/image.png', pageTitle: 'Artist’s drawing' } }
    return { input, create: () => request('/clipper/clips', input, token), assetId }
  }
  return { sql, request, capture, token, authorize, verifier, challenge, connect, beforeBatch: (hook: () => void) => { beforeBatch = hook } }
}

it('connects with one-use PKCE codes, rejects wrong callbacks/verifiers and grants only clipping', async () => {
  const f = await fixture()
  try {
    const code = await f.authorize()
    expect((await f.request('/clipper/exchange', { code, verifier: 'x'.repeat(43), redirectUri: CLIPPER_REDIRECT })).status).toBe(401)
    expect((await f.request('/clipper/exchange', { code, verifier: f.verifier, redirectUri: CLIPPER_REDIRECT })).status).toBe(201)
    expect((await f.request('/clipper/exchange', { code, verifier: f.verifier, redirectUri: CLIPPER_REDIRECT })).status).toBe(401)
    expect((await f.request('/clipper/authorize', { challenge: f.challenge, state: 'b'.repeat(43), redirectUri: 'https://evil.test/callback' })).status).toBe(400)
    for (const [path, body] of [['/sync', { changes: [] }], ['/clipper/authorize', {}], ['/boards/child/inbox', undefined], ['/clipper-connections', undefined]] as const) expect((await f.request(path, body, f.token)).status).toBe(401)
    const boards = await (await f.request('/clipper/boards', undefined, f.token)).json() as { boards: { id: string; path: string }[] }
    expect(boards.boards.map((b) => b.id).sort()).toEqual(['child', 'root'])
    expect(boards.boards.find((b) => b.id === 'child')?.path).toBe('root / Art')
    const expired = await f.authorize()
    f.sql.exec('UPDATE clipper_codes SET expires_at=1')
    expect((await f.request('/clipper/exchange', { code: expired, verifier: f.verifier, redirectUri: CLIPPER_REDIRECT })).status).toBe(401)
  } finally { f.sql.close() }
})

it('saves copied bytes idempotently outside sync, places once and retains source metadata', async () => {
  const f = await fixture()
  try {
    const clip = await f.capture()
    expect((await clip.create()).status).toBe(201)
    expect((await clip.create()).status).toBe(200)
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM objects WHERE kind='card'").get()).toEqual({ n: 0 })
    const list = await (await f.request('/boards/child/inbox')).json() as { count: number }
    expect(list.count).toBe(1)
    expect((await f.request(`/assets/${clip.assetId}/small`)).status).toBe(200)
    const path = `/boards/child/inbox/${clip.input.id}/place`
    const placed = await f.request(path, { x: 50, y: 90 })
    expect(placed.status, await placed.clone().text()).toBe(200)
    const { cardId } = await placed.json() as { cardId: string }
    expect(await (await f.request(path, { x: 500, y: 900 })).json()).toEqual({ cardId })
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM objects WHERE kind='card'").get()).toEqual({ n: 1 })
    const stored = JSON.parse((f.sql.prepare('SELECT data FROM objects WHERE id=?').get(cardId) as { data: string }).data)
    expect(stored).toMatchObject({ x: 50, y: 90, content: { assetId: clip.assetId, source: clip.input.source } })
    expect(await (await f.request('/boards/child/inbox')).json()).toMatchObject({ count: 0 })
  } finally { f.sql.close() }
})

it('keeps pending images private from strangers and share links but readable by board viewers', async () => {
  const f = await fixture()
  try {
    const clip = await f.capture(); await clip.create()
    expect((await f.request('/boards/child/inbox', undefined, 'session-fido')).status).toBe(403)
    expect((await f.request(`/assets/${clip.assetId}/small`, undefined, 'session-fido')).status).toBe(403)
    f.sql.prepare("INSERT INTO board_grants(id,board_id,user_id,permission,created_by,created_at) VALUES('grant','root','fido','view','rex',?)").run(Date.now())
    expect((await f.request('/boards/child/inbox', undefined, 'session-fido')).status).toBe(200)
    expect((await f.request(`/assets/${clip.assetId}/small`, undefined, 'session-fido')).status).toBe(200)
    expect((await f.request(`/boards/child/inbox/${clip.input.id}/place`, { x: 0, y: 0 }, 'session-fido')).status).toBe(403)
    const share = await f.request('/shares', { boardId: 'root', includeChildren: true })
    expect(share.status).toBe(201)
    const { share: { token } } = await share.json() as { share: { token: string } }
    expect((await f.request(`/assets/${clip.assetId}/small?share=${token}`, undefined, '')).status).toBe(403)
    expect((await f.request('/boards/child/inbox', undefined, '')).status).toBe(401)
    f.sql.exec("UPDATE board_grants SET revoked_at=1 WHERE id='grant'; UPDATE counters SET value=value+1 WHERE name='access_revision'")
    expect((await f.request(`/assets/${clip.assetId}/small`, undefined, 'session-fido')).status).toBe(403)
  } finally { f.sql.close() }
})

it('rejects incomplete uploads and private destinations; discard and restore preserve bytes', async () => {
  const f = await fixture()
  try {
    const clip = await f.capture()
    f.sql.prepare("DELETE FROM assets WHERE id=? AND size='full'").run(clip.assetId)
    expect((await clip.create()).status).toBe(409)
    expect((await (await f.capture('toybox:rex')).create()).status).toBe(403)
    expect((await (await f.capture('other')).create()).status).toBe(403)
    const good = await f.capture(); await good.create()
    const path = `/boards/child/inbox/${good.input.id}`
    expect((await f.request(`${path}/discard`, {})).status).toBe(200)
    expect((await f.request(`${path}/place`, { x: 0, y: 0 })).status).toBe(409)
    expect((await f.request(`${path}/restore`, {})).status).toBe(200)
    expect((await f.request(`/assets/${good.assetId}/small`)).status).toBe(200)
  } finally { f.sql.close() }
})

it('rolls back placement if board access or lifecycle changes during the write', async () => {
  const f = await fixture()
  try {
    const clip = await f.capture(); await clip.create()
    f.beforeBatch(() => f.sql.exec("UPDATE counters SET value=value+1 WHERE name='access_revision'"))
    expect((await f.request(`/boards/child/inbox/${clip.input.id}/place`, { x: 0, y: 0 })).status).toBe(409)
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM objects WHERE kind='card'").get()).toEqual({ n: 0 })
    f.beforeBatch(() => f.sql.exec("UPDATE objects SET data=json_set(data,'$.deletedAt',1) WHERE id='root'"))
    expect((await f.request(`/boards/child/inbox/${clip.input.id}/place`, { x: 0, y: 0 })).status).toBe(409)
    expect(f.sql.prepare('SELECT state FROM board_inbox WHERE id=?').get(clip.input.id)).toEqual({ state: 'pending' })
    expect((await f.request(`/assets/${clip.assetId}/small`)).status).toBe(403)
  } finally { f.sql.close() }
})

it('revokes scoped connections immediately, including account-wide session revocation', async () => {
  const f = await fixture()
  try {
    const list = await (await f.request('/clipper-connections')).json() as { connections: { id: string }[] }
    expect((await f.request(`/clipper-connections/${list.connections[0].id}`, undefined, 'session-rex', 'DELETE')).status).toBe(200)
    expect((await f.request('/clipper/boards', undefined, f.token)).status).toBe(401)
    const second = await f.connect()
    expect((await f.request('/users/rex/sessions', undefined, 'session-rex', 'DELETE')).status).toBe(200)
    expect((await f.request('/clipper/boards', undefined, second)).status).toBe(401)
  } finally { f.sql.close() }
})

it('two simultaneous placements create exactly one card', async () => {
  const f = await fixture()
  try {
    const clip = await f.capture(); await clip.create()
    const path = `/boards/child/inbox/${clip.input.id}/place`
    const responses = await Promise.all([f.request(path, { x: 20, y: 20 }), f.request(path, { x: 40, y: 40 })])
    expect(responses.map((r) => r.status)).toEqual([200, 200])
    const receipts = await Promise.all(responses.map((r) => r.json()))
    expect(receipts[0]).toEqual(receipts[1])
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM objects WHERE kind='card'").get()).toEqual({ n: 1 })
  } finally { f.sql.close() }
})

it('a racing connection revocation rejects the entire clip commit', async () => {
  const f = await fixture()
  try {
    const clip = await f.capture()
    f.beforeBatch(() => f.sql.exec('UPDATE clipper_credentials SET revoked_at=1'))
    expect((await clip.create()).status).toBe(401)
    expect(f.sql.prepare('SELECT COUNT(*) AS n FROM board_inbox').get()).toEqual({ n: 0 })
  } finally { f.sql.close() }
})

it('account recovery revokes clipper credentials and outstanding approval codes', async () => {
  const f = await fixture()
  try {
    const code = await f.authorize(), recovery = randomToken()
    f.sql.prepare("INSERT INTO account_links(id,token_hash,kind,user_id,created_by,created_at,expires_at) VALUES('recovery',?,'recovery','rex','rex',?,?)").run(await sha256Hex(recovery), Date.now(), Date.now() + 100000)
    expect((await f.request('/auth/reset', { token: recovery, password: 'new-password123' })).status).toBe(200)
    expect((await f.request('/clipper/boards', undefined, f.token)).status).toBe(401)
    expect((await f.request('/clipper/exchange', { code, verifier: f.verifier, redirectUri: CLIPPER_REDIRECT })).status).toBe(401)
  } finally { f.sql.close() }
})
