import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { accessGuard, loadAccess } from './access.ts'
import { deniedChanges } from './sync.ts'
import { resolveShare } from './shares.ts'

/** Execute the production migrations and authorization SQL on actual SQLite. */
function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const name of ['0001_init', '0002_epoch', '0003_asset_index', '0004_owner']) {
    sql.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'))
  }
  sql.exec("INSERT INTO users VALUES ('old','old','hash',0,1); INSERT INTO users VALUES ('admin','admin','hash',1,1)")
  const board = (id: string, parentId: string | null, owner: string | null = null, legacy = false) => {
    sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at,owner_id) VALUES (?,'board',?,1,1,?)").run(id, JSON.stringify({ id, kind: 'board', parentId, title: id }), id.startsWith('toybox:') ? id.slice(7) : null)
    if (!id.startsWith('toybox:') && initialized) sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES (?,?,?)').run(id, owner, Number(legacy))
  }
  let initialized = false
  board('home', null)
  board('legacy-child', 'home')
  board('toybox:old', null)
  sql.exec(readFileSync(new URL('../migrations/0005_access.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync(new URL('../migrations/0008_view_scope.sql', import.meta.url), 'utf8'))
  initialized = true
  sql.exec("INSERT INTO users VALUES ('new','new','hash',0,2); INSERT INTO users VALUES ('guest','guest','hash',0,3)")
  board('private', null, 'new')
  board('inner', 'private', 'new')
  board('toybox:new', null)
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
        async run() { const { query, values } = statement.query(); return query.run(...values) },
      }
      return statement
    },
  } as unknown as D1Database
  const grant = (id: string, includeChildren: boolean, source: string | null = null) => sql.prepare('INSERT INTO board_grants(id,board_id,user_id,permission,source_token,include_children,created_by,created_at) VALUES (?,\'private\',\'guest\',\'edit\',?,?,\'new\',1)').run(id, source, Number(includeChildren))
  return { sql, db, grant, board }
}

