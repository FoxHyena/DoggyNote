import { Hono, type Context } from 'hono'
import { agentProposalSchema, type AgentChange, type AgentObject, type AgentProposalInput } from '@doggynote/core/agent'
import { z } from 'zod'
import type { AppEnv, User } from './env.ts'
import { requireUser } from './auth.ts'
import { randomToken, sha256Hex } from './crypto.ts'
import { loadAccess, type Access } from './access.ts'
import { deniedChanges, ownerFor, deletedCommentOwner, stampComment } from './sync.ts'

type Credential = { id: string; user_id: string; name: string; mode: 'read' | 'propose'; board_ids: string; expires_at: number; revoked_at: number | null }
type AgentEnv = AppEnv & { Variables: AppEnv['Variables'] & { agent: Credential } }
type Row = { id: string; data: string; seq: number; owner_id: string | null }
type Proposal = { id: string; credential_id: string; user_id: string; label: string; status: string; changes: string; applied_revisions: string | null; created_at: number; applied_at: number | null; request_hash: string }
type RecordObject = { object: AgentObject; revision: number; owner: string | null }
const DAY = 86_400_000
/** The guard SQL in applyProposal quotes ids inline, so they are re-checked right before. */
const SAFE_ID = /^[a-zA-Z0-9_:-]{1,64}$/
const active = (o: AgentObject) => !o.deletedAt && !o.purged
const onBoard = (o: AgentObject) => o.kind === 'board' ? o.id : o.boardId
const error = (message: string) => { throw new Error(message) }
const credentialsSchema = z.strictObject({ name: z.string().trim().min(1).max(80), mode: z.enum(['read', 'propose']), boardIds: z.array(z.string().regex(/^[a-zA-Z0-9_:-]{1,64}$/)).min(1).max(100), expiresInDays: z.number().int().min(1).max(90).default(90) })

async function records(db: D1Database): Promise<Map<string, RecordObject>> {
  const { results } = await db.prepare('SELECT id,data,seq,owner_id FROM objects').all<Row>()
  return new Map(results.map((r) => [r.id, { object: JSON.parse(r.data), revision: r.seq, owner: r.owner_id }]))
}

/** Scope follows canonical ancestry, always intersected with the user's current access. */
export function inAgentScope(access: Access, credential: Pick<Credential, 'board_ids'>, boardId: string): boolean {
  const roots = new Set<string>(JSON.parse(credential.board_ids))
  const seen = new Set<string>()
  let current: string | null = boardId
  while (current && !seen.has(current)) {
    if (roots.has(current)) return true
    seen.add(current)
    current = access.boards.get(current)?.parentId ?? null
  }
  return false
}

function readable(access: Access, credential: Credential, userId: string, row: RecordObject): boolean {
  return (!row.owner || row.owner === userId) && access.canRead(onBoard(row.object)) && inAgentScope(access, credential, onBoard(row.object))
}

function schemaError(result: { error: z.ZodError }) {
  return result.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ')
}

export function sameAgentState(a: AgentObject, b: AgentObject): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key, v]) => !(key === 'h' && (value as { kind?: string }).kind === 'card') && v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, normalize(v)]))
    return value
  }
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

