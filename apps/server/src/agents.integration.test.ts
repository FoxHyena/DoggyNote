import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { noteDocument, noteState, replaceText } from '@doggynote/core'
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
  const stored = new Map<string, ArrayBuffer>()
  const BUCKET = { async head(key: string) { return stored.has(key) ? {} : null }, async put(key: string, body: ArrayBuffer) { stored.set(key, body) } } as unknown as R2Bucket
  const env = { DB: db, BUCKET } as Env
  const request = (path: string, body?: unknown, token = 'test-session', method = body === undefined ? 'GET' : 'POST') => app.request(`/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  const putImage = (path: string, token: string) => app.request(`/api${path}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/webp' }, body: new Uint8Array([1, 2, 3]) }, env)
  const connection = await request('/agent-connections', { name: 'Test client', mode: 'propose', boardIds: ['root'] })
  expect(connection.status).toBe(201)
  const { token, id: credentialId } = await connection.json() as { token: string; id: string }
  const card = (id: string, text: string) => ({ id, kind: 'card', type: 'note', boardId: 'root', x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', content: { md: text }, createdAt: now })
  return { sql, request, putImage, stored, token, credentialId, card, beforeBatch: (hook: () => void) => { beforeBatch = hook } }
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

it('agents never see labels, and their whole-object replacements keep them', async () => {
  const f = await fixture()
  try {
    const token = 'a1b2c3d4e5f6'
    f.sql.prepare("UPDATE objects SET data=json_set(data,?,?) WHERE id='root'").run(`$.labelName${token}`, 'Lighting')
    f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('labelled','card','root',?,2,1)").run(JSON.stringify({ ...f.card('labelled', 'Before'), [`label${token}`]: true }))
    f.sql.exec("UPDATE counters SET value=2 WHERE name='seq'")
    const read = await (await f.request('/agent/boards/root', undefined, f.token)).json() as { board: { object: Record<string, unknown> }; objects: { object: Record<string, unknown>; revision: number }[] }
    expect(read.board.object[`labelName${token}`]).toBeUndefined()
    const card = read.objects.find((o) => o.object.id === 'labelled')!
    expect(card.object[`label${token}`]).toBeUndefined()
    const staged = await f.request('/agent/proposals', { idempotencyKey: 'keep-labels', label: 'Edit labelled', operations: [{ action: 'replace', expectedRevision: card.revision, object: { ...card.object, content: { md: 'After' } } }] }, f.token)
    expect(staged.status).toBe(201)
    const { id } = await staged.json() as { id: string }
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    const stored = JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='labelled'").get() as { data: string }).data)
    expect(stored).toMatchObject({ content: { md: 'After' }, [`label${token}`]: true })
  } finally { f.sql.close() }
})

it('agent proposals create areas and members, preserve relative positions, and detach a removed area family',async()=>{
  const f=await fixture()
  try{
    const area={...f.card('area',''),type:'area',x:500,y:300,w:800,h:480,content:{title:'Project'}}
    const col={...f.card('col',''),type:'column',areaId:'area',x:24,y:72,content:{title:'Doing'}}
    const note={...f.card('context','Context'),areaId:'area',x:350,y:80}
    const child={...f.card('child','Workflow card'),columnId:'col',order:1}
    const proposed=await f.request('/agent/proposals',{idempotencyKey:'area-create',label:'Organize project',operations:[area,col,note,child].map(object=>({action:'create',object}))},f.token)
    expect(proposed.status,await proposed.clone().text()).toBe(201)
    const {id}=await proposed.json() as {id:string}
    expect((await f.request(`/agent-proposals/${id}/approve`,{})).status).toBe(200)
    const row=(id:string)=>f.sql.prepare('SELECT data,seq FROM objects WHERE id=?').get(id) as {data:string;seq:number}
    const original=JSON.parse(row('area').data)
    const move=await f.request('/agent/proposals',{idempotencyKey:'area-move',label:'Move project',operations:[{action:'replace',object:{...original,x:800,h:550},expectedRevision:row('area').seq}]},f.token)
    expect(move.status,await move.clone().text()).toBe(201)
    const moving=await move.json() as {id:string};expect((await f.request(`/agent-proposals/${moving.id}/approve`,{})).status).toBe(200)
    expect(JSON.parse(row('context').data)).toMatchObject({x:350,areaId:'area'})
    const remove=await f.request('/agent/proposals',{idempotencyKey:'area-remove',label:'Remove boundary',operations:[{action:'trash',id:'area',expectedRevision:row('area').seq}]},f.token)
    expect(remove.status,await remove.clone().text()).toBe(201)
    const removing=await remove.json() as {id:string};expect((await f.request(`/agent-proposals/${removing.id}/approve`,{})).status).toBe(200)
    expect(JSON.parse(row('context').data)).toMatchObject({x:1150,y:380,areaId:null})
    expect(JSON.parse(row('col').data)).toMatchObject({x:824,y:372,areaId:null})
    expect(JSON.parse(row('child').data)).toMatchObject({columnId:'col'})
  }finally{f.sql.close()}
})

it('an approved edit to a synced note updates every copy, or unsyncs it when a copy is out of reach', async () => {
  const f = await fixture()
  try {
    const doc = noteDocument()
    replaceText(doc.getText('markdown'), 'Walk at 6')
    const clone = noteState(doc); doc.destroy()
    f.sql.exec("INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES('fido','fido','unused',0,1)")
    for (const [board, owner] of [['other', 'rex'], ['kennel', 'fido']]) {
      f.sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at) VALUES(?,'board',?,1,1)").run(board, JSON.stringify({ id: board, kind: 'board', title: board, parentId: null, icon: 'paw', color: 'gold', createdAt: 1 }))
      f.sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(board, owner)
    }
    const put = (id: string, board: string, group: string, seq: number) => {
      f.sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES(?,'card',?,?,?,1)").run(id, board, JSON.stringify({ ...f.card(id, 'Walk at 6'), boardId: board, syncId: group }), seq)
      f.sql.prepare('INSERT INTO note_states(id,state,revision) VALUES(?,?,1)').run(id, clone)
    }
    put('a', 'root', 'a', 2); put('b', 'other', 'a', 3)
    put('x', 'root', 'x', 4); put('y', 'kennel', 'x', 5)
    f.sql.exec("UPDATE counters SET value=5 WHERE name='seq'")
    const edit = async (id: string, text: string) => {
      const read = await (await f.request('/agent/boards/root', undefined, f.token)).json() as { objects: { object: Record<string, unknown>; revision: number }[] }
      const card = read.objects.find((o) => o.object.id === id)!
      // Sync membership is the app's: agents never see it.
      expect(card.object.syncId).toBeUndefined()
      const staged = await f.request('/agent/proposals', { idempotencyKey: `synced-edit-${id}`, label: 'Edit', operations: [{ action: 'replace', expectedRevision: card.revision, object: { ...card.object, content: { md: text } } }] }, f.token)
      expect(staged.status, await staged.clone().text()).toBe(201)
      return f.request(`/agent-proposals/${(await staged.json() as { id: string }).id}/approve`, {})
    }
    const stored = (id: string) => JSON.parse((f.sql.prepare('SELECT data FROM objects WHERE id=?').get(id) as { data: string }).data)
    expect((await edit('a', 'Walk at 7')).status).toBe(200)
    expect(stored('a')).toMatchObject({ syncId: 'a', content: { md: 'Walk at 7' } })
    expect(stored('b')).toMatchObject({ syncId: 'a', content: { md: 'Walk at 7' } })
    // y is on fido's board, which rex can't edit: x keeps the edit and stops syncing.
    expect((await edit('x', 'Walk at 8')).status).toBe(200)
    expect(stored('x')).toMatchObject({ syncId: null, content: { md: 'Walk at 8' } })
    expect(stored('y')).toMatchObject({ syncId: 'x', content: { md: 'Walk at 6' } })
  } finally { f.sql.close() }
})

// ---- tables -----------------------------------------------------------------------

/** A table card as an agent writes it. */
const tableCard = (content: unknown, extra: Record<string, unknown> = {}) => ({ id: 'dogs', kind: 'card', type: 'table', boardId: 'root', x: 0, y: 0, w: 560, h: 200, z: 1, color: 'none', createdAt: 1, content, ...extra })
const dogs = () => ({
  title: 'Pack',
  columns: [{ name: 'Dog' }, { name: 'Weight', type: 'number' }, { name: 'Status', type: 'select', options: [{ name: 'Healthy', color: 'sky' }] }, { name: 'Next', type: 'date' }],
  rows: [{ cells: ['Rex', 31.5, 'Healthy', '2026-12-01'] }, { cells: ['Fido', 8, 'Sleepy', null] }, { cells: [{ value: 'Biscuit', bold: true }, 12, 'Healthy', null] }] as { id?: string; cells: unknown[] }[],
})
type Fixture = Awaited<ReturnType<typeof fixture>>
const storedTable = (f: Fixture, id = 'dogs') => JSON.parse((f.sql.prepare('SELECT data FROM objects WHERE id=?').get(id) as { data: string }).data) as Record<string, unknown>
async function stage(f: Fixture, key: string, operations: unknown[]) {
  const response = await f.request('/agent/proposals', { idempotencyKey: key, label: `Table ${key}`, operations }, f.token)
  return { response, body: await response.clone().json() as { id?: string; error?: string } }
}
type ReadTable = { object: Record<string, unknown> & { content: { title: string; columns: { id: string; name: string }[]; rows: { id?: string; cells: unknown[] }[] } }; revision: number }
const readTable = async (f: Fixture): Promise<ReadTable> => {
  const read = await (await f.request('/agent/boards/root', undefined, f.token)).json() as { objects: ReadTable[] }
  return read.objects.find((o) => o.object.id === 'dogs')!
}
const tableKeys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => /^t[rkc][0-9]/.test(k))

it('stages a table as flat fields, approves it, shows it to agents as columns and rows, and reverses it', async () => {
  const f = await fixture()
  try {
    const { response, body } = await stage(f, 'table-create', [{ action: 'create', object: tableCard(dogs()) }])
    expect(response.status).toBe(201)
    // Proposals store (and the app previews) the stored form.
    const detail = await (await f.request(`/agent-proposals/${body.id}`)).json() as { proposal: { changes: { after: Record<string, unknown> }[] } }
    const after = detail.proposal.changes[0]!.after
    expect(after.content).toEqual({ title: 'Pack' })
    expect(tableKeys(after).length).toBe(3 + 4 + 10)
    expect(f.sql.prepare("SELECT 1 FROM objects WHERE id='dogs'").get()).toBeUndefined()
    expect((await f.request(`/agent-proposals/${body.id}/approve`, {})).status).toBe(200)
    expect(storedTable(f).content).toEqual({ title: 'Pack' })

    const read = await readTable(f)
    expect(tableKeys(read.object)).toEqual([])
    expect(read.object.content.rows.map((r) => r.cells)).toEqual([
      ['Rex', 31.5, 'Healthy', '2026-12-01'],
      ['Fido', 8, 'Sleepy', null],
      [{ value: 'Biscuit', bold: true }, 12, 'Healthy', null],
    ])
    expect(read.object.content.columns.every((c) => /^[0-9][0-9a-z]{5}$/.test(c.id))).toBe(true)

    expect((await f.request(`/agent-proposals/${body.id}/reverse`, {})).status).toBe(200)
    expect(storedTable(f).deletedAt).toBeGreaterThan(0)
  } finally { f.sql.close() }
})

it('a replace sends the whole table: missing rows and cells are removed, and reversing brings them back', async () => {
  const f = await fixture()
  try {
    const first = await stage(f, 'table-seed', [{ action: 'create', object: tableCard(dogs()) }])
    await f.request(`/agent-proposals/${first.body.id}/approve`, {})
    const original = storedTable(f)
    const read = await readTable(f)
    const content = structuredClone(read.object.content)
    const fido = content.rows[1]!
    content.rows.splice(1, 1) // remove Fido
    content.rows[0]!.cells[1] = 33 // Rex gains weight
    content.rows.push({ cells: ['Pip', 4, 'Healthy', '2027-01-01'] })
    const { response, body } = await stage(f, 'table-replace', [{ action: 'replace', expectedRevision: read.revision, object: { ...read.object, content } }])
    expect(response.status).toBe(201)
    expect((await f.request(`/agent-proposals/${body.id}/approve`, {})).status).toBe(200)
    const now = storedTable(f)
    const fidoKeys = tableKeys(original).filter((k) => k.includes(fido.id!))
    expect(fidoKeys.length).toBe(1 + 3) // the row and its three filled cells
    for (const key of fidoKeys) expect(now[key], key).toBeUndefined()
    const after = (await readTable(f)).object.content
    expect(after.rows.map((r) => r.cells[0])).toEqual(['Rex', { value: 'Biscuit', bold: true }, 'Pip'])
    expect(after.rows[0]!.cells[1]).toBe(33)
    // Rex's row kept its id and order value.
    expect(after.rows[0]!.id).toBe(read.object.content.rows[0]!.id)
    const rexRow = `tr${after.rows[0]!.id}`
    expect(now[rexRow]).toEqual(original[rexRow])

    expect((await f.request(`/agent-proposals/${body.id}/reverse`, {})).status).toBe(200)
    const back = storedTable(f)
    expect(tableKeys(back).sort()).toEqual(tableKeys(original).sort())
    for (const key of tableKeys(original)) expect(back[key], key).toEqual(original[key])
  } finally { f.sql.close() }
})

it('refuses a stale table revision, and an approval after someone else edited the table', async () => {
  const f = await fixture()
  try {
    const seed = await stage(f, 'table-seed-2', [{ action: 'create', object: tableCard(dogs()) }])
    await f.request(`/agent-proposals/${seed.body.id}/approve`, {})
    const read = await readTable(f)
    const stale = await stage(f, 'table-stale', [{ action: 'replace', expectedRevision: read.revision - 1, object: read.object }])
    expect(stale.response.status).toBe(409)
    expect(stale.body.error).toContain('Revision conflict')
    const fresh = await stage(f, 'table-fresh', [{ action: 'replace', expectedRevision: read.revision, object: { ...read.object, content: { ...read.object.content, title: 'Renamed' } } }])
    expect(fresh.response.status).toBe(201)
    // A person edits a cell before the review is done.
    const row = read.object.content.rows[0]!.id, col = read.object.content.columns[0]!.id
    f.sql.exec(`UPDATE counters SET value=value+1 WHERE name='seq'; UPDATE objects SET data=json_set(data,'$.tc${row}${col}','Human'),seq=(SELECT value FROM counters WHERE name='seq') WHERE id='dogs'`)
    const approve = await f.request(`/agent-proposals/${fresh.body.id}/approve`, {})
    expect(approve.status).toBe(409)
    expect(storedTable(f).content).toEqual({ title: 'Pack' })
  } finally { f.sql.close() }
})

it('names the cell when a value does not fit its column', async () => {
  const f = await fixture()
  try {
    const bad = dogs()
    bad.rows[1]!.cells[3] = 'next week'
    const { response, body } = await stage(f, 'table-bad-date', [{ action: 'create', object: tableCard(bad) }])
    expect(response.status).toBe(409)
    expect(body.error).toBe('Row 2, "Next": use YYYY-MM-DD')
    const worse = dogs()
    worse.rows[0]!.cells[1] = 'heavy'
    expect((await stage(f, 'table-bad-number', [{ action: 'create', object: tableCard(worse) }])).body.error).toBe('Row 1, "Weight": use a number')
    // Shape errors come from the schema, with the path.
    const shape = await stage(f, 'table-bad-shape', [{ action: 'create', object: tableCard({ ...dogs(), rows: [{ cells: [{ value: 'x', italic: true }] }] }) }])
    expect(shape.response.status).toBe(400)
    expect(shape.body.error).toContain('content.rows.0.cells.0')
    expect((await stage(f, 'table-too-wide', [{ action: 'create', object: tableCard({ title: '', columns: Array.from({ length: 27 }, (_, i) => ({ name: `C${i}` })), rows: [] }) }])).response.status).toBe(400)
  } finally { f.sql.close() }
})

it('keeps the 512 KB request and 200 operation limits for tables', async () => {
  const f = await fixture()
  try {
    // 100 rows of long text clear the schema but not the byte limit.
    const big = { title: '', columns: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], rows: Array.from({ length: 100 }, () => ({ cells: ['x'.repeat(1800), 'y'.repeat(1800), 'z'.repeat(1800)] })) }
    const tooLarge = await stage(f, 'table-big', [{ action: 'create', object: tableCard(big) }])
    expect(tooLarge.response.status).toBe(413)
    const many = Array.from({ length: 201 }, (_, i) => ({ action: 'create', object: tableCard({ title: `T${i}`, columns: [{ name: 'A' }], rows: [] }, { id: `t${i}` }) }))
    expect((await stage(f, 'table-many', many)).response.status).toBe(400)
    // The largest allowed table (100 x 26 short cells) is fine.
    const widest = { title: '', columns: Array.from({ length: 26 }, (_, i) => ({ name: `C${i}` })), rows: Array.from({ length: 100 }, () => ({ cells: Array.from({ length: 26 }, (_, i) => `v${i}`) })) }
    const ok = await stage(f, 'table-max', [{ action: 'create', object: tableCard(widest) }])
    expect(ok.response.status).toBe(201)
    expect((await f.request(`/agent-proposals/${ok.body.id}/approve`, {})).status).toBe(200)
    expect(Object.keys(storedTable(f)).filter((k) => k.startsWith('tc')).length).toBe(2600)
  } finally { f.sql.close() }
})

