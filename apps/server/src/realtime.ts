import { Hono } from 'hono'
import { livePoint, presenceInput, type LivePresence, type RoomEvent } from '@doggynote/core'
import type { AppEnv, Env, User } from './env.ts'
import { requireUser } from './auth.ts'
import { loadAccess } from './access.ts'

type Attachment = { member: LivePresence; hash: string; board: string; seen: number; last: number; lastPing?: number; windowStart?: number; windowCount?: number }
/** Clients send at most ~13 presence frames a second; this leaves room for bunching. */
export const PRESENCE_PER_SECOND = 30
type Ticket = { user: User; hash: string; board: string; expires: number; canEdit: boolean }
function closeSocket(socket: WebSocket, code = 1000, reason?: string) {
  try { socket.close(code, reason) } catch { /* The transport may already be gone. */ }
}
export const realtime = new Hono<AppEnv>()

realtime.post('/boards/:board/live-ticket', requireUser, async (c) => {
  const board = c.req.param('board'), access = await loadAccess(c.env.DB, c.get('user'))
  if (!access.canRead(board)) return c.json({ error: 'Board unavailable' }, 403)
  const ticket = crypto.randomUUID()
  const room = c.env.ROOMS.get(c.env.ROOMS.idFromName(board))
  await room.fetch(new Request('https://room/ticket', { method: 'POST', body: JSON.stringify({ ticket, user: c.get('user'), hash: c.get('sessionHash'), board, expires: Date.now() + 30_000, canEdit: access.canEdit(board) }) }))
  c.header('cache-control', 'no-store')
  return c.json({ ticket })
})
realtime.get('/boards/:board/live', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'WebSocket required' }, 400)
  const origin = c.req.header('origin'), url = new URL(c.req.url)
  const allowed = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((v) => v.trim())
  // Same-origin browsers, explicitly allowed desktop origins, and local Vite proxies.
  if (!origin || (origin !== url.origin && !allowed.includes(origin) && !(url.hostname === 'localhost' && /^http:\/\/localhost:\d+$/.test(origin)))) return c.json({ error: 'Origin refused' }, 403)
  return c.env.ROOMS.get(c.env.ROOMS.idFromName(c.req.param('board'))).fetch(c.req.raw)
})

/** Only invalidations cross the room: actual objects always use authorized sync. */
export async function notifyRooms(env: Env, boards: Iterable<string>) {
  if (!env.ROOMS) return // Node integration fixtures don't run Durable Objects.
  const results = await Promise.allSettled([...new Set(boards)].filter(Boolean).map((id) => env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request('https://room/changed', { method: 'POST' }))))
  if (results.some((r) => r.status === 'rejected' || !r.value.ok)) console.warn('[live] notification_failed')
}