/** Resolve and validate one proposal without touching live objects. */
export async function prepareAgentChanges(db: D1Database, access: Access, credential: Credential, user: User, input: AgentProposalInput): Promise<AgentChange[]> {
  const all = await records(db)
  const changes = new Map<string, AgentChange>()
  for (const operation of input.operations) {
    const id = 'object' in operation ? operation.object.id : operation.id
    if (changes.has(id)) error('Only one operation per object is allowed')
    const previous = all.get(id)
    if (operation.action === 'create' ? !!previous : !previous) error('An object was created or removed; refresh the board')
    if (operation.action !== 'create' && previous!.revision !== operation.expectedRevision) error('Revision conflict; read the board again')
    if (previous && !readable(access, credential, user.id, previous)) error('Object is outside this connection’s scope')
    if (operation.action === 'create' && /^(home|toybox)(:|$)/.test(id)) error('Reserved board identifier')
    let after: AgentObject
    if ('object' in operation) after = structuredClone(operation.object)
    else after = { ...previous!.object, deletedAt: operation.action === 'trash' ? Date.now() : null }
    if (operation.action === 'create') after.createdAt = Date.now()
    if (after.purged) error('Permanent deletion is unavailable to agents')
    if (previous && (previous.object.kind !== after.kind || (previous.object.kind === 'card' && after.kind === 'card' && previous.object.type !== after.type))) error('Object type cannot change')
    changes.set(id, { id, before: previous?.object ?? null, after, expectedRevision: previous?.revision ?? null })
  }
  // Moving a column includes its children. Comments follow their cards and
  // cross-board connections disappear in the same reversible transaction.
  let added = true
  while (added) {
    added = false
    for (const row of all.values()) {
      if (!readable(access, credential, user.id, row)) continue
      const o = row.object
      if (o.kind !== 'card' || !o.columnId || changes.has(o.id)) continue
      const parent = changes.get(o.columnId)
      if (parent?.after.kind === 'card' && parent.after.boardId !== o.boardId) {
        changes.set(o.id, { id: o.id, before: o, after: { ...o, boardId: parent.after.boardId }, expectedRevision: row.revision })
        added = true
      }
    }
  }
  const next = (id: string) => changes.get(id)?.after ?? all.get(id)?.object
  for (const row of all.values()) {
    if (!readable(access, credential, user.id, row)) continue
    const o = row.object
    if (o.kind === 'comment') {
      const card = next(o.cardId)
      if (card?.kind === 'card' && card.boardId !== o.boardId && !changes.has(o.id)) changes.set(o.id, { id: o.id, before: o, after: { ...o, boardId: card.boardId }, expectedRevision: row.revision })
    }
    if (o.kind === 'connection' && active(o)) {
      const from = next(o.from), to = next(o.to)
      if ((from?.kind === 'card' && from.boardId !== o.boardId) || (to?.kind === 'card' && to.boardId !== o.boardId)) {
        if (!changes.has(o.id)) changes.set(o.id, { id: o.id, before: o, after: { ...o, purged: true }, expectedRevision: row.revision })
      }
    }
  }
  if (changes.size > 200) error('This proposal affects more than 200 objects; split it into smaller changes')
  await validateChanges(db, access, credential, user, [...changes.values()])
  return [...changes.values()]
}

async function validateChanges(db: D1Database, access: Access, credential: Credential, user: User, changes: AgentChange[]) {
  const created = new Map(changes.filter((c) => !c.before && c.after.kind === 'board').map((c) => [c.id, c.after]))
  const scoped = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    const b = created.get(id)
    return b?.kind === 'board' ? !!b.parentId && scoped(b.parentId, seen) : access.canEdit(id) && inAgentScope(access, credential, id)
  }
  const all = await records(db)
  const patches = changes.map((change) => {
    const after = change.after
    if (!scoped(onBoard(after)) || (change.before && !scoped(onBoard(change.before)))) error('Board is outside the connection’s editable scope')
    const before = change.before
    if (before && before.createdAt !== after.createdAt) error('Creation timestamp cannot change')
    if (before?.kind === 'comment' && after.kind === 'comment' && (before.authorId !== after.authorId || before.author !== after.author)) error('Comment author cannot change')
    if (after.kind === 'card' && (after.type === 'image' || after.type === 'file')) {
      const assetId = after.content.assetId
      const existingId = before?.kind === 'card' && (before.type === 'image' || before.type === 'file') ? before.content.assetId : null
      if (assetId !== existingId && ![...all.values()].some((r) => r.object.kind === 'card' && (r.object.type === 'image' || r.object.type === 'file') && r.object.content.assetId === assetId && readable(access, credential, user.id, r))) error('Use an asset already visible within this connection’s boards')
    }
    // Protect server-stamped identity while allowing an unchanged foreign
    // comment to follow its card between boards.
    const old = before as unknown as Record<string, unknown> | null
    const value = after as unknown as Record<string, unknown>
    // Full replacements can remove optional fields. Authorize those removals
    // too, while treating omitted and null optional values like normal sync.
    const patch: Record<string, unknown> = old ? Object.fromEntries(
      [...new Set([...Object.keys(old), ...Object.keys(value)])]
        .filter((key) => !(old[key] == null && value[key] == null) && JSON.stringify(old[key]) !== JSON.stringify(value[key]))
        .map((key) => [key, value[key]]),
    ) : { ...after }
    const denied = stampComment(patch, before ? { kind: before.kind, author_id: before.kind === 'comment' ? before.authorId : null } : undefined, after.kind, user)
    if (denied) error(denied)
    if (after.kind === 'comment' && !before) { after.authorId = user.id; after.author = user.username }
    return { id: change.id, patch }
  })
  const denied = await deniedChanges(db, access, user.id, patches)
  if (denied.length) error('A related board, card, comment or asset is no longer editable')
}

