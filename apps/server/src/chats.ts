import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { assembleContext, branchHistory, providerInput, CHAT_LIMITS, ChatInputError, type ChatThread, type ChatTurn } from '@doggynote/core/chat'
import { mdToText, type Card, type Connection } from '@doggynote/core'
import { requireUser } from './auth.ts'
import { accessGuard, loadAccess } from './access.ts'
import { sha256Hex } from './crypto.ts'
import type { AppEnv } from './env.ts'
import { prepareAgentChanges } from './agents.ts'

const id = z.string().regex(/^[a-zA-Z0-9_:-]{1,64}$/)
const secret = z.string().regex(/^[a-zA-Z0-9_-]{32,128}$/)
const beginSchema = z.strictObject({
  operationId: id, deviceId: id, runKey: secret, expectedRevision: z.number().int().nonnegative(), contextVersion: z.string().length(64),
  provider: z.enum(['claude', 'codex']), prompt: z.string().trim().min(1).max(CHAT_LIMITS.promptChars),
})
const usage = z.strictObject({ inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional() })
const finishSchema = z.strictObject({
  deviceId: id, runKey: secret, status: z.enum(['completed', 'interrupted', 'failed']), answer: z.string().max(CHAT_LIMITS.answerChars),
  usage: usage.nullable().optional(), error: z.enum(['provider-unavailable', 'signed-out', 'rate-limit', 'process-failed', 'invalid-event', 'interrupted', 'input-too-large', 'tool-request']).nullable().optional(),
})
const progressSchema = z.strictObject({ deviceId: id, runKey: secret, sequence: z.number().int().positive(), answer: z.string().max(CHAT_LIMITS.answerChars) })
const LEASE_MS = 45_000
type ObjectRow = { id: string; data: string; seq: number; owner_id: string | null; board_id: string }
type ThreadRow = { id: string; revision: number; inherited: string; parent: string | null }
type TurnRow = {
  id: string; chat_id: string; ordinal: number; author_id: string; device_id: string; key_hash: string; request_hash: string
  provider: 'claude' | 'codex'; prompt: string; context: string; answer: string; status: ChatTurn['status']; created_at: number
  finished_at: number | null; lease_until: number; usage: string | null; error: string | null; finish_hash: string | null
}
function fail(status: 400 | 403 | 404 | 409, message: string): never { throw new HTTPException(status, { message }) }

async function parse<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  const length = Number(c.req.header('content-length') ?? 0)
  if (length > 300_000) fail(400, 'Chat request too large')
  const raw = await c.req.text()
  if (raw.length > 300_000) fail(400, 'Chat request too large')
  let body: unknown
  try { body = JSON.parse(raw) } catch { fail(400, 'Invalid JSON') }
  const result = schema.safeParse(body)
  if (!result.success) fail(400, 'Invalid chat request')
  return result.data
}

/** Use protected SQL ownership/access metadata, never a client-supplied board id. */
async function authorize(c: Context<AppEnv>, edit = false) {
  const db = c.env.DB, me = c.get('user')
  const row = await db.prepare('SELECT id,data,seq,owner_id,board_id FROM objects WHERE id=?1').bind(c.req.param('chatId')).first<ObjectRow>()
  const access = await loadAccess(db, me)
  if (!row || (row.owner_id && row.owner_id !== me.id) || !(edit ? access.canEdit(row.board_id) : access.canRead(row.board_id))) fail(403, 'Conversation unavailable or access changed')
  const card = JSON.parse(row.data) as Card<'chat'>
  if (card.kind !== 'card' || card.type !== 'chat' || card.purged || card.deletedAt || card.boardId !== row.board_id) fail(404, 'Conversation unavailable')
  return { db, me, row, card, access }
}