describe('private-board migration and authorization', () => {
  it('snapshots existing membership without inventing personal owners or enrolling future accounts', async () => {
    const { sql, db } = fixture()
    try {
      expect(sql.prepare('SELECT user_id FROM legacy_members ORDER BY user_id').all()).toEqual([{ user_id: 'admin' }, { user_id: 'old' }])
      expect(sql.prepare("SELECT owner_id,legacy FROM board_access WHERE board_id='home'").get()).toEqual({ owner_id: null, legacy: 1 })
      expect(sql.prepare("SELECT 1 FROM board_access WHERE board_id='toybox:old'").get()).toBeUndefined()
      const old = await loadAccess(db, { id: 'old', isAdmin: false })
      const newcomer = await loadAccess(db, { id: 'new', isAdmin: false })
      expect(old.canEdit('legacy-child')).toBe(true)
      expect(old.canRead('private')).toBe(false)
      expect(newcomer.canRead('home')).toBe(false)
      expect(newcomer.canEdit('private')).toBe(true)
      expect(newcomer.canManage('private')).toBe(true)
      expect(newcomer.homeBoardId).toBe('home:new')
      expect(old.homeBoardId).toBe('home:old')
    } finally { sql.close() }
  })
  it('respects direct board-only grants, inheritance and independent grant provenance', async () => {
    const { sql, db, grant } = fixture()
    try {
      grant('direct', false)
      let guest = await loadAccess(db, { id: 'guest', isAdmin: false })
      expect(guest.canEdit('private')).toBe(true)
      expect(guest.canRead('inner')).toBe(false)
      expect(guest.canManage('private')).toBe(false)
      sql.exec("INSERT INTO shares(token,board_id,permission,created_by,created_at,expires_at) VALUES ('link','private','edit','new',1,9999999999999)")
      grant('linked', true, 'link')
      guest = await loadAccess(db, { id: 'guest', isAdmin: false })
      expect(guest.canEdit('inner')).toBe(true)
      sql.exec("UPDATE shares SET expires_at=1 WHERE token='link'")
      expect((await loadAccess(db, { id: 'guest', isAdmin: false })).canEdit('inner')).toBe(true)
      expect(() => grant('too-late', true, 'link')).toThrow('Board invitation is unavailable')
      sql.exec("UPDATE shares SET revoked_at=1 WHERE token='link'")
      guest = await loadAccess(db, { id: 'guest', isAdmin: false })
      expect(guest.canEdit('private')).toBe(true)
      expect(guest.canRead('inner')).toBe(false)
      sql.exec("UPDATE board_grants SET revoked_at=1 WHERE id='direct'")
      expect((await loadAccess(db, { id: 'guest', isAdmin: false })).canRead('private')).toBe(false)
    } finally { sql.close() }
  })
  it('retries authorization if revocation races the grant and revision reads', async () => {
    const { sql, db, grant } = fixture()
    try {
      grant('racing-grant', true)
      let raced = false
      const racing = {
        prepare(source: string) {
          const statement = db.prepare(source)
          if (!source.includes('SELECT g.board_id')) return statement
          const originalBind = statement.bind.bind(statement)
          return {
            ...statement,
            bind(...values: unknown[]) {
              const bound = originalBind(...values)
              return {
                ...bound,
                async all() {
                  const result = await bound.all()
                  if (!raced) {
                    raced = true
                    sql.exec("UPDATE board_grants SET revoked_at=1 WHERE id='racing-grant'; UPDATE counters SET value=value+1 WHERE name='access_revision'")
                  }
                  return result
                },
              }
            },
          }
        },
      } as unknown as D1Database
      const guest = await loadAccess(racing, { id: 'guest', isAdmin: false })
      expect(raced).toBe(true)
      expect(guest.revision).toBe('2')
      expect(guest.canEdit('private')).toBe(false)
    } finally { sql.close() }
  })
  it('keeps Toy boxes private even from admins and refuses unknown board IDs', async () => {
    const { sql, db } = fixture()
    try {
      const admin = await loadAccess(db, { id: 'admin', isAdmin: true })
      expect(admin.canManage('private')).toBe(true)
      expect(admin.canRead('toybox:new')).toBe(false)
      expect(admin.canEdit('missing')).toBe(false)
      expect((await loadAccess(db, { id: 'new', isAdmin: false })).canEdit('toybox:new')).toBe(true)
    } finally { sql.close() }
  })
  it('accepts a new personal Toy box when field-diff serialization omits null parentId', async () => {
    const { sql, db } = fixture()
    try {
      sql.exec("UPDATE objects SET data=json_remove(data,'$.parentId') WHERE id='toybox:new'")
      const guest = await loadAccess(db, { id: 'guest', isAdmin: false })
      expect(await deniedChanges(db, guest, 'guest', [{ id: 'toybox:guest', patch: { kind: 'board', title: 'Toy box', icon: 'ball' } }])).toEqual([])
      expect(await deniedChanges(db, guest, 'guest', [{ id: 'toybox:old', patch: { title: 'Stolen' } }])).toEqual(['toybox:old'])
      expect(await deniedChanges(db, guest, 'guest', [{ id: 'new-personal', patch: { kind: 'board', title: 'Private root' } }])).toEqual([])
      // A later quick capture sends explicit null while the stored startup
      // board omitted it. This is an unchanged parent, not a reparent.
      expect(await deniedChanges(db, await loadAccess(db, { id: 'new', isAdmin: false }), 'new', [{ id: 'toybox:new', patch: { kind: 'board', parentId: null, title: 'Toy box' } }])).toEqual([])
    } finally { sql.close() }
  })
  it('rejects nested columns and new relations to deleted cards', async () => {
    const { sql, db } = fixture()
    try {
      const owner = await loadAccess(db, { id: 'new', isAdmin: false })
      const nested = [
        { id: 'column-a', patch: { kind: 'card', type: 'column', boardId: 'private', columnId: 'column-b', content: { title: 'A' } } },
        { id: 'column-b', patch: { kind: 'card', type: 'column', boardId: 'private', columnId: 'column-a', content: { title: 'B' } } },
      ]
      expect(await deniedChanges(db, owner, 'new', nested)).toEqual(['column-a', 'column-b'])
      sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES ('dead','card','private',?,1,1)").run(JSON.stringify({ id: 'dead', kind: 'card', type: 'note', boardId: 'private', deletedAt: 1 }))
      expect(await deniedChanges(db, owner, 'new', [{ id: 'new-reply', patch: { kind: 'comment', boardId: 'private', cardId: 'dead', text: 'Cannot reply to a deleted card' } }])).toEqual(['new-reply'])
    } finally { sql.close() }
  })
  it('preserves legacy public links while new links lock references outside canonical ancestry', async () => {
    const { sql, db, board } = fixture()
    try {
      board('other-root', null, 'new')
      const insert = sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES (?,'card',?,?,1,1)")
      insert.run('private-ref', 'private', JSON.stringify({ id: 'private-ref', kind: 'card', type: 'board', boardId: 'private', content: { boardId: 'other-root' } }))
      insert.run('inner-ref', 'private', JSON.stringify({ id: 'inner-ref', kind: 'card', type: 'board', boardId: 'private', content: { boardId: 'inner' } }))
      insert.run('other-secret', 'other-root', JSON.stringify({ id: 'other-secret', kind: 'card', type: 'note', boardId: 'other-root', content: { md: 'unrelated private content' } }))
      insert.run('trashed-card', 'private', JSON.stringify({ id: 'trashed-card', kind: 'card', type: 'note', boardId: 'private', deletedAt: 1, content: { md: 'discarded note' } }))
      sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES ('orphan-comment','comment','private',?,1,1)").run(JSON.stringify({ id: 'orphan-comment', kind: 'comment', boardId: 'private', cardId: 'trashed-card', text: 'comment on discarded note' }))
      sql.exec("INSERT INTO shares(token,board_id,created_by,created_at,scope_version) VALUES ('old-view','private','new',1,0),('new-view','private','new',1,1)")
      const legacy = await resolveShare(db, 'old-view')
      expect(legacy?.sharedBoards.has('other-root')).toBe(true)
      expect(JSON.stringify(legacy?.objects)).toContain('unrelated private content')
      expect(JSON.stringify(legacy?.objects)).not.toContain('comment on discarded note')
      const current = await resolveShare(db, 'new-view')
      expect(current?.sharedBoards.has('inner')).toBe(true)
      expect(current?.sharedBoards.has('other-root')).toBe(false)
      expect(JSON.stringify(current?.objects)).not.toContain('unrelated private content')
      expect(JSON.stringify(current?.objects)).not.toContain('comment on discarded note')
      expect(current?.objects.find((o) => o.id === 'other-root')).toMatchObject({ title: 'Board', icon: 'paw' })
      sql.exec("UPDATE shares SET include_children=0 WHERE token='new-view'")
      const rootOnly = await resolveShare(db, 'new-view')
      expect([...rootOnly!.sharedBoards]).toEqual(['private'])
      expect(rootOnly?.objects.find((o) => o.id === 'inner')).toMatchObject({ title: 'Board' })
    } finally { sql.close() }
  })
  it('atomically refuses revoked/expired link redemption and stale authorized writes', async () => {
    const { sql, db, grant } = fixture()
    try {
      sql.exec("INSERT INTO shares(token,board_id,permission,created_by,created_at,expires_at) VALUES ('expired','private','edit','new',1,1)")
      expect(() => grant('expired-grant', true, 'expired')).toThrow('Board invitation is unavailable')
      sql.exec("INSERT INTO shares(token,board_id,permission,created_by,created_at,expires_at,revoked_at) VALUES ('revoked','private','edit','new',1,9999999999999,1)")
      sql.exec('BEGIN')
      try {
        sql.exec("INSERT INTO users VALUES ('racing','racing','hash',0,5)")
        expect(() => sql.exec("INSERT INTO board_grants(id,board_id,user_id,permission,source_token,created_by,created_at) VALUES ('race','private','racing','edit','revoked','new',1)")).toThrow('Board invitation is unavailable')
      } finally { sql.exec('ROLLBACK') }
      expect(sql.prepare("SELECT 1 FROM users WHERE id='racing'").get()).toBeUndefined()
      await expect(accessGuard(db, '1').run()).resolves.toBeDefined()
      await expect(accessGuard(db, '1', ['unused']).run()).resolves.toBeDefined()
      await expect(accessGuard(db, '1', ['private']).run()).rejects.toThrow('Access changed')
      sql.exec("UPDATE counters SET value=2 WHERE name='access_revision'")
      await expect(accessGuard(db, '1').run()).rejects.toThrow('Access changed')
    } finally { sql.close() }
  })
})