export const agents = new Hono<AgentEnv>()

agents.get('/agent-connection-boards', requireUser, async (c) => {
  const access = await loadAccess(c.env.DB, c.get('user'))
  const { results } = await c.env.DB.prepare("SELECT o.id,json_extract(o.data,'$.title') AS title,u.username FROM objects o LEFT JOIN board_access a ON a.board_id=o.id LEFT JOIN users u ON u.id=a.owner_id WHERE o.kind='board' AND COALESCE(json_extract(o.data,'$.purged'),0)=0 AND COALESCE(json_extract(o.data,'$.deletedAt'),0)=0").all<{ id: string; title: string; username: string | null }>()
  const title = (b: { id: string; title: string }) => b.id.startsWith('toybox:') ? 'Inbox' : b.title || 'Untitled board'
  const titles = new Map(results.filter((b) => access.canRead(b.id)).map((b) => [b.id, title(b)]))
  const boards = results.filter((b) => access.canRead(b.id)).map((b) => {
    let label = title(b)
    if (b.id.startsWith('home:')) label = b.id === access.homeBoardId ? `${label} (yours)` : `Private Doghouse${b.username ? ` · @${b.username}` : ' · former account'}`
    else {
      const parent = access.boards.get(b.id)?.parentId
      if (parent && titles.has(parent)) label += ` · ${titles.get(parent)}`
      if (b.username) label += b.username === c.get('user').username ? ' · yours' : ` · @${b.username}`
    }
    return { id: b.id, label, canEdit: access.canEdit(b.id) }
  }).sort((a, b) => a.label.localeCompare(b.label))
  c.header('cache-control', 'no-store')
  return c.json({ boards })
})

agents.get('/agent-connections', requireUser, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id,name,mode,board_ids,created_at,expires_at,revoked_at,last_used_at FROM agent_credentials WHERE user_id=?1 ORDER BY created_at DESC').bind(c.get('user').id).all<Record<string, unknown>>()
  return c.json({ connections: results.map((r) => ({ id: r.id, name: r.name, mode: r.mode, boardIds: JSON.parse(r.board_ids as string), createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at, lastUsedAt: r.last_used_at })) })
})
agents.post('/agent-connections', requireUser, async (c) => {
  const parsed = credentialsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: schemaError(parsed) }, 400)
  const a = await loadAccess(c.env.DB, c.get('user'))
  if (parsed.data.boardIds.some((id) => parsed.data.mode === 'propose' ? !a.canEdit(id) : !a.canRead(id))) return c.json({ error: 'Choose boards you can access' }, 403)
  const id = crypto.randomUUID(), token = `dn_agent_${randomToken()}`, now = Date.now()
  const expiresAt = now + parsed.data.expiresInDays * DAY
  await c.env.DB.prepare('INSERT INTO agent_credentials(id,user_id,name,token_hash,mode,board_ids,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)').bind(id, c.get('user').id, parsed.data.name, await sha256Hex(token), parsed.data.mode, JSON.stringify([...new Set(parsed.data.boardIds)]), now, expiresAt).run()
  c.header('cache-control', 'no-store')
  return c.json({ id, token, expiresAt }, 201)
})
agents.delete('/agent-connections/:id', requireUser, async (c) => {
  await c.env.DB.prepare('UPDATE agent_credentials SET revoked_at=?1 WHERE id=?2 AND user_id=?3').bind(Date.now(), c.req.param('id'), c.get('user').id).run()
  return c.json({ ok: true })
})

