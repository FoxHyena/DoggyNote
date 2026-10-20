import { createSignal } from 'solid-js'
import { LOD_ZOOM, fitCamera, union, type Camera, type Id, type Obj, type Rect } from '@doggynote/core'
import type { AgentChange, AgentObject } from '@doggynote/core/agent'
import * as doc from './doc.ts'
import { api } from './api.ts'
import { syncNow } from './sync.ts'
import { boardId, camera, clearSelection, endEdit, setBoardIdSignal, setCamera, viewport } from './ui.ts'
import { showToast } from './toast.ts'
import { rectOf } from '../canvas/layout.ts'
import { animateCamera } from '../canvas/Canvas.tsx'

// Previewing an agent proposal on the real board. The proposal's objects go in
// front of the store (doc.setPreviewObjects), so the canvas draws them with the
// real card components; the board is read-only meanwhile and nothing is saved.
// A badge marks each card the proposal adds, edits, moves or buries.

export type Badge = 'added' | 'changed' | 'moved' | 'removed'
export type ProposalDetail = { proposal: { id: string; label: string; status: string; changes: AgentChange[] }; before: AgentObject[]; after: AgentObject[] }

type Preview = {
  id: string
  label: string
  status: string
  mode: 'after' | 'before'
  /** Boards the proposal touches, in order; the canvas shows one at a time. */
  boards: Id[]
  badges: Map<Id, Badge>
  counts: Record<Badge, number>
  /** Something it changes was edited since the agent read it. */
  stale: boolean
  after: Record<Id, Obj>
  /** New boards only: what "Current" shows (the board, but none of its cards). */
  beforeObjs: Record<Id, Obj>
  returnTo: { board: Id; camera: Camera }
}

const [preview, setPreview] = createSignal<Preview | null>(null)
export { preview }
const [decisionTick, setDecisionTick] = createSignal(0)
/** Bumps when a proposal is approved or rejected from the preview (the list refreshes). */
export const proposalsChanged = decisionTick

export const previewBadge = (id: Id): Badge | undefined => preview()?.badges.get(id)
export const isPreviewBoard = (id: Id) => !!preview()?.boards.includes(id)

const MOVE_KEYS = new Set(['x', 'y', 'columnId', 'order', 'boardId'])
const IGNORED = new Set(['h'])

function badgeFor(change: AgentChange): Badge | null {
  const after = change.after as Obj
  if (after.deletedAt || after.purged) return 'removed'
  if (!change.before) return 'added'
  const before = change.before as Record<string, unknown>
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed = [...keys].filter((k) => !IGNORED.has(k) && JSON.stringify(before[k] ?? null) !== JSON.stringify((after as unknown as Record<string, unknown>)[k] ?? null))
  if (!changed.length) return null
  return changed.every((k) => MOVE_KEYS.has(k)) ? 'moved' : 'changed'
}

const same = (a: unknown, b: unknown) => {
  // Top-level keys sorted (a key list given to JSON.stringify would filter nested keys too).
  const strip = (o: unknown) => { const c = { ...(o as Record<string, unknown>) }; delete c.h; return JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]])) }
  return strip(a) === strip(b)
}

/** Fetch a proposal and show it on the board. */
export async function openPreview(id: string) {
  const detail = await api<ProposalDetail>(`/api/agent-proposals/${id}`)
  enterPreview(detail)
}

