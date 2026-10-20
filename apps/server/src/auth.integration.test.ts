import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { auth, LOGIN_LIMITS } from './auth.ts'
import { hashPassword } from './crypto.ts'
import type { AppEnv, Env } from './env.ts'

/** Sign-in throttling against the production migrations on SQLite. */
async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run('rex', 'rex', await hashPassword('goodboy123'), 1, Date.now())
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
  const app = new Hono<AppEnv>().basePath('/api').route('/auth', auth)
  const login = (username: string, password: string, ip = '203.0.113.7') => app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ username, password }),
  }, { DB: db } as Env)
  return { sql, login }
}

it('locks a username after repeated wrong passwords, even for the right one', async () => {
  const f = await fixture()
  try {
    expect((await f.login('rex', 'goodboy123')).status).toBe(200)
    for (let i = 0; i < LOGIN_LIMITS.user; i++) expect((await f.login(i % 2 ? 'REX' : 'rex', `guess-${i}`, `198.51.100.${i}`)).status).toBe(401)
    const locked = await f.login('rex', 'goodboy123')
    expect(locked.status).toBe(429)
    expect(((await locked.json()) as { error: string }).error).toMatch(/Too many sign-in attempts/)
    // The lockout ends when the failures age out of the window.
    f.sql.exec("UPDATE login_failures SET at = at - 16 * 60000")
    expect((await f.login('rex', 'goodboy123')).status).toBe(200)
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE key='user:rex'").get()).toEqual({ n: 0 })
  } finally { f.sql.close() }
})

it('locks an address that sprays many usernames', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < LOGIN_LIMITS.ip; i++) expect((await f.login(`nobody${i}`, 'password1')).status).toBe(401)
    expect((await f.login('rex', 'goodboy123')).status).toBe(429)
    expect((await f.login('rex', 'goodboy123', '192.0.2.1')).status).toBe(200)
  } finally { f.sql.close() }
}, 30_000)
