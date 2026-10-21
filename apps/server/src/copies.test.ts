import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import type { AppEnv } from './env.ts'
import { copies } from './copies.ts'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  sql.exec("INSERT INTO users VALUES('owner','owner','hash',0,1); INSERT INTO users VALUES('guest','guest','hash',0,1)")
  const add = (o: Record<string, unknown>) => sql.prepare('INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES(?,?,?,?,1,1)').run(o.id as string, o.kind as string, o.boardId as string ?? null, JSON.stringify(o))
  const board = (id: string, parentId: string | null) => {
    add({ id, kind: 'board', parentId, title: id, createdAt: 1 })
    sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,\'owner\',0)').run(id)
  }
  board('root', null); board('hidden-descendant', 'root'); board('unrelated', null)
  add({ id: 'root-note', kind: 'card', type: 'note', boardId: 'root', content: { md: 'Root note' } })
  add({ id: 'secret-note', kind: 'card', type: 'note', boardId: 'hidden-descendant', content: { md: 'Hidden material' } })
  add({ id: 'external-note', kind: 'card', type: 'note', boardId: 'unrelated', content: { md: 'External material' } })
  add({ id: 'shortcut', kind: 'card', type: 'board', boardId: 'root', content: { boardId: 'unrelated' } })
  add({ id: 'discussion', kind: 'comment', boardId: 'root', cardId: 'root-note', authorId: 'owner', text: 'Original discussion' })
  add({ id: 'trashed', kind: 'card', type: 'note', boardId: 'root', deletedAt: 1 })
  add({ id: 'stroke', kind: 'stroke', boardId: 'root', cardId: 'root-note', points: [{ x: 1, y: 2 }] })
  let duringSnapshot: (() => void) | undefined
  const db = {
    prepare(source: string) {
      let args: unknown[] = []
      const statement = {
        bind(...values: unknown[]) { args = values; return statement },
        query() {
          const values: (string | number | null)[] = []
          const text = source.replace(/\?(\d+)/g, (_, n: string) => { values.push(args[Number(n) - 1] as string | number | null); return '?' })
          return { query: sql.prepare(text), values }
        },
        async all() { const { query, values } = statement.query(); const results = query.all(...values); if (source.includes('WITH RECURSIVE')) duringSnapshot?.(); return { results } },
        async first() { const { query, values } = statement.query(); return query.get(...values) ?? null },
      }
      return statement
    },
  } as unknown as D1Database
  const request = (id: string, user = 'owner') => {
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => { c.set('user', { id: user, username: user, isAdmin: false }); await next() })
    app.route('/', copies)
    return app.request(`/boards/${id}/copy-source`, {}, { DB: db } as never)
  }
  const grant = (id: string, children: boolean) => sql.prepare("INSERT INTO board_grants(id,board_id,user_id,permission,include_children,created_by,created_at) VALUES(?,?,'guest','view',?,'owner',1)").run(`grant-${id}`, id, Number(children))
  return { sql, request, grant, race: (fn: () => void) => { duringSnapshot = fn } }
}

it('returns the complete live canonical graph, including strokes but no discussion or shortcut destinations', async () => {
  const f = fixture()
  try {
    const before = f.sql.prepare('SELECT COUNT(*) AS n FROM objects').get()
    const response = await f.request('root')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json() as { objects: { id: string }[] }
    expect(body.objects.map((o) => o.id).sort()).toEqual(['root', 'hidden-descendant', 'root-note', 'secret-note', 'shortcut', 'stroke'].sort())
    expect(f.sql.prepare('SELECT COUNT(*) AS n FROM objects').get()).toEqual(before)
  } finally { f.sql.close() }
})

it('fails the whole snapshot for a board-only viewer without exposing a denied descendant name or contents', async () => {
  const f = fixture()
  try {
    f.grant('root', false)
    const response = await f.request('root', 'guest')
    expect(response.status).toBe(403)
    const text = await response.text()
    expect(text).not.toContain('hidden-descendant')
    expect(text).not.toContain('Hidden material')
    expect(text).not.toContain('objects')
  } finally { f.sql.close() }
})

it('requires shortcut target access without traversing its descendants', async () => {
  const f = fixture()
  try {
    f.grant('root', true)
    expect((await f.request('root', 'guest')).status).toBe(403)
    f.grant('unrelated', false)
    const response = await f.request('root', 'guest')
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('External material')
  } finally { f.sql.close() }
})

it('refuses unknown roots and racing access revisions', async () => {
  const f = fixture()
  try {
    expect((await f.request('missing')).status).toBe(403)
    f.race(() => f.sql.exec("UPDATE counters SET value=value+1 WHERE name='access_revision'"))
    const response = await f.request('root')
    expect(response.status).toBe(409)
    expect(await response.text()).not.toContain('Root note')
  } finally { f.sql.close() }
})