const machine = new Hono<AgentEnv>()
machine.use('*', async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer (dn_agent_\S+)$/)?.[1]
  if (!token) return c.json({ error: 'Agent connection token required' }, 401)
  const r = await c.env.DB.prepare('SELECT a.*,u.username,u.is_admin FROM agent_credentials a JOIN users u ON u.id=a.user_id WHERE a.token_hash=?1 AND a.revoked_at IS NULL AND a.expires_at>?2').bind(await sha256Hex(token), Date.now()).first<Credential & { username: string; is_admin: number }>()
  if (!r) return c.json({ error: 'Agent connection expired or revoked' }, 401)
  c.set('agent', r)
  c.set('user', { id: r.user_id, username: r.username, isAdmin: !!r.is_admin })
  c.header('cache-control', 'no-store')
  await c.env.DB.prepare('UPDATE agent_credentials SET last_used_at=?1 WHERE id=?2').bind(Date.now(), r.id).run()
  await next()
})
machine.get('/boards', async (c) => {
  const a = await loadAccess(c.env.DB, c.get('user')), all = await records(c.env.DB)
  const query = (c.req.query('query') ?? '').toLowerCase().slice(0, 200)
  return c.json({ boards: [...all.values()].filter((r) => r.object.kind === 'board' && active(r.object) && readable(a, c.get('agent'), c.get('user').id, r) && r.object.title.toLowerCase().includes(query)).map((r) => ({ object: r.object, revision: r.revision, url: `${new URL(c.req.url).origin}/#/b/${r.object.id}` })) })
})
machine.get('/boards/:id', async (c) => {
  const a = await loadAccess(c.env.DB, c.get('user')), all = await records(c.env.DB), id = c.req.param('id')
  const board = all.get(id)
  if (!board || board.object.kind !== 'board' || !readable(a, c.get('agent'), c.get('user').id, board)) return c.json({ error: 'Board unavailable' }, 404)
  const after = c.req.query('after') ?? ''
  const items = [...all.values()].filter((r) => onBoard(r.object) === id && readable(a, c.get('agent'), c.get('user').id, r) && active(r.object) && r.object.id > after).sort((l, r) => l.object.id < r.object.id ? -1 : l.object.id > r.object.id ? 1 : 0)
  const page = items.slice(0, 200)
  return c.json({ board: { object: board.object, revision: board.revision }, objects: page.map((r) => ({ object: r.object, revision: r.revision })), nextCursor: items.length > page.length ? page.at(-1)!.object.id : null })
})
machine.post('/proposals', async (c) => {
  if (c.get('agent').mode !== 'propose') return c.json({ error: 'This connection is read-only' }, 403)
  if (Number(c.req.header('content-length') ?? 0) > 512_000) return c.json({ error: 'Proposal too large' }, 413)
  const raw = await c.req.text()
  if (raw.length > 512_000) return c.json({ error: 'Proposal too large' }, 413)
  let body: unknown
  try { body = JSON.parse(raw || 'null') } catch { return c.json({ error: 'Invalid JSON proposal' }, 400) }
  const parsed = agentProposalSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: schemaError(parsed) }, 400)
  const hash = await sha256Hex(JSON.stringify(parsed.data))
  const prior = await c.env.DB.prepare('SELECT id,status,request_hash FROM agent_proposals WHERE credential_id=?1 AND request_key=?2').bind(c.get('agent').id, parsed.data.idempotencyKey).first<{ id: string; status: string; request_hash: string }>()
  if (prior) return prior.request_hash === hash ? c.json({ id: prior.id, status: prior.status, reviewInApp: true }) : c.json({ error: 'Idempotency key already used for another proposal' }, 409)
  try {
    const a = await loadAccess(c.env.DB, c.get('user'))
    const changes = await prepareAgentChanges(c.env.DB, a, c.get('agent'), c.get('user'), parsed.data)
    const id = crypto.randomUUID()
    try {
      await c.env.DB.prepare('INSERT INTO agent_proposals(id,credential_id,user_id,request_key,request_hash,label,changes,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)').bind(id, c.get('agent').id, c.get('user').id, parsed.data.idempotencyKey, hash, parsed.data.label, JSON.stringify(changes), Date.now()).run()
    } catch (e) {
      const duplicate = await c.env.DB.prepare('SELECT id,status,request_hash FROM agent_proposals WHERE credential_id=?1 AND request_key=?2').bind(c.get('agent').id, parsed.data.idempotencyKey).first<{ id: string; status: string; request_hash: string }>()
      if (duplicate?.request_hash === hash) return c.json({ id: duplicate.id, status: duplicate.status, reviewInApp: true })
      throw e
    }
    return c.json({ id, status: 'pending', reviewInApp: true, changedObjects: changes.length }, 201)
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Invalid proposal' }, 409) }
})
machine.get('/proposals/:id', async (c) => {
  const p = await c.env.DB.prepare('SELECT id,label,status,created_at,applied_at FROM agent_proposals WHERE id=?1 AND credential_id=?2').bind(c.req.param('id'), c.get('agent').id).first()
  return p ? c.json({ proposal: p }) : c.json({ error: 'Proposal unavailable' }, 404)
})
agents.route('/agent', machine)