function wire(r: TurnRow): ChatTurn {
  const expired = r.status === 'running' && r.lease_until <= Date.now()
  return { id: r.id, ordinal: r.ordinal, authorId: r.author_id, provider: r.provider, prompt: r.prompt, context: JSON.parse(r.context), answer: r.answer,
    status: expired ? 'interrupted' : r.status, createdAt: r.created_at, finishedAt: expired ? r.lease_until : r.finished_at,
    usage: r.usage ? JSON.parse(r.usage) : null, error: expired ? 'interrupted' : r.error }
}

async function thread(db: D1Database, chatId: string): Promise<ChatThread> {
  const before = await db.prepare('SELECT * FROM chat_threads WHERE id=?1').bind(chatId).first<ThreadRow>()
  const { results } = await db.prepare('SELECT * FROM chat_turns WHERE chat_id=?1 ORDER BY ordinal').bind(chatId).all<TurnRow>()
  const after = await db.prepare('SELECT revision FROM chat_threads WHERE id=?1').bind(chatId).first<{ revision: number }>()
  if ((before?.revision ?? 0) !== (after?.revision ?? 0)) return thread(db, chatId)
  return { revision: before?.revision ?? 0, parent: before?.parent ? JSON.parse(before.parent) : null, turns: [...JSON.parse(before?.inherited ?? '[]'), ...results.map(wire)] }
}

async function contextFor(auth: Awaited<ReturnType<typeof authorize>>) {
  const { db, card, me } = auth
  const boardRevision = await db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM objects WHERE board_id=?1').bind(card.boardId).first<{ seq: number }>()
  const { results: linked } = await db.prepare("SELECT id,data,seq,owner_id,board_id FROM objects WHERE board_id=?1 AND kind='connection' AND json_extract(data,'$.purpose')='context' AND json_extract(data,'$.to')=?2 AND COALESCE(json_extract(data,'$.purged'),0)=0 AND COALESCE(json_extract(data,'$.deletedAt'),0)=0").bind(card.boardId, card.id).all<ObjectRow>()
  const ids = [...new Set(linked.filter((r) => !r.owner_id || r.owner_id === me.id).map((r) => JSON.parse(r.data).from).filter((id): id is string => typeof id === 'string'))]
  if (ids.length > CHAT_LIMITS.sources) throw new ChatInputError(`Choose at most ${CHAT_LIMITS.sources} context cards. Remove links and try again.`)
  const results = [...linked]
  if (ids.length) {
    const sources = await db.prepare(`SELECT id,data,seq,owner_id,board_id FROM objects WHERE board_id=?1 AND id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})`).bind(card.boardId, ...ids).all<ObjectRow>()
    results.push(...sources.results)
  }
  const records = new Map<string, { card: Card; revision: number }>(), links: Connection[] = []
  for (const row of results) {
    if (row.owner_id && row.owner_id !== me.id) continue
    const obj = JSON.parse(row.data)
    if (obj.kind === 'card') records.set(row.id, { card: obj, revision: row.seq })
    if (obj.kind === 'connection') links.push(obj)
  }
  const context = assembleContext(card, links, records)
  // Layout measurements change object seq without changing the supplied context.
  // Inspect/send matching follows identity and exact text; the turn still records the fresh seq.
  const version = await sha256Hex(JSON.stringify({ ...context, sources: context.sources.map(({ revision: _revision, ...source }) => source) }))
  return { context, version, boardRevision: boardRevision!.seq }
}

/** A batch starts with a guard against permission, source/link, card-move and thread races. */
function guard(db: D1Database, auth: Awaited<ReturnType<typeof authorize>>, revision: number, boardRevision?: number) {
  return db.prepare(`INSERT INTO access_write_guard(id,revision) VALUES(1,CASE WHEN
    COALESCE((SELECT revision FROM chat_threads WHERE id=?2),0)=?3
    AND (SELECT seq FROM objects WHERE id=?2)=?4
    ${boardRevision === undefined ? '' : 'AND (SELECT COALESCE(MAX(seq),0) FROM objects WHERE board_id=?5)=?6'}
    THEN ?1 ELSE -1 END) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision`)
    .bind(...(boardRevision === undefined ? [Number(auth.access.revision), auth.card.id, revision, auth.row.seq] : [Number(auth.access.revision), auth.card.id, revision, auth.row.seq, auth.card.boardId, boardRevision]))
}

