import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { agents } from './agents.ts'
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
  const app = new Hono<AppEnv>().basePath('/api').route('/', agents)
  const request = (path: string, body?: unknown, token = 'test-session', method = body === undefined ? 'GET' : 'POST') => app.request(`/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: db } as Env)
  const connection = await request('/agent-connections', { name: 'Test client', mode: 'propose', boardIds: ['root'] })
  expect(connection.status).toBe(201)
  const { token, id: credentialId } = await connection.json() as { token: string; id: string }
  const card = (id: string, text: string) => ({ id, kind: 'card', type: 'note', boardId: 'root', x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', content: { md: text }, createdAt: now })
  return { sql, request, token, credentialId, card, beforeBatch: (hook: () => void) => { beforeBatch = hook } }
}

it('stages idempotently, rejects machine approval, applies atomically and reverses after measurement', async () => {
  const f = await fixture()
  try {
    const body = { idempotencyKey: 'create-notes', label: 'Create two notes', operations: [f.card('first', 'First'), f.card('second', 'Second')].map((object) => ({ action: 'create', object })) }
    const staged = await f.request('/agent/proposals', body, f.token)
    expect(staged.status).toBe(201)
    const { id } = await staged.json() as { id: string }
    expect(f.sql.prepare("SELECT 1 FROM objects WHERE id='first'").get()).toBeUndefined()
    expect((await (await f.request('/agent/proposals', body, f.token)).json() as { id: string }).id).toBe(id)
    expect((await f.request(`/agent-proposals/${id}/approve`, {}, f.token)).status).toBe(401)
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    const revision = (f.sql.prepare("SELECT seq FROM objects WHERE id='first'").get() as { seq: number }).seq
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    expect((f.sql.prepare("SELECT seq FROM objects WHERE id='first'").get() as { seq: number }).seq).toBe(revision)
    f.sql.exec("UPDATE counters SET value=value+1 WHERE name='seq'; UPDATE objects SET data=json_set(data,'$.h',123),seq=(SELECT value FROM counters WHERE name='seq') WHERE id='first'")
    // Revoking the machine cannot stop the person reversing its prior edits.
    await f.request(`/agent-connections/${f.credentialId}`, undefined, 'test-session', 'DELETE')
    expect((await f.request(`/agent-proposals/${id}/reverse`, {})).status).toBe(200)
    const reversed = JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='first'").get() as { data: string }).data)
    expect(reversed.deletedAt).toBeGreaterThan(0)
    expect(reversed.h).toBe(123)
  } finally { f.sql.close() }
})

it('an intervening object creation rejects every write and keeps the proposal pending', async () => {
  const f = await fixture()
  try {
    const staged = await f.request('/agent/proposals', { idempotencyKey: 'atomic-collision', label: 'Two atomic notes', operations: [f.card('collision', 'Agent'), f.card('untouched', 'Other')].map((object) => ({ action: 'create', object })) }, f.token)
    const { id } = await staged.json() as { id: string }
    f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('collision','card','root',?,2,1)").run(JSON.stringify(f.card('collision', 'Human')))
    const response = await f.request(`/agent-proposals/${id}/approve`, {})
    expect(response.status).toBe(409)
    expect(f.sql.prepare("SELECT 1 FROM objects WHERE id='untouched'").get()).toBeUndefined()
    expect(f.sql.prepare('SELECT status FROM agent_proposals WHERE id=?').get(id)).toMatchObject({ status: 'pending' })
    expect(JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='collision'").get() as { data: string }).data).content.md).toBe('Human')
  } finally { f.sql.close() }
})

it('lets a legacy editor rename a root whose stored parentId was omitted', async () => {
  const f = await fixture()
  try {
    // Older sync records omit null fields. Normalizing that root must not turn
    // an ordinary title edit into an owner-only board move.
    f.sql.exec("UPDATE objects SET data=json_remove(data,'$.parentId') WHERE id='root'; UPDATE board_access SET owner_id=NULL,legacy=1 WHERE board_id='root'; INSERT INTO legacy_members(user_id) VALUES('rex')")
    const read = await (await f.request('/agent/boards/root', undefined, f.token)).json() as { board: { object: Record<string, unknown>; revision: number } }
    expect(read.board.object.parentId).toBeUndefined()
    const staged = await f.request('/agent/proposals', {
      idempotencyKey: 'legacy-root-title', label: 'Rename legacy root',
      operations: [{ action: 'replace', expectedRevision: read.board.revision, object: { ...read.board.object, parentId: null, title: 'Renamed legacy root' } }],
    }, f.token)
    expect(staged.status).toBe(201)
    const { id } = await staged.json() as { id: string }
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    const stored = JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='root'").get() as { data: string }).data)
    expect(stored).toMatchObject({ title: 'Renamed legacy root', parentId: null })
    expect(f.sql.prepare("SELECT owner_id FROM board_access WHERE board_id='root'").get()).toMatchObject({ owner_id: null })
  } finally { f.sql.close() }
})

it.each(['resolve with null defaults', 'remove author edit timestamp', 'change author id', 'change author name'])('authorizes every changed field in a foreign comment replacement: %s', async (action) => {
  const f = await fixture()
  try {
    const now = Date.now()
    f.sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run('spot', 'spot', 'unused', 0, now)
    f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('note','card','root',?,2,?)").run(JSON.stringify(f.card('note', 'Shared note')), now)
    const comment = { id: 'comment', kind: 'comment', boardId: 'root', cardId: 'note', authorId: 'spot', author: 'spot', text: 'Spot’s comment', createdAt: now, editedAt: now }
    f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('comment','comment','root',?,3,?)").run(JSON.stringify(comment), now)
    f.sql.exec("UPDATE counters SET value=3 WHERE name='seq'")
    const { editedAt: _, ...withoutEditTimestamp } = comment
    const object = action === 'resolve with null defaults' ? { ...comment, deletedAt: null, resolvedAt: now + 1 }
      : action === 'change author id' ? { ...comment, authorId: 'rex' }
      : action === 'change author name' ? { ...comment, author: 'rex' }
      : withoutEditTimestamp
    const response = await f.request('/agent/proposals', { idempotencyKey: 'foreign-comment-check', label: 'Review comment', operations: [{ action: 'replace', expectedRevision: 3, object }] }, f.token)
    if (action !== 'resolve with null defaults') {
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: action === 'remove author edit timestamp' ? 'Only the author can change a comment' : 'Comment author cannot change' })
    } else {
      expect(response.status).toBe(201)
      const { id } = await response.json() as { id: string }
      expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
      const stored = JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='comment'").get() as { data: string }).data)
      expect(stored).toMatchObject({ authorId: 'spot', text: comment.text, editedAt: now, resolvedAt: now + 1 })
      // Later author-only deletion must hide the saved proposal snapshots too.
      f.sql.prepare("UPDATE objects SET owner_id='spot',data=json_set(data,'$.deletedAt',?) WHERE id='comment'").run(now + 2)
      expect((await f.request(`/agent-proposals/${id}`)).status).toBe(403)
      expect(await (await f.request('/agent-proposals')).json()).toEqual({ proposals: [] })
    }
  } finally { f.sql.close() }
})

it('never stages another person’s private comment when moving its card', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    f.sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run('spot', 'spot', 'unused', 0, now)
    const child = { id: 'child', kind: 'board', parentId: 'root', title: 'Child', icon: 'paw', color: 'gold', createdAt: now }
    f.sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at) VALUES('child','board',?,2,?)").run(JSON.stringify(child), now)
    f.sql.exec("INSERT INTO board_access(board_id,owner_id,legacy) VALUES('child','rex',0)")
    const note = f.card('note', 'Move me')
    f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('note','card','root',?,3,?)").run(JSON.stringify(note), now)
    const hidden = { id: 'hidden', kind: 'comment', boardId: 'root', cardId: 'note', authorId: 'spot', author: 'spot', text: 'Private deleted comment', createdAt: now, deletedAt: now }
    f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,owner_id,seq,updated_at) VALUES('hidden','comment','root',?,'spot',4,?)").run(JSON.stringify(hidden), now)
    f.sql.exec("UPDATE counters SET value=4 WHERE name='seq'")
    const response = await f.request('/agent/proposals', { idempotencyKey: 'move-visible-only', label: 'Move visible note', operations: [{ action: 'replace', expectedRevision: 3, object: { ...note, boardId: 'child' } }] }, f.token)
    expect(response.status).toBe(201)
    const { id, changedObjects } = await response.json() as { id: string; changedObjects: number }
    expect(changedObjects).toBe(1)
    const preview = await (await f.request(`/agent-proposals/${id}`)).json()
    expect(JSON.stringify(preview)).not.toContain(hidden.text)
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
  } finally { f.sql.close() }
})

it('rejects reversal when a dependent card is created after validation but before the atomic write', async () => {
  const f = await fixture()
  try {
    const column = { ...f.card('column', ''), type: 'column', content: { title: 'New column' } }
    const staged = await f.request('/agent/proposals', { idempotencyKey: 'reverse-race-check', label: 'Create a column', operations: [{ action: 'create', object: column }] }, f.token)
    expect(staged.status).toBe(201)
    const { id } = await staged.json() as { id: string }
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    f.beforeBatch(() => {
      f.sql.exec("UPDATE counters SET value=value+1 WHERE name='seq'")
      f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('new-child','card','root',?,(SELECT value FROM counters WHERE name='seq'),?)").run(JSON.stringify({ ...f.card('new-child', 'Human addition'), columnId: 'column' }), Date.now())
    })
    expect((await f.request(`/agent-proposals/${id}/reverse`, {})).status).toBe(409)
    expect(f.sql.prepare('SELECT status FROM agent_proposals WHERE id=?').get(id)).toMatchObject({ status: 'applied' })
    const stored = JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='column'").get() as { data: string }).data)
    expect(stored.deletedAt).toBeUndefined()
    expect(f.sql.prepare("SELECT 1 FROM objects WHERE id='new-child'").get()).toBeDefined()
  } finally { f.sql.close() }
})

it('rejects reversal when a comment is added to a moved card immediately before the atomic write', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    const child = { id: 'child', kind: 'board', parentId: 'root', title: 'Child', icon: 'paw', color: 'gold', createdAt: now }
    f.sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at) VALUES('child','board',?,2,?)").run(JSON.stringify(child), now)
    f.sql.exec("INSERT INTO board_access(board_id,owner_id,legacy) VALUES('child','rex',0)")
    const note = f.card('note', 'Move me')
    f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('note','card','root',?,3,?)").run(JSON.stringify(note), now)
    f.sql.exec("UPDATE counters SET value=3 WHERE name='seq'")
    const staged = await f.request('/agent/proposals', { idempotencyKey: 'reverse-move-race', label: 'Move a note', operations: [{ action: 'replace', expectedRevision: 3, object: { ...note, boardId: 'child' } }] }, f.token)
    expect(staged.status).toBe(201)
    const { id } = await staged.json() as { id: string }
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    f.beforeBatch(() => {
      f.sql.exec("UPDATE counters SET value=value+1 WHERE name='seq'")
      const comment = { id: 'new-comment', kind: 'comment', boardId: 'child', cardId: 'note', authorId: 'rex', author: 'rex', text: 'Added after the move', createdAt: now }
      f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('new-comment','comment','child',?,(SELECT value FROM counters WHERE name='seq'),?)").run(JSON.stringify(comment), now)
    })
    expect((await f.request(`/agent-proposals/${id}/reverse`, {})).status).toBe(409)
    expect(f.sql.prepare('SELECT status FROM agent_proposals WHERE id=?').get(id)).toMatchObject({ status: 'applied' })
    expect((f.sql.prepare("SELECT board_id FROM objects WHERE id='note'").get() as { board_id: string }).board_id).toBe('child')
  } finally { f.sql.close() }
})

it('older agent replacements preserve omitted labels and explicit tombstones remove them', async () => {
  const f = await fixture()
  const token = 'a'.repeat(32)
  try {
    const card = { ...f.card('labelled', 'A labelled reference'), [`label${token}`]: true }
    // Seed a board definition and item as an existing client would sync them.
    f.sql.prepare("UPDATE objects SET data=json_set(data,?,?) WHERE id='root'").run(`$.labelName${token}`, 'Lighting')
    f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('labelled','card','root',?,2,1)").run(JSON.stringify(card))
    f.sql.exec("UPDATE counters SET value=2 WHERE name='seq'")
    const propose = async (key: string, object: object, revision: number) => {
      const staged = await f.request('/agent/proposals', { idempotencyKey: key, label: 'Update labelled reference', operations: [{ action: 'replace', expectedRevision: revision, object }] }, f.token)
      expect(staged.status, await staged.clone().text()).toBe(201)
      const { id } = await staged.json() as { id: string }
      expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    }
    await propose('old-client-labels', f.card('labelled', 'Updated body'), 2)
    const row = () => f.sql.prepare("SELECT data,seq FROM objects WHERE id='labelled'").get() as { data: string; seq: number }
    expect(JSON.parse(row().data)[`label${token}`]).toBe(true)
    await propose('explicit-remove-label', { ...f.card('labelled', 'Updated body'), [`label${token}`]: false }, row().seq)
    expect(JSON.parse(row().data)[`label${token}`]).toBe(false)
  } finally { f.sql.close() }
})

it('includes every synced-body change in proposal preview, approval and reversal', async () => {
  const f = await fixture()
  try {
    const creation = await f.request('/agent/proposals', { idempotencyKey: 'create-synced-notes', label: 'Create synced notes', operations: ['one', 'two'].map((id) => ({ action: 'create', object: { ...f.card(id, 'Shared brief'), noteGroupId: 'brief-group' } })) }, f.token)
    expect(creation.status).toBe(201)
    const { id: creationId } = await creation.json() as { id: string }
    expect((await f.request(`/agent-proposals/${creationId}/approve`, {})).status).toBe(200)
    const before = f.sql.prepare("SELECT data,seq FROM objects WHERE id='one'").get() as { data: string; seq: number }
    const replace = await f.request('/agent/proposals', { idempotencyKey: 'edit-synced-notes', label: 'Update the brief', operations: [{ action: 'replace', expectedRevision: before.seq, object: { ...JSON.parse(before.data), content: { md: 'Revised brief' } } }] }, f.token)
    expect(replace.status).toBe(201)
    const { id, changedObjects } = await replace.json() as { id: string; changedObjects: number }
    expect(changedObjects).toBe(2)
    const preview = await (await f.request(`/agent-proposals/${id}`)).json() as { proposal: { changes: { after: { content: { md: string } } }[] } }
    expect(preview.proposal.changes.map((ch) => ch.after.content.md)).toEqual(['Revised brief', 'Revised brief'])
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    expect(JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='two'").get() as { data: string }).data).content.md).toBe('Revised brief')
    expect((await f.request(`/agent-proposals/${id}/reverse`, {})).status).toBe(200)
    expect(JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='two'").get() as { data: string }).data).content.md).toBe('Shared brief')
  } finally { f.sql.close() }
})
