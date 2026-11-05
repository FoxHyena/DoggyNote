import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { app } from './app.ts'
import { randomToken, sha256Hex, hashPassword } from './crypto.ts'
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
  const env = { DB: db } as Env
  const request = (path: string, method = 'GET', body?: unknown, token: string | null = 'rex') => app.request(`/api${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', 'x-doggynote-protocol': '4' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, env)
  const object = (id: string, value: Record<string, unknown>, owner: string | null = null) => {
    sql.prepare('INSERT INTO objects(id,kind,board_id,data,seq,updated_at,owner_id) VALUES(?,?,?,?,1,1,?)').run(id, String(value.kind), String(value.boardId ?? '') || null, JSON.stringify({ id, ...value }), owner)
  }
  return { request, sql, object }
}

it('saves, clears and isolates profile changes and returns names on cookie and bearer sessions', async () => {
  const f = await fixture()
  try {
    expect((await f.request('/me/profile', 'PATCH', { displayName: 'Oreo' }, null)).status).toBe(401)
    for (const body of [null, [], {}, { displayName: 1 }, { displayName: {} }, { displayName: 'x'.repeat(65) }, { displayName: 'two\nlines' }]) {
      expect((await f.request('/me/profile', 'PATCH', body)).status).toBe(400)
    }
    const saved = await f.request('/me/profile', 'PATCH', { displayName: '  Oreo 🐺  ', id: 'fido', username: 'changed', isAdmin: true })
    expect(saved.headers.get('cache-control')).toBe('no-store')
    expect((await saved.json()).user).toMatchObject({ id: 'rex', username: 'rex', displayName: 'Oreo 🐺', isAdmin: false, avatarId: null })
    expect((await (await f.request('/me')).json()).user.displayName).toBe('Oreo 🐺')
    expect((await (await f.request('/me', 'GET', undefined, 'fido')).json()).user.displayName).toBeNull()
    expect((await f.request('/me/profile', 'PATCH', { displayName: 'Oreo 🐺' }, 'fido')).status).toBe(200)
    f.sql.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(await hashPassword('goodboy123'), 'rex')
    const login = await f.request('/auth/login', 'POST', { username: 'rex', password: 'goodboy123', bearer: true }, null)
    const session = await login.json()
    expect(session.user.displayName).toBe('Oreo 🐺')
    expect(session.token).toBeTypeOf('string')
    expect(login.headers.get('set-cookie')).toContain('dn_session=')
    for (const displayName of ['   ', null]) {
      expect((await (await f.request('/me/profile', 'PATCH', { displayName })).json()).user.displayName).toBeNull()
    }
  } finally { f.sql.close() }
})

it('validates signup names before consuming invitations and allows unnamed signups', async () => {
  const f = await fixture()
  try {
    for (const [index, displayName] of ['  New Pup 🐾  ', undefined].entries()) {
      const token = randomToken()
      f.sql.prepare("INSERT INTO account_links(id,kind,token_hash,created_by,created_at,expires_at) VALUES(?,'invite',?,'rex',1,?)").run(`invite-${index}`, await sha256Hex(token), Date.now() + 100000)
      const signup = { token, username: `pup${index}`, password: 'goodboy123' }
      expect((await f.request('/auth/signup', 'POST', { ...signup, displayName: 'x'.repeat(65) }, null)).status).toBe(400)
      const result = await f.request('/auth/signup', 'POST', { ...signup, displayName }, null)
      expect(result.status).toBe(200)
      expect((await result.json()).user.displayName).toBe(index === 0 ? 'New Pup 🐾' : null)
    }
  } finally { f.sql.close() }
})

it('refreshes unchanged comment identities without exposing private or deleted comment authors', async () => {
  const f = await fixture()
  try {
    for (const [id, owner] of [['shared', 'rex'], ['secret', 'fido']]) {
      f.object(id!, { kind: 'board', title: id, parentId: null })
      f.sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(id!, owner!)
    }
    for (const id of ['visible', 'private', 'deleted', 'purged']) f.sql.prepare("INSERT INTO users(id,username,pw_hash,created_at,display_name) VALUES(?,?,'unused',1,?)").run(id, id, `${id} name`)
    f.object('note', { kind: 'card', type: 'note', boardId: 'shared', content: { md: 'Note' } })
    f.object('old-comment', { kind: 'comment', boardId: 'shared', cardId: 'note', authorId: 'visible', author: 'Old username', text: 'Hello' })
    f.object('secret-comment', { kind: 'comment', boardId: 'secret', authorId: 'private' })
    f.object('deleted-comment', { kind: 'comment', boardId: 'shared', authorId: 'deleted', deletedAt: 1 }, 'fido')
    f.object('purged-comment', { kind: 'comment', boardId: 'shared', authorId: 'purged', purged: true }, 'rex')
    const first = await (await f.request('/sync?since=0')).json()
    expect(first.profiles).toEqual([{ id: 'visible', username: 'visible', displayName: 'visible name' }])
    f.sql.prepare('UPDATE users SET display_name=? WHERE id=?').run('Changed name 🐺', 'visible')
    const next = await (await f.request(`/sync?since=100&accessRevision=${first.accessRevision}`)).json()
    expect(next.objects).toEqual([])
    expect(next.profiles[0].displayName).toBe('Changed name 🐺')
    expect(JSON.parse(String(f.sql.prepare("SELECT data FROM objects WHERE id='old-comment'").get()!.data)).author).toBe('Old username')
    f.sql.prepare("INSERT INTO shares(token,board_id,created_by,created_at,permission) VALUES('public-link','shared','rex',1,'view')").run()
    const shared = await (await f.request('/share/public-link', 'GET', undefined, null)).json()
    expect(shared.profiles).toEqual(next.profiles)
    expect(shared.objects.some((o: { id: string }) => o.id === 'deleted-comment')).toBe(false)
    f.sql.prepare("DELETE FROM users WHERE id='visible'").run()
    expect((await (await f.request('/sync?since=100')).json()).profiles).toEqual([])
  } finally { f.sql.close() }
})