it('a connection uploads its own images and places them only once every rendition is stored', async () => {
  const f = await fixture()
  try {
    const assetId = '0f8fad5b-d9cb-469f-a165-70867728950e'
    const image = (id: string, sizes: string[]) => ({ id, kind: 'card', type: 'image', boardId: 'root', x: 0, y: 0, w: 260, h: 195, z: 1, color: 'none', createdAt: 0, content: { assetId, width: 800, height: 600, sizes } })
    const propose = (key: string, object: object, token = f.token) => f.request('/agent/proposals', { idempotencyKey: key, label: 'Reference images', operations: [{ action: 'create', object }] }, token)
    // Nothing is reserved yet: renditions are refused, and so is a card naming the id.
    expect((await f.putImage(`/agent/assets/${assetId}/full`, f.token)).status).toBe(403)
    expect((await f.request('/agent/uploads', { assetId }, f.token)).status).toBe(200)
    // Reserving again is a no-op retry; another connection cannot take the id.
    expect((await f.request('/agent/uploads', { assetId }, f.token)).status).toBe(200)
    const other = await (await f.request('/agent-connections', { name: 'Other client', mode: 'propose', boardIds: ['root'] })).json() as { token: string }
    expect((await f.request('/agent/uploads', { assetId }, other.token)).status).toBe(409)
    expect((await f.putImage(`/agent/assets/${assetId}/thumb`, other.token)).status).toBe(403)
    const reader = await (await f.request('/agent-connections', { name: 'Reader', mode: 'read', boardIds: ['root'] })).json() as { token: string }
    expect((await f.request('/agent/uploads', { assetId: crypto.randomUUID() }, reader.token)).status).toBe(403)
    // Only `full` stored: the card would show broken thumbnails, so it's refused.
    expect((await f.putImage(`/agent/assets/${assetId}/full`, f.token)).status).toBe(201)
    expect((await propose('too-early-upload', image('ref-1', ['thumb', 'small', 'medium', 'full']))).status).toBe(409)
    for (const size of ['thumb', 'small', 'medium']) expect((await f.putImage(`/agent/assets/${assetId}/${size}`, f.token)).status).toBe(201)
    expect((await f.putImage(`/agent/assets/${assetId}/full`, f.token)).status).toBe(200)
    expect(f.stored.size).toBe(4)
    expect(await (await f.request('/agent/uploads', { assetId }, f.token)).json()).toMatchObject({ stored: expect.arrayContaining(['thumb', 'small', 'medium', 'full']) })
    // Another connection cannot place an upload that isn't on a board yet.
    expect((await propose('borrow-upload', image('ref-2', ['thumb', 'medium', 'full']), other.token)).status).toBe(409)
    const staged = await propose('place-upload', image('ref-1', ['thumb', 'small', 'medium', 'full']))
    expect(staged.status).toBe(201)
    const { id } = await staged.json() as { id: string }
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    const card = JSON.parse((f.sql.prepare("SELECT data FROM objects WHERE id='ref-1'").get() as { data: string }).data)
    expect(card.content.assetId).toBe(assetId)
  } finally { f.sql.close() }
})