async function commit(db: D1Database, statements: D1PreparedStatement[]) {
  try { await db.batch(statements) } catch { fail(409, 'The conversation, context or access changed. Refresh and try again.') }
}

export const chats = new Hono<AppEnv>()
chats.use('/chats/*', requireUser)
chats.use('/chats/*', async (c, next) => { c.header('cache-control', 'no-store'); await next() })
chats.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  if (err instanceof ChatInputError) return c.json({ error: err.message }, 400)
  console.error('[chat]', err instanceof Error ? err.name : 'error') // no prompts, process diagnostics or credentials
  return c.json({ error: 'Conversation could not be saved. Try again.' }, 500)
})
chats.get('/chats/:chatId', async (c) => {
  const auth = await authorize(c)
  return c.json(await thread(auth.db, auth.card.id))
})
chats.get('/chats/:chatId/context', async (c) => {
  const auth = await authorize(c)
  const { context, version } = await contextFor(auth)
  return c.json({ context, version })
})

chats.post('/chats/:chatId/turns', async (c) => {
  const body = await parse(c, beginSchema), auth = await authorize(c, true)
  const { db, card, me } = auth
  const requestHash = await sha256Hex(JSON.stringify(body)), keyHash = await sha256Hex(body.runKey)
  const existing = await db.prepare('SELECT * FROM chat_turns WHERE id=?1').bind(body.operationId).first<TurnRow>()
  if (existing) {
    if (existing.chat_id !== card.id || existing.author_id !== me.id || existing.key_hash !== keyHash || existing.request_hash !== requestHash) fail(409, 'This operation ID has already been used')
    const visible = await thread(db, card.id)
    const input = providerInput(visible.turns.slice(0, visible.turns.findIndex((turn) => turn.id === existing.id)), existing.prompt, JSON.parse(existing.context))
    return c.json({ turn: wire(existing), input, replay: true })
  }
  const current = await thread(db, card.id)
  if (body.expectedRevision !== current.revision) fail(409, 'The conversation changed. Refresh before sending.')
  if (current.turns.some((t) => t.status === 'running')) fail(409, 'A turn is already running in this conversation')
  const capture = await contextFor(auth)
  if (capture.version !== body.contextVersion) fail(409, 'Context changed since inspection. Inspect it again before sending.')
  const input = providerInput(current.turns, body.prompt, capture.context)
  const ordinal = Math.max(-1, ...current.turns.map((turn) => turn.ordinal)) + 1
  const now = Date.now()
  await commit(db, [
    guard(db, auth, current.revision, capture.boardRevision),
    db.prepare('INSERT OR IGNORE INTO chat_threads(id) VALUES(?1)').bind(card.id),
    db.prepare("UPDATE chat_turns SET status='interrupted',error='interrupted',finished_at=lease_until WHERE chat_id=?1 AND status='running' AND lease_until<=?2").bind(card.id, now),
    db.prepare(`INSERT INTO chat_turns(id,chat_id,ordinal,author_id,device_id,key_hash,request_hash,provider,prompt,context,status,created_at,lease_until)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'running',?11,?12)`)
      .bind(body.operationId, card.id, ordinal, me.id, body.deviceId, keyHash, requestHash, body.provider, body.prompt, JSON.stringify(capture.context), now, now + LEASE_MS),
    db.prepare('UPDATE chat_threads SET revision=revision+1 WHERE id=?1').bind(card.id),
  ])
  return c.json({ turn: { id: body.operationId, ordinal, authorId: me.id, provider: body.provider, prompt: body.prompt, context: capture.context, answer: '', status: 'running', createdAt: now, finishedAt: null, usage: null, error: null } satisfies ChatTurn, input, replay: false }, 201)
})

