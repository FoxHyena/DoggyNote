import { batch, createSignal } from 'solid-js'
import { HOME_BOARD_ID, type Camera, type Id, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'

// UI state shared between the canvas, toolbars and keyboard shortcuts.

export const [selection, setSelection] = createSignal<ReadonlySet<Id>>(new Set())
export const [editingId, setEditingId] = createSignal<Id | null>(null)
/** Focus is presentation of the same note, never a second document. */
export const [focusedNoteId, setFocusedNoteId] = createSignal<Id | null>(null)
let editSession = 0
export const currentEditSession = () => editSession
export function focusNote(id: Id) {
  const card = doc.getCard(id)
  if (card?.type !== 'note' || card.deletedAt || card.purged) return
  batch(() => {
    if (doc.canEditNoteBody(card)) beginEdit(id)
    else endEdit()
    setFocusedNoteId(id)
  })
}
export const [camera, setCamera] = createSignal<Camera>({ x: -200, y: -150, zoom: 1 })
export const [viewport, setViewport] = createSignal({ width: 1, height: 1, left: 0, top: 0 })
/** Line tool: next two card clicks create a connection. */
export const [connectMode, setConnectMode] = createSignal<{ from: Id | null } | null>(null)
/** Mouse: the one connector handle the pointer is near, as `cardId:side` ('' for none). */
export const [nearHandle, setNearHandle] = createSignal('')
export const [trashOpen, setTrashOpen] = createSignal(false)
export const [paletteOpen, setPaletteOpen] = createSignal(false)

/** Touch: taps add cards to the selection (or take them out) instead of replacing it. */
export const [selectMore, setSelectMore] = createSignal(false)

export const isSelected = (id: Id) => selection().has(id)
export const select = (ids: Iterable<Id>) => setSelection(new Set(ids))
export const clearSelection = () => {
  setSelection(new Set<Id>())
  setSelectMore(false)
}

// ---- edit sessions ----------------------------------------------------------
// Editing a card applies keystrokes transiently; leaving edit mode commits the
// whole edit as one undo step.

let editSnapshot: Record<Id, Partial<Obj>> | null = null
let editIsNew = false
const endEditHooks = new Set<(id: Id) => void>()
let checkpointTimer: ReturnType<typeof setInterval> | null = null
let checkpointSnapshot: Record<Id, Partial<Obj>> = {}

export function checkpointEdit() {
  if (!editSnapshot) return
  for (const [id, initial] of Object.entries(editSnapshot)) {
    const current = doc.snapshot(id, Object.keys(initial))
    const previous = checkpointSnapshot[id] as Record<string, unknown> | undefined
    const changed = Object.fromEntries(Object.entries(current).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(previous?.[key])))
    if (!Object.keys(changed).length) continue
    checkpointSnapshot[id] = current
    doc.checkpoint(id, changed as Partial<Obj>)
  }
}

// Queue text with the same local transaction as incidental height changes.
// Waiting for the periodic checkpoint could otherwise persist new text with
// only a height patch, letting the next server pull restore the old text.
doc.onTransient((id, patch) => {
  if (editSnapshot?.[id] && Object.keys(patch).some((key) => key in editSnapshot![id])) checkpointEdit()
})

export function beginEdit(id: Id, opts: { isNew?: boolean } = {}) {
  if (!doc.canWriteObject(doc.get(id))) return
  const note = doc.getCard(id)
  if (note?.type === 'note' && !doc.canEditNoteBody(note)) {
    endEdit()
    select([id])
    return
  }
  if (editingId() === id) return
  endEdit()
  editSession++
  const fields = doc.getCard(id)?.type === 'image' ? ['imageCaption', 'imageSourceUrl'] : doc.getCard(id)?.type === 'swatch' ? ['swatchHex', 'swatchName', 'swatchCaption', 'swatchHexDraft'] : ['content']
  editSnapshot = Object.fromEntries((note?.type === 'note' ? doc.noteBodyMembers(note) : [{ id }]).map((member) => [member.id, doc.snapshot(member.id, fields)]))
  doc.markBusy(Object.keys(editSnapshot))
  // A board card's title lives on the board object.
  const card = doc.getCard(id)
  if (card?.type === 'board') {
    const bid = (card.content as { boardId: Id }).boardId
    if (!doc.canWriteObject(doc.getBoard(bid))) { editSnapshot = null; doc.unmarkBusy([id]); return }
    editSnapshot[bid] = doc.snapshot(bid, ['title'])
    doc.markBusy([bid])
  }
  editIsNew = !!opts.isNew
  checkpointSnapshot = structuredClone(editSnapshot)
  checkpointTimer = setInterval(checkpointEdit, 500)
  setEditingId(id)
  select([id])
}

