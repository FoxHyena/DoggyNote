import { createEffect, createMemo, createRoot, createSignal, on, onCleanup } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { decodeUpdate, encodeUpdate, type LivePoint, type LivePresence, type LivePreview, type RoomEvent } from '@doggynote/core'
import { API_BASE, api } from './api.ts'
import { user } from './session.ts'
import { canReadBoard } from './access.ts'
import { boardId, camera, editingId, selection, setCamera, viewport } from './ui.ts'
import * as doc from './doc.ts'
import { syncNow, syncState } from './sync.ts'
import { rectOf } from '../canvas/layout.ts'

const [room, setRoom] = createStore<{ members: LivePresence[] }>({ members: [] })
export const members = () => room.members
const setMembers = (next: LivePresence[]) => setRoom('members', reconcile(next, { key: 'sessionId' }))
export const [liveState, setLiveState] = createSignal<'connecting' | 'live' | 'offline'>('connecting')
export const [selfSession, setSelfSession] = createSignal('')
export const [following, setFollowing] = createSignal<string | null>(null)
type Ping = Extract<RoomEvent, { type: 'ping' }> & { until: number }
export const [pings, setPings] = createSignal<Ping[]>([])
export const peers = () => members().filter((m) => m.sessionId !== selfSession())
export function sessionName(p: LivePresence) {
  const sessions = members().filter((m) => m.userId === p.userId).sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  return `${p.username}${sessions.length > 1 ? ` · device ${sessions.findIndex((m) => m.sessionId === p.sessionId) + 1}` : ''}`
}
export function personColor(id: string) {
  let hash = 0
  for (const ch of id) hash = ((hash * 31) + ch.charCodeAt(0)) | 0
  return ['sky', 'ball', 'lilac', 'collar', 'gold', 'peach'][Math.abs(hash) % 6]!
}
export function personStyle(id: string) {
  const color = personColor(id)
  return { '--person-color': `var(--dn-person-${color})`, '--person-ink': 'var(--dn-person-ink)' }
}
let socket: WebSocket | null = null, pointer: LivePoint | null = null
let caret: LivePresence['caret'] = null
const previews = new Map<string, LivePreview>()
let sendTimer: ReturnType<typeof setTimeout> | null = null, lastSend = 0
const awareness = new Map<string, Awareness>()

