import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { chats } from './chats.ts'
import { agents } from './agents.ts'
import { shares } from './shares.ts'
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
  const app = new Hono<AppEnv>().basePath('/api').route('/', chats).route('/', shares).route('/', agents)
  const request = (path: string, body?: unknown, token = 'test-session', method = body === undefined ? 'GET' : 'POST') => app.request(`/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: db } as Env)
  const card = (id: string, text: string) => ({ id, kind: 'card', type: 'note', boardId: 'root', x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', content: { md: text }, createdAt: now })
  let sequence = 1
  const put = (object: Record<string, unknown>, owner: string | null = null) => {
    sql.prepare('INSERT INTO objects(id,kind,board_id,data,seq,updated_at,owner_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,seq=excluded.seq,board_id=excluded.board_id,owner_id=excluded.owner_id')
      .run(object.id as string, object.kind as string, (object.boardId ?? null) as string | null, JSON.stringify(object), ++sequence, now, owner)
    sql.prepare("UPDATE counters SET value=? WHERE name='seq'").run(sequence)
  }
  const chat = (id: string) => ({ ...card(id, ''), type: 'chat', content: { title: 'Conversation', provider: 'claude' } })
  put(chat('chat'))
  put(card('a', '# Source A\nExact **Markdown**'))
  put(card('b', 'Source B'))
  put({ ...card('todo', ''), type: 'todo', content: { title: 'Tasks', items: [{ id: 'task', text: 'Start kickoff', done: false }] } })
  put(card('unlinked', 'UNLINKED SECRET'))
  for (const from of ['a', 'b', 'todo']) put({ id: `link-${from}`, kind: 'connection', boardId: 'root', from, to: 'chat', purpose: 'context', arrow: 'end', createdAt: now })
  const inspect = async () => (await (await request('/chats/chat/context')).json()) as { version: string; context: { sources: { id: string; text: string }[] } }
  const beginBody = async (operationId = 'run-1', expectedRevision = 0) => ({ operationId, expectedRevision, deviceId: 'device-1', runKey: 'a'.repeat(40), contextVersion: (await inspect()).version, provider: 'claude', prompt: 'Plan a kickoff' })
  const finish = { deviceId: 'device-1', runKey: 'a'.repeat(40), answer: 'A useful answer', status: 'completed' }
  return { sql, request, card, put, chat, inspect, beginBody, finish, beforeBatch: (hook: () => void) => { beforeBatch = hook } }
}

it('captures only linked sources, persists a completed answer and rejects duplicate or concurrent sends', async () => {
  const f = await fixture()
  try {
    const body = await f.beginBody()
    const started = await f.request('/chats/chat/turns', body)
    expect(started.status, await started.clone().text()).toBe(201)
    const payload = await started.json() as { input: string; turn: { context: unknown } }
    expect(payload.input).toContain('Exact **Markdown**')
    expect(payload.input).toContain('- [ ] Start kickoff')
    expect(payload.input).not.toContain('UNLINKED SECRET')
    expect((await f.request('/chats/chat/turns', body)).status).toBe(200)
    expect(f.sql.prepare('SELECT COUNT(*) AS n FROM chat_turns').get()).toMatchObject({ n: 1 })
    expect((await f.request('/chats/chat/turns', await f.beginBody('run-2', 1))).status).toBe(409)
    expect((await f.request('/chats/chat/turns/run-1/finish', f.finish)).status).toBe(200)
    expect((await f.request('/chats/chat/turns/run-1/finish', f.finish)).status).toBe(200)
    const saved = await (await f.request('/chats/chat')).json() as { revision: number; turns: Record<string, unknown>[] }
    expect(saved.revision).toBe(2)
    expect(saved.turns).toHaveLength(1)
    expect(saved.turns[0]).toMatchObject({ status: 'completed', answer: 'A useful answer', context: payload.turn.context })
    expect(JSON.stringify(saved)).not.toMatch(/key_hash|request_hash|runKey|device_id|lease_until/)
    expect((await f.request('/chats/chat/turns/run-1/progress', { ...f.finish, status: undefined, sequence: 2 })).status).toBe(409)
    const next = await f.request('/chats/chat/turns', await f.beginBody('run-2', 2))
    expect(next.status).toBe(201)
    expect((await next.json() as { input: string }).input).toContain('A useful answer')
  } finally { f.sql.close() }
})

it('requires an inspected context version and atomically refuses a source/link race', async () => {
  const f = await fixture()
  try {
    const stale = await f.beginBody()
    f.put(f.card('a', 'Edited source'))
    expect((await f.request('/chats/chat/turns', stale)).status).toBe(409)
    const fresh = await f.beginBody()
    f.beforeBatch(() => f.put({ id: 'link-b', kind: 'connection', from: 'b', to: 'chat', boardId: 'root', purpose: 'context', purged: true }))
    expect((await f.request('/chats/chat/turns', fresh)).status).toBe(409)
    expect(f.sql.prepare('SELECT COUNT(*) AS n FROM chat_turns').get()).toMatchObject({ n: 0 })
    const response = await f.request('/chats/chat/turns', await f.beginBody())
    expect(response.status).toBe(201)
    const { input } = await response.json() as { input: string }
    expect(input).toContain('Edited source')
    expect(input).not.toContain('Source B')
  } finally { f.sql.close() }
})

it('requires the initiating device key and keeps progress monotonic after stop and expiry', async () => {
  const f = await fixture()
  try {
    await f.request('/chats/chat/turns', await f.beginBody())
    expect((await f.request('/chats/chat/turns/run-1/finish', { ...f.finish, deviceId: 'collaborator' })).status).toBe(403)
    expect((await f.request('/chats/chat/turns/run-1/finish', { ...f.finish, runKey: 'b'.repeat(40) })).status).toBe(403)
    const progress = { deviceId: f.finish.deviceId, runKey: f.finish.runKey, sequence: 2, answer: 'New partial' }
    expect((await f.request('/chats/chat/turns/run-1/progress', progress)).status).toBe(200)
    expect((await f.request('/chats/chat/turns/run-1/progress', { ...progress, sequence: 1, answer: 'Old partial' })).status).toBe(200)
    expect(f.sql.prepare('SELECT answer FROM chat_turns').get()).toMatchObject({ answer: 'New partial' })
    expect((await f.request('/chats/chat/turns/run-1/finish', { ...f.finish, status: 'interrupted', answer: 'New partial' })).status).toBe(200)
    expect((await f.request('/chats/chat/turns/run-1/progress', { ...progress, sequence: 3 })).status).toBe(409)
    expect((await f.request('/chats/chat/turns/run-1/finish', f.finish)).status).toBe(409)
    await f.request('/chats/chat/turns', await f.beginBody('run-2', 2))
    f.sql.exec("UPDATE chat_turns SET lease_until=1 WHERE id='run-2'")
    const saved = await (await f.request('/chats/chat')).json() as { turns: { status: string }[] }
    expect(saved.turns[1]!.status).toBe('interrupted')
    expect((await f.request('/chats/chat/turns/run-2/finish', f.finish)).status).toBe(409)
    expect((await f.request('/chats/chat/turns', await f.beginBody('run-3', 3))).status).toBe(201)
  } finally { f.sql.close() }
})

it('branches through the chosen completed answer with a durable parent reference and idempotent retry', async () => {
  const f = await fixture()
  try {
    await f.request('/chats/chat/turns', await f.beginBody())
    await f.request('/chats/chat/turns/run-1/finish', f.finish)
    await f.request('/chats/chat/turns', { ...await f.beginBody('run-2', 2), prompt: 'Future parent SECRET' })
    await f.request('/chats/chat/turns/run-2/finish', { ...f.finish, answer: 'Future answer SECRET' })
    f.put(f.chat('branch'))
    const branch = { targetId: 'branch', messageId: 'run-1' }
    expect((await f.request('/chats/chat/branch', branch)).status).toBe(201)
    expect((await f.request('/chats/chat/branch', branch)).status).toBe(200)
    const saved = await (await f.request('/chats/branch')).json() as { turns: unknown[]; parent: unknown }
    expect(saved.turns).toHaveLength(1)
    expect(saved.parent).toEqual({ chatId: 'chat', messageId: 'run-1' })
    expect(JSON.stringify(saved)).not.toContain('SECRET')
  } finally { f.sql.close() }
})

it('enforces view grants, private Inboxes, revocation and racing revocation', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    f.sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run('spot', 'spot', 'unused', 0, now)
    f.sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex('spot-session'), 'spot', now, now + 100000)
    expect((await f.request('/chats/chat', undefined, 'spot-session')).status).toBe(403)
    f.sql.exec("INSERT INTO board_grants(id,board_id,user_id,permission,created_by,created_at) VALUES('grant','root','spot','view','rex',1)")
    expect((await f.request('/chats/chat', undefined, 'spot-session')).status).toBe(200)
    expect((await f.request('/chats/chat/turns', await f.beginBody(), 'spot-session')).status).toBe(403)
    f.put({ id: 'toybox:rex', kind: 'board', title: 'Private', parentId: null }, 'rex')
    f.put({ ...f.chat('inbox-chat'), boardId: 'toybox:rex' }, 'rex')
    expect((await f.request('/chats/inbox-chat', undefined, 'spot-session')).status).toBe(403)
    f.sql.exec("UPDATE board_grants SET permission='edit' WHERE id='grant'; UPDATE counters SET value=value+1 WHERE name='access_revision'")
    const body = await f.beginBody()
    f.beforeBatch(() => f.sql.exec("UPDATE board_grants SET revoked_at=1 WHERE id='grant'; UPDATE counters SET value=value+1 WHERE name='access_revision'"))
    expect((await f.request('/chats/chat/turns', body, 'spot-session')).status).toBe(409)
    expect(f.sql.prepare('SELECT COUNT(*) AS n FROM chat_turns').get()).toMatchObject({ n: 0 })
    expect((await f.request('/chats/chat', undefined, 'spot-session')).status).toBe(403)
  } finally { f.sql.close() }
})

it('redacts public chat payloads at the server even if synced card fields contain secrets', async () => {
  const f = await fixture()
  try {
    f.put({ ...f.chat('chat'), content: { title: 'PRIVATE TITLE', transcript: 'PRIVATE TRANSCRIPT' }, snapshot: 'PRIVATE SNAPSHOT' })
    f.sql.exec("INSERT INTO shares(token,board_id,include_children,permission,created_by,created_at,scope_version) VALUES('public','root',1,'view','rex',1,1)")
    const response = await f.request('/share/public', undefined, 'no-session')
    expect(response.status).toBe(200)
    const payload = await response.json() as { objects: { id: string; content: unknown }[] }
    expect(payload.objects.find((o) => o.id === 'chat')!.content).toEqual({ title: 'Conversation', provider: 'claude' })
    expect(JSON.stringify(payload)).not.toContain('PRIVATE')
    expect((await f.request('/chats/chat', undefined, 'no-session')).status).toBe(401)
  } finally { f.sql.close() }
})

it('stages a narrow task proposal idempotently and reuses existing approval, rejection, conflicts and reversal', async () => {
  const f = await fixture()
  try {
    await f.request('/chats/chat/turns', await f.beginBody())
    await f.request('/chats/chat/turns/run-1/finish', { ...f.finish, answer: '- Book the park\n- Invite the team' })
    const body = { operationId: 'task-output-1', messageId: 'run-1', selectedText: '- Book the park\n- Invite the team', title: 'Kickoff', tasks: ['Book the park', 'Invite the team'] }
    const staged = await f.request('/chats/chat/task-proposal', body)
    expect(staged.status, await staged.clone().text()).toBe(201)
    const { id } = await staged.json() as { id: string }
    expect((await (await f.request('/chats/chat/task-proposal', body)).json() as { id: string }).id).toBe(id)
    expect((await f.request('/chats/chat/task-proposal', { ...body, tasks: ['Another task'] })).status).toBe(409)
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM objects WHERE json_extract(data,'$.type')='todo'").get()).toMatchObject({ n: 1 })
    const detail = await (await f.request(`/agent-proposals/${id}`)).json() as { proposal: { changes: { id: string; after: { content: { items: { done: boolean; text: string }[] } } }[] } }
    const change = detail.proposal.changes[0]!
    expect(change.after.content.items).toEqual([{ id: 'task-0', text: 'Book the park', done: false }, { id: 'task-1', text: 'Invite the team', done: false }])
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
    expect((await f.request(`/agent-proposals/${id}/reverse`, {})).status).toBe(200)
    expect(JSON.parse((f.sql.prepare('SELECT data FROM objects WHERE id=?').get(change.id) as { data: string }).data).deletedAt).toBeGreaterThan(0)
    const rejected = await (await f.request('/chats/chat/task-proposal', { ...body, operationId: 'task-output-2' })).json() as { id: string }
    expect((await f.request(`/agent-proposals/${rejected.id}/reject`, {})).status).toBe(200)
    expect((await f.request(`/agent-proposals/${rejected.id}/approve`, {})).status).toBe(409)
    const conflict = await (await f.request('/chats/chat/task-proposal', { ...body, operationId: 'task-output-3' })).json() as { id: string }
    const conflictDetail = await (await f.request(`/agent-proposals/${conflict.id}`)).json() as typeof detail
    f.put({ ...f.card(conflictDetail.proposal.changes[0]!.id, ''), type: 'todo', content: { title: 'An intervening creation', items: [] } })
    expect((await f.request(`/agent-proposals/${conflict.id}/approve`, {})).status).toBe(409)
  } finally { f.sql.close() }
})

it('places task proposals beside a containing column in its inherited area', async () => {
  const f = await fixture()
  try {
    f.put({ ...f.card('area', ''), type: 'area', x: 800, y: 600, w: 900, h: 700, content: { title: 'Project' } })
    f.put({ ...f.card('column', ''), type: 'column', areaId: 'area', x: 40, y: 90, w: 280, content: { title: 'Work' } })
    f.put({ ...f.chat('chat'), columnId: 'column', areaId: null, x: -900, y: -900 })
    expect((await f.request('/chats/chat/turns', await f.beginBody())).status).toBe(201)
    expect((await f.request('/chats/chat/turns/run-1/finish', { ...f.finish, answer: '- Book the park' })).status).toBe(200)
    const staged = await f.request('/chats/chat/task-proposal', { operationId: 'column-tasks', messageId: 'run-1', selectedText: '- Book the park', title: 'Kickoff', tasks: ['Book the park'] })
    expect(staged.status, await staged.clone().text()).toBe(201)
    const { id } = await staged.json() as { id: string }
    const detail = await (await f.request(`/agent-proposals/${id}`)).json() as { proposal: { changes: { after: Record<string, unknown> }[] } }
    expect(detail.proposal.changes[0]!.after).toMatchObject({ type: 'todo', areaId: 'area', x: 360, y: 90 })
    expect((await f.request(`/agent-proposals/${id}/approve`, {})).status).toBe(200)
  } finally { f.sql.close() }
})

it('recovers expired output as interrupted without reviving it or overwriting a later run', async () => {
  const f = await fixture()
  try {
    await f.request('/chats/chat/turns', await f.beginBody())
    f.sql.exec("UPDATE chat_turns SET lease_until=1 WHERE id='run-1'")
    await f.request('/chats/chat/turns', await f.beginBody('run-2', 1))
    const recovered = { ...f.finish, status: 'interrupted', answer: 'Recovered partial output', error: 'interrupted' }
    expect((await f.request('/chats/chat/turns/run-1/finish', recovered)).status).toBe(200)
    expect((await f.request('/chats/chat/turns/run-1/finish', recovered)).status).toBe(200)
    expect((await f.request('/chats/chat/turns/run-1/finish', f.finish)).status).toBe(409)
    expect(f.sql.prepare("SELECT status FROM chat_turns WHERE id='run-2'").get()).toMatchObject({ status: 'running' })
  } finally { f.sql.close() }
})

it('keeps an inspected text capture usable after source-only layout measurements, recording the fresh source version', async () => {
  const f = await fixture()
  try {
    const body = await f.beginBody()
    const prior = (f.sql.prepare("SELECT seq FROM objects WHERE id='a'").get() as { seq: number }).seq
    f.put({ ...f.card('a', '# Source A\nExact **Markdown**'), h: 140 })
    const response = await f.request('/chats/chat/turns', body)
    expect(response.status, await response.clone().text()).toBe(201)
    const result = await response.json() as { turn: { context: { sources: { id: string; revision: number }[] } } }
    expect(result.turn.context.sources.find((s) => s.id === 'a')!.revision).toBeGreaterThan(prior)
  } finally { f.sql.close() }
})

it('retains mixed-author history after account deletion and appends safely past ordinal gaps', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    f.sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run('spot', 'spot', 'unused', 0, now)
    f.sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex('spot-session'), 'spot', now, now + 100000)
    f.sql.exec("INSERT INTO board_grants(id,board_id,user_id,permission,created_by,created_at) VALUES('grant','root','spot','edit','rex',1)")
    const first = await f.beginBody('spot-turn')
    expect((await f.request('/chats/chat/turns', first, 'spot-session')).status).toBe(201)
    expect((await f.request('/chats/chat/turns/spot-turn/finish', { ...f.finish, answer: 'Preserved shared answer' }, 'spot-session')).status).toBe(200)
    const second = await f.beginBody('rex-turn', 2)
    expect((await f.request('/chats/chat/turns', second)).status).toBe(201)
    expect((await f.request('/chats/chat/turns/rex-turn/finish', f.finish)).status).toBe(200)
    f.sql.exec("DELETE FROM users WHERE id='spot'; UPDATE chat_turns SET ordinal=7 WHERE id='rex-turn'")
    const retained = await (await f.request('/chats/chat')).json() as { turns: { authorId: string; answer: string }[] }
    expect(retained.turns).toHaveLength(2)
    expect(retained.turns[0]).toMatchObject({ authorId: 'spot', answer: 'Preserved shared answer' })
    const next = await f.request('/chats/chat/turns', await f.beginBody('next-turn', 4))
    expect(next.status, await next.clone().text()).toBe(201)
    expect((await next.json() as { turn: { ordinal: number } }).turn.ordinal).toBe(8)
    expect((await f.request('/chats/chat/turns/next-turn/finish', { ...f.finish, answer: 'FUTURE ANSWER' })).status).toBe(200)
    const replay = await f.request('/chats/chat/turns', second)
    expect(replay.status).toBe(200)
    const { input } = await replay.json() as { input: string }
    expect(input).toContain('Preserved shared answer')
    expect(input).not.toContain('FUTURE ANSWER')
    expect(f.sql.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally { f.sql.close() }
})

it('upgrades existing chat rows without losing content or the active-run uniqueness guard', () => {
  const sql = new DatabaseSync(':memory:')
  try {
    sql.exec('PRAGMA foreign_keys=ON')
    const dir = new URL('../migrations/', import.meta.url)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (file === '0017_retain_chat_authorship.sql') {
        sql.exec(`INSERT INTO users(id,username,pw_hash,created_at) VALUES('former','former','unused',1);
          INSERT INTO objects(id,kind,data,seq,updated_at) VALUES('saved-chat','card','{}',1,1);
          INSERT INTO chat_threads(id) VALUES('saved-chat');
          INSERT INTO chat_turns(id,chat_id,ordinal,author_id,device_id,key_hash,request_hash,provider,prompt,context,answer,status,created_at,lease_until)
          VALUES('saved-turn','saved-chat',0,'former','device','hash','request','claude','Prompt','{}','Saved answer','running',1,100);`)
      }
      sql.exec(readFileSync(new URL(file, dir), 'utf8'))
    }
    sql.exec("DELETE FROM users WHERE id='former'")
    expect(sql.prepare('SELECT author_id,answer,event_sequence FROM chat_turns').get()).toMatchObject({ author_id: 'former', answer: 'Saved answer', event_sequence: 0 })
    expect(() => sql.exec("INSERT INTO chat_turns SELECT 'duplicate',chat_id,1,author_id,device_id,key_hash,request_hash,provider,prompt,context,answer,status,created_at,finished_at,lease_until,event_sequence,usage,error,finish_hash FROM chat_turns WHERE id='saved-turn'")).toThrow(/UNIQUE/)
  } finally { sql.close() }
})