/** Hook for cards that need to decide what "empty" means (purge brand-new empty notes). */
export function onEndEdit(fn: (id: Id) => void) {
  endEditHooks.add(fn)
  return () => endEditHooks.delete(fn)
}

export function endEdit() {
  const id = editingId()
  if (!id) return
  if (checkpointTimer) clearInterval(checkpointTimer)
  checkpointTimer = null
  checkpointSnapshot = {}
  batch(() => { setFocusedNoteId(null); setEditingId(null) })
  for (const h of endEditHooks) h(id)
  const card = doc.get(id)
  if (editSnapshot && card && !card.purged) {
    // A brand-new card's typing folds into its creation step, so one undo
    // removes the card and redo brings it back with its text.
    if (editIsNew) for (const [oid, snap] of Object.entries(editSnapshot)) doc.amendOrCommit(oid, snap)
    else doc.commitFrom(editSnapshot)
  }
  doc.unmarkBusy(Object.keys(editSnapshot ?? { [id]: 1 }))
  editSnapshot = null
  editIsNew = false
}

export const editIsNewCard = () => editIsNew

/** Permission was removed; the caller preserves unsynced text before cancelling. */
export function cancelEdit() {
  if (checkpointTimer) clearInterval(checkpointTimer)
  checkpointTimer = null
  const ids = Object.keys(editSnapshot ?? {})
  batch(() => { setFocusedNoteId(null); setEditingId(null) })
  editSnapshot = null
  checkpointSnapshot = {}
  editIsNew = false
  doc.unmarkBusy(ids)
  clearSelection()
}

// ---- routing ---------------------------------------------------------------
// App: #/b/<boardId>. Share viewer: /s/<token>#/b/<boardId>.

const LAST_BOARD_KEY = 'doggynote.lastBoard'
const isViewer = () => location.pathname.startsWith('/s/')

function boardFromHash(): Id {
  const m = location.hash.match(/^#\/b\/([^/?#]+)/)
  if (m) return decodeURIComponent(m[1])
  // The editor reopens where you left off; a share link always starts at its root.
  if (!isViewer()) {
    try {
      const last = localStorage.getItem(LAST_BOARD_KEY)
      if (last) return last
    } catch {
      // storage unavailable
    }
  }
  return HOME_BOARD_ID
}

const RECENT_KEY = 'doggynote.recentBoards'
function readRecent(): Id[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((x): x is Id => typeof x === 'string') : []
  } catch {
    return []
  }
}
/** Boards opened on this device, most recent first. */
export const [recentBoards, setRecentBoards] = createSignal<Id[]>(readRecent())

function rememberBoard(id: Id) {
  if (isViewer()) return
  const recent = [id, ...recentBoards().filter((x) => x !== id)].slice(0, 8)
  setRecentBoards(recent)
  try {
    localStorage.setItem(LAST_BOARD_KEY, id)
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    // storage unavailable
  }
}

export const [boardId, setBoardIdSignal] = createSignal<Id>(boardFromHash())
if (location.hash.match(/^#\/b\//)) rememberBoard(boardId())

export function openBoard(id: Id) {
  // A proposal preview keeps you on its boards until you leave it.
  if (doc.previewing()) return
  setFocusedNoteId(null)
  endEdit()
  clearSelection()
  // Switch now; hashchange fires later and would let a fast click land on the old board.
  setBoardIdSignal(id)
  rememberBoard(id)
  location.hash = `#/b/${encodeURIComponent(id)}`
}

window.addEventListener('hashchange', () => {
  const id = boardFromHash()
  if (id === boardId()) return
  setFocusedNoteId(null)
  endEdit()
  clearSelection()
  setBoardIdSignal(id)
  rememberBoard(id)
})

/** Let the share viewer pick a root other than home. */
export function setRootBoard(id: Id) {
  if (!location.hash) setBoardIdSignal(id)
}

// ---- camera persistence (per board, per device) ----------------------------

const camKey = (id: Id) => `doggynote.cam.${id}`

export function loadCamera(id: Id): Camera | null {
  try {
    const raw = localStorage.getItem(camKey(id))
    if (!raw) return null
    const c = JSON.parse(raw) as Camera
    return Number.isFinite(c.x) && Number.isFinite(c.y) && c.zoom > 0 ? c : null
  } catch {
    return null
  }
}

let camTimer: ReturnType<typeof setTimeout> | null = null
export function saveCamera(id: Id, c: Camera) {
  if (camTimer) clearTimeout(camTimer)
  camTimer = setTimeout(() => {
    try {
      localStorage.setItem(camKey(id), JSON.stringify(c))
    } catch {
      // storage unavailable; camera just won't be remembered
    }
  }, 250)
}