async function ownedProposal(c: Context<AgentEnv>): Promise<Proposal | null> {
  return c.env.DB.prepare('SELECT * FROM agent_proposals WHERE id=?1 AND user_id=?2').bind(c.req.param('id'), c.get('user').id).first<Proposal>()
}
function canReviewChanges(access: Access, userId: string, changes: AgentChange[], current: Map<string, RecordObject>): boolean {
  return changes.every((change) => {
    if (change.before && !access.canRead(onBoard(change.before))) return false
    const row = current.get(change.id)
    // Proposal history must not reveal a snapshot after the live object has
    // moved into a private board or a comment has become author-private.
    return !row || ((!row.owner || row.owner === userId) && access.canRead(onBoard(row.object)))
  })
}
agents.get('/agent-proposals', requireUser, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM agent_proposals WHERE user_id=?1 ORDER BY created_at DESC LIMIT 100').bind(c.get('user').id).all<Proposal>()
  const a = await loadAccess(c.env.DB, c.get('user')), current = await records(c.env.DB)
  const boardId = c.req.query('boardId')
  const proposals = results.flatMap((p) => {
    const changes = JSON.parse(p.changes) as AgentChange[]
    if (!canReviewChanges(a, c.get('user').id, changes, current)) return []
    if (boardId && !changes.some((ch) => onBoard(ch.after) === boardId || (ch.before && onBoard(ch.before) === boardId))) return []
    return [{ id: p.id, label: p.label, status: p.status, createdAt: p.created_at, appliedAt: p.applied_at, count: changes.length }]
  })
  c.header('cache-control', 'no-store')
  return c.json({ proposals })
})
agents.get('/agent-proposals/:id', requireUser, async (c) => {
  const p = await ownedProposal(c)
  if (!p) return c.json({ error: 'Proposal unavailable' }, 404)
  const changes = JSON.parse(p.changes) as AgentChange[]
  const a = await loadAccess(c.env.DB, c.get('user')), all = await records(c.env.DB)
  if (!canReviewChanges(a, c.get('user').id, changes, all)) return c.json({ error: 'Board or object access was removed' }, 403)
  const ids = new Set(changes.flatMap((ch) => [onBoard(ch.after), ...(ch.before ? [onBoard(ch.before)] : [])]))
  const before = [...all.values()].filter((r) => ids.has(onBoard(r.object)) && (!r.owner || r.owner === c.get('user').id) && a.canRead(onBoard(r.object))).map((r) => r.object)
  const after = new Map(before.map((o) => [o.id, o]))
  for (const ch of changes) after.set(ch.id, ch.after)
  c.header('cache-control', 'no-store')
  return c.json({ proposal: { id: p.id, label: p.label, status: p.status, changes, createdAt: p.created_at }, before, after: [...after.values()] })
})
agents.post('/agent-proposals/:id/reject', requireUser, async (c) => {
  const p = await ownedProposal(c)
  if (!p) return c.json({ error: 'Proposal unavailable' }, 404)
  await c.env.DB.prepare("UPDATE agent_proposals SET status='rejected' WHERE id=?1 AND status='pending'").bind(p.id).run()
  return c.json({ ok: true })
})

/** All preconditions and writes share one D1 transaction. The guarded status
 * transition is the gate for every subsequent statement; a conflict writes nothing. */