export function stopFollowing() { setFollowing(null) }
export function follow(sessionId: string) { setFollowing(sessionId); applyFollow() }
function applyFollow() {
  const leader = peers().find((m) => m.sessionId === following())
  if (!leader) return stopFollowing()
  const v = viewport(), c = leader.camera
  const next = { ...c, x: c.x + (leader.width - v.width) / (2 * c.zoom), y: c.y + (leader.height - v.height) / (2 * c.zoom) }, previous = camera()
  if (next.x !== previous.x || next.y !== previous.y || next.zoom !== previous.zoom) setCamera(next)
}
function sendPresence() {
  sendTimer = null
  if (socket?.readyState !== WebSocket.OPEN || !selfSession()) return
  lastSend = performance.now()
  const v = viewport()
  socket.send(JSON.stringify({ type: 'presence', pointer, selection: [...selection()].slice(0, 100), editing: editingId(), camera: camera(), width: Math.max(1, v.width), height: Math.max(1, v.height), previews: [...previews.values()].slice(0, 100), caret }))
}
export function schedulePresence() {
  sendTimer ??= setTimeout(sendPresence, Math.max(0, 75 - (performance.now() - lastSend)))
}
export function clearLivePreviews() { previews.clear(); schedulePresence() }
export function pingAt(point?: LivePoint) {
  if (socket?.readyState !== WebSocket.OPEN || !selfSession()) return
  const c = camera(), v = viewport(), selected = [...selection()][0], card = selected ? rectOf(selected) : null
  const at = point ?? (card ? { x: card.x + card.w / 2, y: card.y + card.h / 2 } : { x: c.x + v.width / (2 * c.zoom), y: c.y + v.height / (2 * c.zoom) })
  // Keep pings outside the presence rate window on the server.
  const ws = socket
  setTimeout(() => { if (ws === socket && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', point: at })) }, Math.max(0, 75 - (performance.now() - lastSend)))
}

/** Translate board-room relative positions to CodeMirror's awareness protocol. */
export function noteAwareness(id: string) {
  const a = new Awareness(doc.noteDoc(id))
  awareness.set(id, a)
  const color = getComputedStyle(document.documentElement).getPropertyValue(`--dn-person-${personColor(user()?.id ?? '')}`).trim()
  a.setLocalStateField('user', { name: user()?.username ?? '', color, colorLight: color + '33' })
  const changed = (_changes: unknown, origin: unknown) => {
    if (origin === 'remote') return
    const state = a.getLocalState()?.cursor
    caret = state ? { anchor: encodeUpdate(Y.encodeRelativePosition(state.anchor)), head: encodeUpdate(Y.encodeRelativePosition(state.head)) } : null
    schedulePresence()
  }
  a.on('change', changed)
  updateAwareness()
  return { awareness: a, dispose() { a.off('change', changed); a.destroy(); awareness.delete(id); caret = null; schedulePresence() } }
}
export function updateAwareness() {
  for (const [id, a] of awareness) {
    if (doc.isNoteComposing(id)) continue
    const states = a.getStates()
    const removed = [...states.keys()].filter((client) => client !== a.clientID)
    for (const client of removed) states.delete(client)
    let client = 1
    for (const m of peers()) {
      if (m.editing !== id || !m.caret) continue
      while (client === a.clientID) client++
      const color = getComputedStyle(document.documentElement).getPropertyValue(`--dn-person-${personColor(m.userId)}`).trim()
      try { states.set(client++, { user: { name: sessionName(m), color, colorLight: color + '33' }, cursor: { anchor: Y.decodeRelativePosition(decodeUpdate(m.caret.anchor)), head: Y.decodeRelativePosition(decodeUpdate(m.caret.head)) } }) } catch { /* A malformed caret cannot break editing. */ }
    }
    a.emit('change', [{ added: [], updated: [...states.keys()].filter((id) => id !== a.clientID), removed }, 'remote'])
  }
}

export function installRealtime() {
  return createRoot((dispose) => {
    let generation = 0, retry: ReturnType<typeof setTimeout> | null = null, activeBoard = ''
    const disconnect = () => {
      generation++; if (retry) clearTimeout(retry)
      retry = null; socket?.close(); socket = null
      setMembers([]); setSelfSession(''); setPings([]); previews.clear(); pointer = null; caret = null; stopFollowing(); updateAwareness()
    }
    const connect = async () => {
      disconnect()
      const current = generation, board = activeBoard
      if (!board || !user() || document.hidden || !navigator.onLine) { setLiveState('offline'); return }
      setLiveState('connecting')
      const failed = () => {
        if (current !== generation) return
        performance.clearMarks('doggynote.live.connection-failure'); performance.mark('doggynote.live.connection-failure')
        setLiveState('offline'); setMembers([]); setSelfSession(''); stopFollowing(); updateAwareness()
        retry = setTimeout(() => void connect(), 2000 + Math.random() * 1000)
      }
      try {
        const { ticket } = await api<{ ticket: string }>(`/api/boards/${encodeURIComponent(board)}/live-ticket`, { method: 'POST', json: {} })
        if (current !== generation) return
        const url = new URL(`${API_BASE}/api/boards/${encodeURIComponent(board)}/live`, location.href)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(url); socket = ws
        ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket }))
        ws.onclose = failed; ws.onerror = () => ws.close()
        ws.onmessage = (message) => {
          if (current !== generation) return
          let event: RoomEvent | { type: 'ready'; sessionId: string }
          try { event = JSON.parse(message.data) } catch { return }
          if (event.type === 'ready') { setSelfSession(event.sessionId); setLiveState('live'); schedulePresence(); void syncNow() }
          if (event.type === 'changed') {
            const start = performance.now()
            void syncNow().then(() => {
              if (syncState() !== 'idle') return
              performance.clearMeasures('doggynote.live.convergence')
              performance.measure('doggynote.live.convergence', { start, end: performance.now() })
            })
          }
          if (event.type === 'members') { setMembers(event.members); updateAwareness(); if (following()) applyFollow() }
          if (event.type === 'ping') {
            setPings((all) => [...all.filter((p) => p.until > Date.now()).slice(-9), { ...event, until: Date.now() + 3000 }])
            setTimeout(() => setPings((all) => all.filter((p) => p.until > Date.now())), 3000)
          }
        }
      } catch { failed() }
    }
    const roomKey = createMemo(() => user() && canReadBoard(boardId()) && !doc.previewing() ? `${user()!.id}:${boardId()}` : '')
    createEffect(on(roomKey, (key) => { activeBoard = key ? boardId() : ''; void connect() }))
    createEffect(() => { camera(); viewport(); selection(); editingId(); schedulePresence() })
    const move = (e: PointerEvent) => {
      const canvas = (e.target as Element)?.closest?.('[data-testid="canvas"]')
      if (!canvas || e.pointerType === 'touch') { pointer = null; schedulePresence(); return }
      const r = canvas.getBoundingClientRect(), c = camera()
      pointer = { x: c.x + (e.clientX - r.left) / c.zoom, y: c.y + (e.clientY - r.top) / c.zoom }; schedulePresence()
    }
    const manual = (e: Event) => { const target = e.target as Element; if (target?.closest?.('[data-testid="canvas"]') && !target.closest('.follow-banner')) stopFollowing() }
    const key = (e: KeyboardEvent) => { if (following() && (e.key === 'Escape' || e.key.startsWith('Arrow'))) stopFollowing(); if (e.key === 'Escape') { previews.clear(); schedulePresence() } }
    const finishGesture = clearLivePreviews
    const visibility = () => { if (document.hidden) { disconnect(); setLiveState('offline') } else void connect() }
    const leave = () => { pointer = null; schedulePresence() }
    const transientOff = doc.onTransient((id, patch) => {
      const o = doc.base(id)
      if (o && o.kind === 'card' && o.boardId === activeBoard && ('x' in patch || 'y' in patch || 'w' in patch || 'h' in patch) && id !== editingId()) {
        previews.set(id, { id, x: o.x, y: o.y, w: o.w, h: o.h }); schedulePresence()
      }
    })
    const outOff = doc.onOutbox(() => {
      for (const p of doc.pendingOutbox()) if ('x' in p.patch || 'y' in p.patch || 'w' in p.patch || 'h' in p.patch) previews.delete(p.id)
      schedulePresence()
    })
    const heartbeat = setInterval(schedulePresence, 10_000)
    window.addEventListener('pointermove', move); window.addEventListener('pointerdown', manual, true); window.addEventListener('wheel', manual, true); window.addEventListener('keydown', key, true)
    window.addEventListener('pointerup', finishGesture); window.addEventListener('pointercancel', finishGesture)
    document.addEventListener('visibilitychange', visibility); window.addEventListener('online', visibility); window.addEventListener('offline', visibility); document.addEventListener('pointerleave', leave)
    onCleanup(() => {
      disconnect(); transientOff(); outOff(); clearInterval(heartbeat); if (sendTimer) clearTimeout(sendTimer); sendTimer = null
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', manual, true); window.removeEventListener('wheel', manual, true); window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerup', finishGesture); window.removeEventListener('pointercancel', finishGesture)
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', visibility); window.removeEventListener('offline', visibility); document.removeEventListener('pointerleave', leave)
    })
    return dispose
  })
}