export class BoardRoom {
  private changing: Promise<void> | null = null
  private presenceChanging: Promise<void> | null = null
  private presenceVersion = 0
  private permissions = new Map<string, { revision: number; read: boolean; edit: boolean }>()
  constructor(private ctx: DurableObjectState, private env: Env) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/ticket') {
      const data = await request.json() as Ticket & { ticket: string }
      await this.ctx.storage.put(`ticket:${data.ticket}`, data)
      await this.ctx.storage.setAlarm(Date.now() + 30_000)
      return new Response('ok')
    }
    if (url.pathname === '/changed') {
      this.changing ??= new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => this.broadcast({ type: 'changed' })).catch(() => { console.warn('[live] notification_failed') }).finally(() => { this.changing = null })
      this.ctx.waitUntil(this.changing)
      return new Response('ok')
    }
    // The one-use short-lived ticket is sent in the first frame, never in URLs/logs.
    const pair = new WebSocketPair(), client = pair[0], server = pair[1]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ seen: Date.now(), last: 0 })
    await this.ctx.storage.setAlarm(Date.now() + 5000)
    return new Response(null, { status: 101, webSocket: client })
  }
  private async authorized(a: Attachment): Promise<boolean> {
    const session = await this.env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash=?1 AND user_id=?2 AND expires_at>?3').bind(a.hash, a.member.userId, Date.now()).first()
    if (!session) return false
    const user = await this.env.DB.prepare('SELECT is_admin FROM users WHERE id=?1').bind(a.member.userId).first<{ is_admin: number }>()
    const access = await loadAccess(this.env.DB, { id: a.member.userId, isAdmin: !!user?.is_admin })
    a.member.canEdit = access.canEdit(a.board)
    return access.canRead(a.board)
  }
  private async peers(): Promise<[WebSocket, Attachment][]> {
    const candidates: [WebSocket, Attachment][] = []
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue
      const a = socket.deserializeAttachment() as Attachment
      if (!a?.member) { if (!a || Date.now() - a.seen >= 5000) closeSocket(socket, 1008, 'Sign in required'); continue }
      if (Date.now() - a.seen > 30_000) { closeSocket(socket, 1008, 'Presence expired'); continue }
      candidates.push([socket, a])
    }
    if (!candidates.length) return []
    // One session lookup per broadcast, rather than N authorization walks per
    // incoming pointer. Revoked sessions still disappear before any broadcast.
    const hashes = [...new Set(candidates.map(([, a]) => a.hash))]
    const sessions = new Map<string, { id: string; username: string; is_admin: number }>()
    const revision = Number((await this.env.DB.prepare("SELECT value FROM counters WHERE name='access_revision'").first<{ value: number }>())?.value ?? 0)
    for (let i = 0; i < hashes.length; i += 90) {
      const chunk = hashes.slice(i, i + 90)
      const { results } = await this.env.DB.prepare(`SELECT s.token_hash,u.id,u.username,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>?1 AND s.token_hash IN (${chunk.map((_, j) => `?${j + 2}`).join(',')})`).bind(Date.now(), ...chunk).all<{ token_hash: string; id: string; username: string; is_admin: number }>()
      for (const row of results) sessions.set(row.token_hash, row)
    }
    const peers: [WebSocket, Attachment][] = []
    for (const [socket, initial] of candidates) {
      const session = sessions.get(initial.hash)
      if (!session || session.id !== initial.member.userId) { closeSocket(socket, 1008, 'Session expired'); continue }
      const key = `${initial.board}:${session.id}`
      let permission = this.permissions.get(key)
      if (!permission || permission.revision !== revision) {
        const access = await loadAccess(this.env.DB, { id: session.id, isAdmin: !!session.is_admin })
        permission = { revision: Number(access.revision), read: access.canRead(initial.board), edit: access.canEdit(initial.board) }
        this.permissions.set(key, permission)
      }
      if (!permission.read) { closeSocket(socket, 1008, 'Access changed'); continue }
      const a = socket.deserializeAttachment() as Attachment
      a.member.canEdit = permission.edit; a.member.username = session.username
      if (!permission.edit) { a.member.editing = null; a.member.previews = []; a.member.caret = null }
      peers.push([socket, a])
    }
    // Moving or deleting a card invalidates old selections and carets too.
    const ids = [...new Set(peers.flatMap(([, a]) => [...a.member.selection, ...a.member.previews.map((p) => p.id), ...(a.member.editing ? [a.member.editing] : [])]))]
    const boards = new Map<string, string>()
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90)
      const { results } = await this.env.DB.prepare(`SELECT id,board_id FROM objects WHERE id IN (${chunk.map((_, j) => `?${j + 1}`).join(',')}) AND COALESCE(json_extract(data,'$.deletedAt'),0)=0 AND COALESCE(json_extract(data,'$.purged'),0)=0`).bind(...chunk).all<{ id: string; board_id: string }>()
      for (const row of results) boards.set(row.id, row.board_id)
    }
    for (const [socket, a] of peers) {
      a.member.selection = a.member.selection.filter((id) => boards.get(id) === a.board)
      a.member.previews = a.member.previews.filter((p) => boards.get(p.id) === a.board)
      if (boards.get(a.member.editing ?? '') !== a.board) { a.member.editing = null; a.member.caret = null }
      const current = socket.deserializeAttachment() as Attachment
      // Authorization awaits must not overwrite a newer pointer/selection frame.
      if (current.last === a.last && current.seen === a.seen) socket.serializeAttachment(a)
    }
    return peers
  }
  private async broadcast(event?: RoomEvent, source?: string) {
    const peers = await this.peers()
    if (source && !peers.some(([, a]) => a.member.sessionId === source)) event = undefined
    // Commit/ping authorization may have removed a session or a deleted-card
    // preview. Publish that sanitized state immediately, not at the heartbeat.
    const members = JSON.stringify({ type: 'members', members: peers.map(([, a]) => a.member) })
    const message = event ? JSON.stringify(event) : null
    for (const [socket] of peers) { try { socket.send(members); if (message) socket.send(message) } catch { closeSocket(socket) } }
  }
  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 32_768) { closeSocket(socket, 1009, 'Message too large'); return }
    let data: Record<string, unknown>
    try { data = JSON.parse(raw) } catch { closeSocket(socket, 1008, 'Invalid message'); return }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { closeSocket(socket, 1008, 'Invalid message'); return }
    let a = socket.deserializeAttachment() as Attachment
    if (!a?.member) {
      if (data.type !== 'auth' || typeof data.ticket !== 'string') { closeSocket(socket, 1008, 'Sign in required'); return }
      const key = `ticket:${data.ticket}`
      const ticket = await this.ctx.storage.transaction(async (storage) => {
        const value = await storage.get<Ticket>(key)
        await storage.delete(key)
        return value
      })
      if (!ticket || ticket.expires < Date.now()) { closeSocket(socket, 1008, 'Ticket expired'); return }
      a = { hash: ticket.hash, board: ticket.board, seen: Date.now(), last: 0, member: { sessionId: crypto.randomUUID(), userId: ticket.user.id, username: ticket.user.username, canEdit: ticket.canEdit, pointer: null, selection: [], editing: null, camera: { x: 0, y: 0, zoom: 1 }, width: 1, height: 1, previews: [], caret: null } }
      if (!await this.authorized(a)) { closeSocket(socket, 1008, 'Access changed'); return }
      socket.serializeAttachment(a)
      try { socket.send(JSON.stringify({ type: 'ready', sessionId: a.member.sessionId })) } catch { return }
      await this.broadcast()
      return
    }
    // Presence is a budget per second, not a minimum gap: clients send at most every
    // 75ms, but network and CPU delays bunch frames, and dropping one loses the newest
    // pointer or camera for good. Broadcasts are already coalesced below.
    if (data.type === 'presence') {
      const now = Date.now()
      if (now - (a.windowStart ?? 0) >= 1000) { a.windowStart = now; a.windowCount = 0 }
      a.windowCount = (a.windowCount ?? 0) + 1
      if (a.windowCount > PRESENCE_PER_SECOND) return
    }
    if (data.type === 'ping' && Date.now() - (a.lastPing ?? 0) < 1000) return
    a.seen = Date.now()
    if (data.type === 'presence') {
      a.last = Date.now()
      const input = presenceInput(data)
      if (!input) { closeSocket(socket, 1008, 'Invalid presence'); return }
      // Identity stays attached to the session. Permissions and object scope are
      // revalidated together at the broadcast boundary, before any data leaves.
      a.member = { ...a.member, ...input }
      socket.serializeAttachment(a)
      this.presenceVersion++
      this.presenceChanging ??= (async () => {
        let sent: number
        do {
          await new Promise<void>((resolve) => setTimeout(resolve, 67))
          sent = this.presenceVersion
          await this.broadcast()
        } while (sent !== this.presenceVersion)
      })().catch(() => { console.warn('[live] presence_failed') }).finally(() => { this.presenceChanging = null })
      this.ctx.waitUntil(this.presenceChanging)
    } else if (data.type === 'ping' && livePoint(data.point)) {
      a.lastPing = Date.now()
      socket.serializeAttachment(a)
      await this.broadcast({ type: 'ping', id: crypto.randomUUID(), userId: a.member.userId, username: a.member.username, point: data.point }, a.member.sessionId)
    }
    await this.ctx.storage.setAlarm(Date.now() + 15_000)
  }
  async webSocketClose(socket: WebSocket) { closeSocket(socket); await this.broadcast() }
  async webSocketError(socket: WebSocket) { closeSocket(socket); await this.broadcast() }
  async alarm() {
    const tickets = await this.ctx.storage.list<Ticket>({ prefix: 'ticket:' })
    for (const [key, ticket] of tickets) if (ticket.expires <= Date.now()) await this.ctx.storage.delete(key)
    await this.broadcast()
    if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + 15_000)
  }
}