async function applyProposal(c: Context<AgentEnv>, reverse: boolean) {
  const db = c.env.DB, p = await ownedProposal(c)
  if (!p) return c.json({ error: 'Proposal unavailable' }, 404)
  const final = reverse ? 'reversed' : 'applied', previous = reverse ? 'applied' : 'pending', transitional = reverse ? 'reversing' : 'applying'
  if (p.status === final) return c.json({ ok: true, status: final })
  if (p.status !== previous) return c.json({ error: 'Proposal is no longer available for this action' }, 409)
  const credential = await db.prepare('SELECT * FROM agent_credentials WHERE id=?1').bind(p.credential_id).first<Credential>()
  if (!credential || (!reverse && (credential.revoked_at || credential.expires_at <= Date.now()))) return c.json({ error: 'The agent connection has expired or was revoked' }, 409)
  const original = JSON.parse(p.changes) as AgentChange[]
  const revisions = JSON.parse(p.applied_revisions ?? '{}') as Record<string, number>
  const now = Date.now()
  const current = await records(db)
  if (reverse && original.some((ch) => !current.get(ch.id) || !sameAgentState(current.get(ch.id)!.object, ch.after))) return c.json({ error: 'Revision conflict: an affected object has newer edits. These changes cannot be reversed safely.' }, 409)
  const changes = reverse ? original.map((ch) => {
    const row = current.get(ch.id)!
    const after = ch.before ?? { ...ch.after, deletedAt: now }
    return { id: ch.id, before: row.object, after: after.kind === 'card' && row.object.kind === 'card' ? { ...after, h: row.object.h } : after, expectedRevision: row.revision ?? revisions[ch.id] }
  }) : original
  if (changes.some((ch) => !SAFE_ID.test(ch.id) || !SAFE_ID.test(String(onBoard(ch.after))))) return c.json({ error: 'Invalid object identifier' }, 409)
  let dependencyGuard = '1'
  // Reversal cannot silently strand content subsequently attached to objects
  // this proposal created or moved.
  if (reverse) {
    const ids = new Set(changes.map((ch) => ch.id))
    const created = new Set(original.filter((ch) => !ch.before).map((ch) => ch.id))
    for (const row of current.values()) {
      const o = row.object
      if (ids.has(o.id) || !active(o)) continue
      const references = o.kind === 'board' ? [o.parentId] : o.kind === 'comment' ? [o.cardId, o.boardId] : o.kind === 'connection' ? [o.from, o.to, o.boardId] : [o.boardId, o.columnId, ...(o.type === 'board' ? [o.content.boardId] : [])]
      if (references.some((id) => id && created.has(id))) return c.json({ error: 'New content depends on this proposal. Move or remove it before reversing.' }, 409)
      if (o.kind === 'comment' && changes.some((ch) => ch.after.kind === 'card' && ch.after.id === o.cardId && ch.after.boardId !== o.boardId)) return c.json({ error: 'New comments were added after this move. Prepare a new proposal to move the card safely.' }, 409)
    }
    if (created.size) {
      // Ordinary new cards need not change access_revision. Recheck new
      // dependencies inside the write transaction so a racing insertion into
      // a created board/column cannot be stranded by this reversal.
      const createdIds = [...created].map((id) => `'${id}'`).join(',')
      const changedIds = [...ids].map((id) => `'${id}'`).join(',')
      const references = ['parentId', 'boardId', 'columnId', 'cardId', 'from', 'to', 'content.boardId']
        .map((key) => `json_extract(data,'$.${key}') IN (${createdIds})`).join(' OR ')
      dependencyGuard = `NOT EXISTS(SELECT 1 FROM objects WHERE id NOT IN (${changedIds}) AND COALESCE(json_extract(data,'$.deletedAt'),0)=0 AND COALESCE(json_extract(data,'$.purged'),0)=0 AND (${references}))`
    }
    const moved = changes.filter((ch) => ch.before?.kind === 'card' && ch.after.kind === 'card' && ch.before.boardId !== ch.after.boardId)
    if (moved.length) {
      const changedIds = [...ids].map((id) => `'${id}'`).join(',')
      const references = moved.map((ch) => `(json_extract(data,'$.cardId')='${ch.id}' AND json_extract(data,'$.boardId')<>'${onBoard(ch.after)}')`).join(' OR ')
      dependencyGuard += ` AND NOT EXISTS(SELECT 1 FROM objects WHERE kind='comment' AND id NOT IN (${changedIds}) AND COALESCE(json_extract(data,'$.deletedAt'),0)=0 AND COALESCE(json_extract(data,'$.purged'),0)=0 AND (${references}))`
    }
  }
  const a = await loadAccess(db, c.get('user'))
  try { await validateChanges(db, a, credential, c.get('user'), changes) }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Board access changed' }, 403) }
  const guard = changes.map((ch) => ch.expectedRevision === null ? `NOT EXISTS(SELECT 1 FROM objects WHERE id='${ch.id}')` : `EXISTS(SELECT 1 FROM objects WHERE id='${ch.id}' AND seq=${Number(ch.expectedRevision)})`).join(' AND ')
  const gate = `EXISTS(SELECT 1 FROM agent_proposals WHERE id=?1 AND status='${transitional}')`
  const credentialGuard = reverse ? '' : 'AND EXISTS(SELECT 1 FROM agent_credentials WHERE id=?3 AND revoked_at IS NULL AND expires_at>?4)'
  const gateStatement = db.prepare(`UPDATE agent_proposals SET status='${transitional}' WHERE id=?1 AND status='${previous}' AND ${guard} AND ${dependencyGuard} AND (SELECT value FROM counters WHERE name='access_revision')=?2 ${credentialGuard}`)
  const stmts = [reverse ? gateStatement.bind(p.id, Number(a.revision)) : gateStatement.bind(p.id, Number(a.revision), credential.id, now)]
  let accessChanged = false
  for (const ch of changes) {
    const o = ch.after
    const owner = ownerFor(o.id, o.kind === 'board' ? null : o.boardId) ?? deletedCommentOwner(o.kind, o as unknown as Record<string, unknown>, ch.before ? { kind: ch.before.kind, author_id: ch.before.kind === 'comment' ? ch.before.authorId : null, deleted_at: ch.before.deletedAt ?? null, purged: ch.before.purged ? 1 : 0 } : undefined, c.get('user').id)
    stmts.push(db.prepare(`UPDATE counters SET value=value+1 WHERE name='seq' AND ${gate}`).bind(p.id))
    stmts.push(db.prepare(`INSERT INTO objects(id,kind,board_id,data,seq,updated_at,updated_by,owner_id) SELECT ?2,?3,?4,?5,(SELECT value FROM counters WHERE name='seq'),?6,?7,?8 WHERE ${gate} ON CONFLICT(id) DO UPDATE SET data=excluded.data,board_id=excluded.board_id,seq=excluded.seq,updated_at=excluded.updated_at,updated_by=excluded.updated_by,owner_id=excluded.owner_id`).bind(p.id, o.id, o.kind, o.kind === 'board' ? null : o.boardId, JSON.stringify(o), now, c.get('user').id, owner))
    if (o.kind === 'board') {
      accessChanged = true
      if (!ch.before && !reverse) stmts.push(db.prepare(`INSERT INTO board_access(board_id,owner_id,legacy) SELECT ?2,?3,0 WHERE ${gate}`).bind(p.id, o.id, c.get('user').id))
    }
    if ((ch.before && ch.before.kind !== 'board' && o.kind !== 'board' && ch.before.boardId !== o.boardId) || o.kind === 'comment') accessChanged = true
  }
  if (accessChanged) stmts.push(db.prepare(`UPDATE counters SET value=value+1 WHERE name='access_revision' AND ${gate}`).bind(p.id))
  // Capture resulting revisions inside the same transaction for safe reversal.
  stmts.push(db.prepare(`UPDATE agent_proposals SET status='${final}',applied_at=?2,applied_revisions=(SELECT json_group_object(id,seq) FROM objects WHERE id IN (${changes.map((ch) => `'${ch.id}'`).join(',')})) WHERE id=?1 AND status='${transitional}'`).bind(p.id, now))
  const result = await db.batch(stmts)
  if (!result[0].meta.changes) {
    const latest = await db.prepare('SELECT status FROM agent_proposals WHERE id=?1').bind(p.id).first<{ status: string }>()
    if (latest?.status === final) return c.json({ ok: true, status: final })
    return c.json({ error: 'Revision conflict: the board changed after this proposal. Ask the agent to read it and prepare a new proposal.' }, 409)
  }
  return c.json({ ok: true, status: final, count: changes.length })
}
agents.post('/agent-proposals/:id/approve', requireUser, (c) => applyProposal(c, false))
agents.post('/agent-proposals/:id/reverse', requireUser, (c) => applyProposal(c, true))