async function ownedRun(c: Context<AppEnv>, body: { runKey: string; deviceId: string }) {
  const auth = await authorize(c, true)
  const run = await auth.db.prepare('SELECT * FROM chat_turns WHERE id=?1 AND chat_id=?2').bind(c.req.param('turnId'), auth.card.id).first<TurnRow>()
  if (!run || run.author_id !== auth.me.id || run.device_id !== body.deviceId || run.key_hash !== await sha256Hex(body.runKey)) fail(403, 'This run belongs to another device')
  return { ...auth, run }
}

chats.post('/chats/:chatId/turns/:turnId/progress', async (c) => {
  const body = await parse(c, progressSchema), auth = await ownedRun(c, body), now = Date.now()
  if (auth.run.status !== 'running' || auth.run.lease_until <= now) fail(409, 'This run has ended. Its partial answer is preserved.')
  const current = await thread(auth.db, auth.card.id)
  await commit(auth.db, [guard(auth.db, auth, current.revision), auth.db.prepare(`UPDATE chat_turns SET answer=?1,event_sequence=?2,lease_until=?3
    WHERE id=?4 AND status='running' AND lease_until>?5 AND event_sequence<?2`).bind(body.answer, body.sequence, now + LEASE_MS, auth.run.id, now)])
  return c.json({ ok: true })
})

chats.post('/chats/:chatId/turns/:turnId/finish', async (c) => {
  const body = await parse(c, finishSchema), auth = await ownedRun(c, body), now = Date.now()
  const finishHash = await sha256Hex(JSON.stringify(body))
  if (auth.run.finish_hash === finishHash) return c.json({ ok: true, replay: true })
  const recovery = body.status === 'interrupted' && !auth.run.finish_hash && auth.run.lease_until <= now && (auth.run.status === 'running' || auth.run.status === 'interrupted')
  if (!recovery && (auth.run.status !== 'running' || auth.run.lease_until <= now)) fail(409, 'This run has ended. Its partial answer is preserved.')
  const current = await thread(auth.db, auth.card.id)
  await commit(auth.db, [guard(auth.db, auth, current.revision),
    auth.db.prepare(`UPDATE chat_turns SET status=?1,answer=?2,finished_at=?3,usage=?4,error=?5,finish_hash=?6
      WHERE id=?7 AND finish_hash IS NULL AND status IN ('running','interrupted')`).bind(body.status, body.answer, now, body.usage ? JSON.stringify(body.usage) : null, body.error ?? null, finishHash, auth.run.id),
    auth.db.prepare('UPDATE chat_threads SET revision=revision+1 WHERE id=?1').bind(auth.card.id),
  ])
  return c.json({ ok: true, replay: false })
})

chats.post('/chats/:chatId/branch', async (c) => {
  const body = await parse(c, z.strictObject({ targetId: id, messageId: id })), source = await authorize(c, true)
  const targetRow = await source.db.prepare('SELECT id,data,seq,owner_id,board_id FROM objects WHERE id=?1').bind(body.targetId).first<ObjectRow>()
  if (!targetRow || targetRow.board_id !== source.card.boardId || (targetRow.owner_id && targetRow.owner_id !== source.me.id)) fail(403, 'Create an empty chat on this board first')
  const target = JSON.parse(targetRow.data) as Card
  if (target.kind !== 'card' || target.type !== 'chat' || target.purged || target.deletedAt || target.id === source.card.id) fail(400, 'Choose an empty chat for the branch')
  const current = await thread(source.db, source.card.id)
  const history = branchHistory(current.turns, body.messageId)
  const parent = JSON.stringify({ chatId: source.card.id, messageId: body.messageId })
  // A lost response can be retried; a different branch may never replace existing history.
  const prior = await source.db.prepare('SELECT parent FROM chat_threads WHERE id=?1').bind(target.id).first<{ parent: string | null }>()
  if (prior) {
    if (prior.parent !== parent) fail(409, 'The target conversation already has history')
    return c.json({ ok: true, replay: true })
  }
  await commit(source.db, [guard(source.db, source, current.revision), accessGuard(source.db, source.access.revision),
    source.db.prepare('INSERT INTO access_write_guard(id,revision) VALUES(1,CASE WHEN (SELECT seq FROM objects WHERE id=?2)=?3 THEN ?1 ELSE -1 END) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').bind(Number(source.access.revision), target.id, targetRow.seq),
    source.db.prepare('INSERT INTO chat_threads(id,inherited,parent) VALUES(?1,?2,?3)').bind(target.id, JSON.stringify(history), parent),
  ])
  return c.json({ ok: true, replay: false }, 201)
})