export function enterPreview(detail: ProposalDetail) {
  endEdit()
  clearSelection()
  const { proposal } = detail
  const after: Record<Id, Obj> = {}
  const beforeObjs: Record<Id, Obj> = {}
  const badges = new Map<Id, Badge>()
  const counts: Record<Badge, number> = { added: 0, changed: 0, moved: 0, removed: 0 }
  const boards: Id[] = []
  let stale = false
  for (const change of proposal.changes) {
    const next = change.after as Obj
    const live = doc.base(change.id)
    if (change.before && live && !same(live, change.before)) stale = true
    const badge = badgeFor(change)
    // A buried card stays in view, marked, so you can see what goes.
    if (badge === 'removed') after[change.id] = { ...((live ?? change.before ?? next) as Obj), deletedAt: null, purged: false }
    else after[change.id] = next
    if (next.kind === 'board' && !change.before) beforeObjs[change.id] = next
    if (badge && next.kind === 'card') {
      badges.set(change.id, badge)
      counts[badge]++
    }
    const board = next.kind === 'card' || next.kind === 'connection' ? next.boardId : null
    if (board && !boards.includes(board)) boards.push(board)
  }
  if (!boards.length) boards.push(boardId())
  // Start where you are, if the proposal touches this board.
  const current = boardId()
  if (boards.includes(current)) boards.unshift(...boards.splice(boards.indexOf(current), 1))
  setPreview({ id: proposal.id, label: proposal.label, status: proposal.status, mode: 'after', boards, badges, counts, stale, after, beforeObjs, returnTo: { board: current, camera: camera() } })
  doc.setPreviewObjects(after)
  showBoard(boards[0])
}

/** Proposed or Current. */
export function setPreviewMode(mode: 'after' | 'before') {
  const p = preview()
  if (!p || p.mode === mode) return
  setPreview({ ...p, mode })
  doc.setPreviewObjects(mode === 'after' ? p.after : p.beforeObjs)
}

export function showBoard(id: Id) {
  if (id !== boardId()) setBoardIdSignal(id)
  // Once the cards have mounted and measured, frame the changes.
  requestAnimationFrame(() => requestAnimationFrame(() => frameChanges()))
}

let nextIndex = 0
/** Frame every change on this board, or (step) the next one in turn. */
export function frameChanges(step = false) {
  const p = preview()
  if (!p) return
  const ids = [...p.badges.keys()].filter((id) => doc.getCard(id)?.boardId === boardId() && rectOf(id))
  if (!ids.length) return
  const v = viewport()
  // Leave room for the banner.
  const fit = (box: Rect) => fitCamera({ x: box.x, y: box.y - 40, w: box.w, h: box.h + 40 }, v.width, v.height, step ? 160 : 80)
  let to = fit(union(step ? [rectOf(ids[nextIndex++ % ids.length])!] : ids.map((id) => rectOf(id)!))!)
  // Too spread out to show them all as real cards (a small screen): start with the
  // first one, and Next change steps through the rest.
  if (to.zoom < MIN_ZOOM) {
    if (!step) nextIndex = 1
    const one = fit(rectOf(ids[step ? (nextIndex - 1) % ids.length : 0])!)
    to = one.zoom >= MIN_ZOOM ? one : zoomAround(one, MIN_ZOOM, v.width, v.height)
  }
  animateCamera(to, 320)
}

/** Below this the canvas draws cards as thumbnails, without their change badges. */
const MIN_ZOOM = LOD_ZOOM + 0.15

const zoomAround = (c: Camera, zoom: number, w: number, h: number): Camera => {
  const cx = c.x + w / 2 / c.zoom
  const cy = c.y + h / 2 / c.zoom
  return { zoom, x: cx - w / 2 / zoom, y: cy - h / 2 / zoom }
}

export function exitPreview() {
  const p = preview()
  if (!p) return
  doc.setPreviewObjects(null)
  setPreview(null)
  nextIndex = 0
  if (boardId() !== p.returnTo.board) setBoardIdSignal(p.returnTo.board)
  setCamera(p.returnTo.camera)
}

/** Approve or reject from the preview. Approving lands the changes on the live board. */
export async function decidePreview(action: 'approve' | 'reject'): Promise<string | null> {
  const p = preview()
  if (!p) return null
  try {
    if (action === 'approve') {
      await syncNow()
      if (doc.outboxSize()) throw new Error('Your local edits are still waiting to sync. Reconnect and try again.')
    }
    await api(`/api/agent-proposals/${p.id}/${action}`, { method: 'POST', json: {} })
    exitPreview()
    if (action === 'approve') {
      await syncNow()
      showToast(`Approved “${p.label}”. The changes are on the board.`, 4000)
    } else showToast(`Rejected “${p.label}”.`, 3000)
    setDecisionTick((n) => n + 1)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not update this proposal'
  }
}
