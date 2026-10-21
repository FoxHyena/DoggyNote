import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { duplicateObjects, remapCardLabels, type Board, type Card, type Obj } from '@doggynote/core'
import { sync } from './sync.ts'
import { sha256Hex } from './crypto.ts'
import type { AppEnv, Env } from './env.ts'

/** Production proposal SQL runs on SQLite, including atomic D1-batch rollback. */
async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  const now = Date.now()
  sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run('rex', 'rex', 'unused', 0, now)
  sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run('fido', 'fido', 'unused', 0, now)
  sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex('test-session'), 'rex', now, now + 100000)
  const root = { id: 'root', kind: 'board', title: 'Root', parentId: null, icon: 'paw', color: 'gold', createdAt: now }
  sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at) VALUES(?,'board',?,1,?)").run('root', JSON.stringify(root), now)
  sql.exec("INSERT INTO board_access(board_id,owner_id,legacy) VALUES('root','rex',0); UPDATE counters SET value=1 WHERE name='seq'")
  let beforeBatch: (() => void) | undefined
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
      const hook = beforeBatch; beforeBatch = undefined; hook?.()
      sql.exec('BEGIN')
      try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result } catch (e) { sql.exec('ROLLBACK'); throw e }
    },
  } as unknown as D1Database
  const app = new Hono<AppEnv>().basePath('/api').use('*', async (c, next) => { c.set('user', { id: c.req.header('test-user') ?? 'rex', username: 'rex', isAdmin: false, createdAt: now }); await next() }).route('/', sync)
  const request = (path: string, body?: unknown, user = 'rex') => app.request(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'test-user': user, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: db } as Env)
  const card = (id: string, text: string, extra = {}) => ({ id, kind: 'card', type: 'note', boardId: 'root', x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', content: { md: text }, createdAt: now, ...extra })
  return { sql, request, card, beforeBatch: (hook: () => void) => { beforeBatch = hook } }
}


const board = (id: string) => ({ id, patch: { id, kind: 'board', parentId: null, title: id, icon: 'paw', color: 'none', createdAt: 1 } })
const push = (f: Awaited<ReturnType<typeof fixture>>, changes: { id: string; patch: object }[], user = 'rex') => f.request('/sync', { changes }, user)
const read = (f: Awaited<ReturnType<typeof fixture>>, id: string) => JSON.parse((f.sql.prepare('SELECT data FROM objects WHERE id=?').get(id) as { data: string }).data)

it('atomically shares bodies across boards, keeps layout local, joins current body and restores live text from trash', async () => {
  const f = await fixture()
  try {
    expect((await push(f, [board('research')])).status).toBe(200)
    expect((await push(f, ['overview', 'research-note'].map((id, i) => ({ id, patch: f.card(id, 'Brief', { boardId: i ? 'research' : 'root', noteGroupId: 'shared-brief' }) })))).status).toBe(200)
    expect((await push(f, [{ id: 'research-note', patch: { content: { md: 'Research edit' }, x: 199 } }])).status).toBe(200)
    expect(read(f, 'overview').content.md).toBe('Research edit')
    expect(read(f, 'overview').x).toBe(0)
    expect((await push(f, [{ id: 'overview', patch: { deletedAt: 20 } }, { id: 'research-note', patch: { content: { md: 'After trash' } } }])).status).toBe(200)
    expect(read(f, 'overview')).toMatchObject({ deletedAt: 20, content: { md: 'After trash' } })
    expect((await push(f, [{ id: 'overview', patch: { deletedAt: null } }])).status).toBe(200)
    expect((await push(f, [{ id: 'third', patch: f.card('third', 'Stale source snapshot', { noteGroupId: 'shared-brief' }) }])).status).toBe(200)
    expect(read(f, 'third').content.md).toBe('After trash')
    expect(read(f, 'research-note').content.md).toBe('After trash')
    expect((await push(f, [{ id: 'overview', patch: { noteGroupId: null, content: { md: 'Independent version' } } }])).status).toBe(200)
    expect(read(f, 'research-note').content.md).toBe('After trash')
    expect((await push(f, [{ id: 'research-note', patch: { purged: true } }, { id: 'third', patch: { content: { md: 'Last one' } } }])).status).toBe(200)
    expect(read(f, 'third').content.md).toBe('Last one')
    expect(read(f, 'research-note').content.md).toBe('After trash')
  } finally { f.sql.close() }
})

it('does not grant hidden body editing, leak locations or trust caller capabilities; local unlink remains possible', async () => {
  const f = await fixture()
  try {
    await push(f, [board('private-research')])
    await push(f, [{ id: 'visible', patch: f.card('visible', 'Brief', { noteGroupId: 'secret-group' }) }, { id: 'hidden-instance', patch: f.card('hidden-instance', 'Brief', { boardId: 'private-research', noteGroupId: 'secret-group' }) }])
    f.sql.exec("INSERT INTO board_grants(id,board_id,user_id,permission,include_children,created_by,created_at) VALUES('grant','root','fido','edit',0,'rex',1); UPDATE counters SET value=value+1 WHERE name='access_revision'")
    const response = await f.request('/sync?since=0', undefined, 'fido')
    const body = await response.json() as { objects: Record<string, unknown>[] }
    expect(body.objects.find((o) => o.id === 'visible')).toMatchObject({ noteBodyReadOnly: true })
    expect(JSON.stringify(body)).not.toContain('private-research')
    expect(JSON.stringify(body)).not.toContain('hidden-instance')
    const denied = await push(f, [{ id: 'visible', patch: { content: { md: 'Unauthorized' }, noteBodyReadOnly: false } }], 'fido')
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain('hidden-instance')
    expect(read(f, 'hidden-instance').content.md).toBe('Brief')
    expect((await push(f, [{ id: 'visible', patch: { x: 42, noteBodyReadOnly: false } }], 'fido')).status).toBe(200)
    expect(read(f, 'visible').noteBodyReadOnly).toBeUndefined()
    expect((await push(f, [{ id: 'forged', patch: f.card('forged', 'Brief', { noteGroupId: 'secret-group' }) }], 'fido')).status).toBe(403)
    expect((await push(f, [{ id: 'visible', patch: { noteGroupId: null, content: { md: 'My separate version' } } }], 'fido')).status).toBe(200)
    expect(read(f, 'hidden-instance').content.md).toBe('Brief')
  } finally { f.sql.close() }
})

it('rejects permission and membership races atomically, without partially writing a body', async () => {
  const f = await fixture()
  try {
    await push(f, [{ id: 'one', patch: f.card('one', 'Before', { noteGroupId: 'g' }) }, { id: 'two', patch: f.card('two', 'Before', { noteGroupId: 'g' }) }])
    f.beforeBatch(() => f.sql.exec("UPDATE counters SET value=value+1 WHERE name='seq'"))
    expect((await push(f, [{ id: 'one', patch: { content: { md: 'Racing' } } }])).status).toBe(409)
    expect(read(f, 'one').content.md).toBe('Before')
    expect(read(f, 'two').content.md).toBe('Before')
    f.beforeBatch(() => f.sql.exec("UPDATE counters SET value=value+1 WHERE name='access_revision'"))
    expect((await push(f, [{ id: 'one', patch: { content: { md: 'Revoked' } } }])).status).toBe(409)
    expect(read(f, 'two').content.md).toBe('Before')
  } finally { f.sql.close() }
})

it('rejects conflicting bodies within one push and malformed membership', async () => {
  const f = await fixture()
  try {
    expect((await push(f, [{ id: 'one', patch: f.card('one', 'One', { noteGroupId: 'g' }) }, { id: 'two', patch: f.card('two', 'Two', { noteGroupId: 'g' }) }])).status).toBe(403)
    expect(f.sql.prepare("SELECT 1 FROM objects WHERE id='one'").get()).toBeUndefined()
    expect((await push(f, [{ id: 'bad', patch: f.card('bad', 'Bad', { noteGroupId: {} }) }])).status).toBe(403)
  } finally { f.sql.close() }
})

it('preserves edit intent when another session unlinks a busy instance', async () => {
  const f = await fixture()
  try {
    await push(f, [{ id: 'one', patch: f.card('one', 'Original', { noteGroupId: 'g' }) }, { id: 'two', patch: f.card('two', 'Original', { noteGroupId: 'g' }) }])
    await push(f, [{ id: 'two', patch: { noteGroupId: null, content: { md: 'Independent' } } }])
    const response = await push(f, [{ id: 'two', patch: { noteBodyEdit: { groupId: 'g', md: 'Stale linked edit' } } }])
    expect(response.status).toBe(403)
    expect(read(f, 'two').content.md).toBe('Independent')
    expect((await push(f, [{ id: 'one', patch: { noteBodyEdit: { groupId: 'g', md: 'Latest linked edit' } } }])).status).toBe(200)
    expect(read(f, 'one').content.md).toBe('Latest linked edit')
    expect(read(f, 'two').content.md).toBe('Independent')
    expect(read(f, 'one').noteBodyEdit).toBeUndefined()
  } finally { f.sql.close() }
})

it('accepts edits made before a new linked pair first syncs', async () => {
  const f = await fixture()
  try {
    const changes = ['one', 'two'].map((id) => ({ id, patch: { ...f.card(id, 'Creation snapshot', { noteGroupId: 'g' }), noteBodyEdit: { groupId: 'g', md: 'Typing before first sync' } } }))
    expect((await push(f, changes)).status).toBe(200)
    expect(read(f, 'one').content.md).toBe('Typing before first sync')
    expect(read(f, 'two').content.md).toBe('Typing before first sync')
  } finally { f.sql.close() }
})

it('recomputes shared-body capability after grants/revocation without revealing other locations', async () => {
  const f = await fixture()
  try {
    await push(f, [board('research')])
    await push(f, [{ id: 'one', patch: f.card('one', 'Brief', { noteGroupId: 'g' }) }, { id: 'two', patch: f.card('two', 'Brief', { boardId: 'research', noteGroupId: 'g' }) }])
    f.sql.exec("INSERT INTO board_grants(id,board_id,user_id,permission,include_children,created_by,created_at) VALUES('a','root','fido','edit',0,'rex',1),('b','research','fido','edit',0,'rex',1); UPDATE counters SET value=value+1 WHERE name='access_revision'")
    let snapshot = await (await f.request('/sync?since=0', undefined, 'fido')).json() as { objects: { id: string; noteBodyReadOnly?: boolean }[] }
    expect(snapshot.objects.find((o) => o.id === 'one')?.noteBodyReadOnly).toBe(false)
    expect((await push(f, [{ id: 'one', patch: { noteBodyEdit: { groupId: 'g', md: 'Authorized collaboration' } } }], 'fido')).status).toBe(200)
    expect(read(f, 'two').content.md).toBe('Authorized collaboration')
    f.sql.exec("UPDATE board_grants SET revoked_at=2 WHERE id='b'; UPDATE counters SET value=value+1 WHERE name='access_revision'")
    snapshot = await (await f.request('/sync?since=0', undefined, 'fido')).json() as typeof snapshot
    expect(snapshot.objects.find((o) => o.id === 'one')?.noteBodyReadOnly).toBe(true)
    expect(snapshot.objects.some((o) => o.id === 'two')).toBe(false)
    expect((await push(f, [{ id: 'one', patch: { noteBodyEdit: { groupId: 'g', md: 'After revocation' } } }], 'fido')).status).toBe(403)
    expect(read(f, 'two').content.md).toBe('Authorized collaboration')
  } finally { f.sql.close() }
})

it('integrates the actual loop6 graph copier: copied cross-board groups share independently of originals', async () => {
  const f = await fixture()
  try {
    await push(f, [{ id: 'research', patch: { ...board('research').patch, parentId: 'root' } }])
    await push(f, [{ id: 'one', patch: f.card('one', 'Original brief', { noteGroupId: 'g' }) }, { id: 'two', patch: f.card('two', 'Original brief', { boardId: 'research', noteGroupId: 'g' }) }])
    const originals = (f.sql.prepare('SELECT data FROM objects').all() as { data: string }[]).map((row) => JSON.parse(row.data) as Obj)
    const copied = duplicateObjects(originals, { rootBoardId: 'root', title: 'Independent research copy' })
    const first = copied.idMap.get('one')!, second = copied.idMap.get('two')!
    const copiedGroup = (copied.objects.find((o) => o.id === first) as { noteGroupId: string }).noteGroupId
    expect(copiedGroup).toBeTruthy()
    expect(copiedGroup).not.toBe('g')
    expect((await push(f, copied.objects.map((object) => ({ id: object.id, patch: object })))).status).toBe(200)
    expect((await push(f, [{ id: second, patch: { noteBodyEdit: { groupId: copiedGroup, md: 'Copied project revision' } } }])).status).toBe(200)
    expect(read(f, first).content.md).toBe('Copied project revision')
    expect(read(f, 'one').content.md).toBe('Original brief')
    expect(read(f, 'two').content.md).toBe('Original brief')
    const singleton = duplicateObjects(originals, { selectionIds: ['one'], targetBoardId: 'root' })
    expect((singleton.objects[0] as { noteGroupId?: unknown }).noteGroupId).toBeNull()
    const reused = duplicateObjects(copied.objects, { rootBoardId: copied.rootId! })
    expect((reused.objects.find((o) => o.kind === 'card') as { noteGroupId: string }).noteGroupId).not.toBe(copiedGroup)
    const access = f.sql.prepare('SELECT owner_id FROM board_access WHERE board_id=?').get(copied.rootId!) as { owner_id: string }
    expect(access.owner_id).toBe('rex')
    expect(f.sql.prepare('SELECT 1 FROM board_grants WHERE board_id=?').get(copied.rootId!)).toBeUndefined()
  } finally { f.sql.close() }
})

it('redoing a first synced link adopts the current source body instead of reviving a stale copy snapshot', async () => {
  const f = await fixture()
  try {
    await push(f, [{ id: 'source', patch: f.card('source', 'Initial body', { noteGroupId: 'g' }) }, { id: 'copy', patch: f.card('copy', 'Initial body', { noteGroupId: 'g' }) }])
    await push(f, [{ id: 'source', patch: { noteGroupId: null } }, { id: 'copy', patch: { purged: true } }])
    await push(f, [{ id: 'source', patch: { content: { md: 'Remote independent revision' } } }])
    const redo = await push(f, [{ id: 'source', patch: { noteGroupId: 'g' } }, { id: 'copy', patch: f.card('copy', 'Initial body', { noteGroupId: 'g', purged: false }) }])
    expect(redo.status).toBe(200)
    expect(read(f, 'source').content.md).toBe('Remote independent revision')
    expect(read(f, 'copy').content.md).toBe('Remote independent revision')
  } finally { f.sql.close() }
})

it('keeps personal Inbox ownership private when its body is linked to a shared board', async () => {
  const f = await fixture()
  try {
    expect((await push(f, [board('toybox:rex')])).status).toBe(200)
    expect((await push(f, [
      { id: 'shared', patch: f.card('shared', 'Published project brief', { noteGroupId: 'inbox-group' }) },
      { id: 'personal', patch: f.card('personal', 'Published project brief', { boardId: 'toybox:rex', noteGroupId: 'inbox-group' }) },
    ])).status).toBe(200)
    f.sql.exec("INSERT INTO board_grants(id,board_id,user_id,permission,include_children,created_by,created_at) VALUES('grant','root','fido','edit',0,'rex',1); UPDATE counters SET value=value+1 WHERE name='access_revision'")
    const snapshot = await (await f.request('/sync?since=0', undefined, 'fido')).json() as { objects: { id: string; noteBodyReadOnly?: boolean }[] }
    expect(snapshot.objects.find((o) => o.id === 'shared')).toMatchObject({ noteBodyReadOnly: true })
    expect(JSON.stringify(snapshot)).not.toContain('toybox:rex')
    expect(snapshot.objects.some((o) => o.id === 'personal')).toBe(false)
    const denied = await push(f, [{ id: 'shared', patch: { noteBodyEdit: { groupId: 'inbox-group', md: 'Overwrite personal Inbox' } } }], 'fido')
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain('personal')
    expect(read(f, 'personal').content.md).toBe('Published project brief')
    expect((await push(f, [{ id: 'personal', patch: { noteBodyEdit: { groupId: 'inbox-group', md: 'Owner-approved update' } } }])).status).toBe(200)
    expect(read(f, 'shared').content.md).toBe('Owner-approved update')
    expect((await push(f, [{ id: 'shared', patch: { noteGroupId: null, content: { md: 'Independent collaborator version' } } }], 'fido')).status).toBe(200)
    expect(read(f, 'personal')).toMatchObject({ noteGroupId: 'inbox-group', content: { md: 'Owner-approved update' } })
  } finally { f.sql.close() }
})


it('accepts atomic labelled linked and independent cross-board copies without changing source attribution', async () => {
  const f = await fixture(), token = 'a'.repeat(32)
  try {
    await push(f, [board('label-destination')])
    const source = f.card('label-source', 'Brief', { [`label${token}`]: true }) as Card<'note'>
    expect((await push(f, [{ id: 'root', patch: { [`labelName${token}`]: 'Lighting', [`labelColor${token}`]: 'gold' } }, { id: source.id, patch: source }])).status).toBe(200)
    const origin = read(f, 'root') as Board
    const copied = { ...source, id: 'bad-label-copy', boardId: 'label-destination' }
    // Retaining a source-board label identity is rejected by actual sync authorization.
    expect((await push(f, [{ id: copied.id, patch: copied }])).status).toBe(403)
    for (const synced of [false, true]) {
      const current = read(f, source.id) as Card<'note'>
      const destination = read(f, 'label-destination') as Board
      const labels = remapCardLabels([current], origin, destination)
      const group = synced ? 'labelled-body-group' : null
      const copy = { ...current, ...labels.cards[current.id], id: synced ? 'label-linked' : 'label-independent', boardId: destination.id, noteGroupId: group }
      const changes: { id: string; patch: object }[] = [{ id: copy.id, patch: copy }]
      if (Object.keys(labels.board).length) changes.unshift({ id: destination.id, patch: labels.board })
      if (synced) changes.unshift({ id: current.id, patch: { noteGroupId: group } })
      const response = await push(f, changes)
      expect(response.status, await response.clone().text()).toBe(200)
      expect(read(f, source.id)).toMatchObject({ [`label${token}`]: true, content: { md: 'Brief' } })
      expect(read(f, 'root')).toEqual(origin)
      expect(read(f, copy.id)[`label${token}`]).toBeNull()
    }
  } finally { f.sql.close() }
})