/** Narrow app operation: no provider receives board MCP credentials or arbitrary patch tools. */
chats.post('/chats/:chatId/task-proposal', async (c) => {
  const body = await parse(c, z.strictObject({ operationId: id, messageId: id, selectedText: z.string().min(1).max(CHAT_LIMITS.answerChars), title: z.string().trim().min(1).max(160), tasks: z.array(z.string().trim().min(1).max(1000)).min(1).max(50) }))
  const auth = await authorize(c, true), current = await thread(auth.db, auth.card.id)
  const selected = current.turns.find((turn) => turn.id === body.messageId && turn.status === 'completed')
  if (!selected || !selected.answer.includes(body.selectedText) && !mdToText(selected.answer).includes(body.selectedText)) fail(400, 'Choose text from a completed answer')
  const hash = await sha256Hex(JSON.stringify({ chatId: auth.card.id, ...body }))
  const prior = await auth.db.prepare('SELECT * FROM chat_outputs WHERE id=?1').bind(body.operationId).first<{ user_id: string; chat_id: string; request_hash: string; proposal_id: string }>()
  if (prior) {
    if (prior.user_id !== auth.me.id || prior.chat_id !== auth.card.id || prior.request_hash !== hash) fail(409, 'This output operation ID has already been used')
    return c.json({ id: prior.proposal_id, replay: true })
  }
  const now = Date.now(), credentialId = crypto.randomUUID(), proposalId = crypto.randomUUID()
  const credential = { id: credentialId, user_id: auth.me.id, name: 'Chat task proposal', mode: 'propose' as const, board_ids: JSON.stringify([auth.card.boardId]), expires_at: now + 90 * 86_400_000, revoked_at: null }
  const todoId = `tasks-${hash.slice(0, 48)}`
  const object = { id: todoId, kind: 'card' as const, type: 'todo' as const, boardId: auth.card.boardId, createdAt: now, x: auth.card.x + auth.card.w + 40, y: auth.card.y, w: 260, h: 110, z: auth.card.z + 1, color: 'none' as const, content: { title: body.title, items: body.tasks.map((text, i) => ({ id: `task-${i}`, text, done: false })) } }
  const input = { idempotencyKey: body.operationId, label: `Tasks from conversation: ${body.title}`.slice(0, 160), operations: [{ action: 'create' as const, object }] }
  const changes = await prepareAgentChanges(auth.db, auth.access, credential, auth.me, input)
  await commit(auth.db, [guard(auth.db, auth, current.revision),
    auth.db.prepare("INSERT INTO agent_credentials(id,user_id,name,token_hash,mode,board_ids,created_at,expires_at,origin) VALUES(?1,?2,?3,?4,'propose',?5,?6,?7,'chat-output')").bind(credentialId, auth.me.id, credential.name, await sha256Hex(crypto.randomUUID()), credential.board_ids, now, credential.expires_at),
    auth.db.prepare('INSERT INTO agent_proposals(id,credential_id,user_id,request_key,request_hash,label,changes,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)').bind(proposalId, credentialId, auth.me.id, body.operationId, hash, input.label, JSON.stringify(changes), now),
    auth.db.prepare('INSERT INTO chat_outputs(id,user_id,chat_id,request_hash,proposal_id) VALUES(?1,?2,?3,?4,?5)').bind(body.operationId, auth.me.id, auth.card.id, hash, proposalId),
  ])
  return c.json({ id: proposalId, replay: false }, 201)
})
