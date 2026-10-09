import { createSignal } from 'solid-js'
import { HOME_BOARD_ID, type Camera, type Id, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'

// UI state shared between the canvas, toolbars and keyboard shortcuts.

export const [selection, setSelection] = createSignal<ReadonlySet<Id>>(new Set())
export const [editingId, setEditingId] = createSignal<Id | null>(null)
export const [camera, setCamera] = createSignal<Camera>({ x: -200, y: -150, zoom: 1 })
export const [viewport, setViewport] = createSignal({ width: 1, height: 1, left: 0, top: 0 })
/** Line tool: next two card clicks create a connection. */
export const [connectMode, setConnectMode] = createSignal<{ from: Id | null } | null>(null)
export const [trashOpen, setTrashOpen] = createSignal(false)
export const [paletteOpen, setPaletteOpen] = createSignal(false)

export const isSelected = (id: Id) => selection().has(id)
export const select = (ids: Iterable<Id>) => setSelection(new Set(ids))
export const clearSelection = () => setSelection(new Set<Id>())

// ---- edit sessions ----------------------------------------------------------
// Editing a card applies keystrokes transiently; leaving edit mode commits the
// whole edit as one undo step.

let editSnapshot: Record<Id, Partial<Obj>> | null = null
let editIsNew = false
const endEditHooks = new Set<(id: Id) => void>()

export function beginEdit(id: Id, opts: { isNew?: boolean } = {}) {
  if (doc.isReadOnly()) return
  if (editingId() === id) return
  endEdit()
  editSnapshot = { [id]: doc.snapshot(id, ['content']) }
  doc.markBusy([id])
  // A board card's title lives on the board object.
  const card = doc.getCard(id)
  if (card?.type === 'board') {
    const bid = (card.content as { boardId: Id }).boardId
    editSnapshot[bid] = doc.snapshot(bid, ['title'])
    doc.markBusy([bid])
  }
  editIsNew = !!opts.isNew
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
  setEditingId(null)
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

function rememberBoard(id: Id) {
  if (isViewer()) return
  try {
    localStorage.setItem(LAST_BOARD_KEY, id)
  } catch {
    // storage unavailable
  }
}

export const [boardId, setBoardIdSignal] = createSignal<Id>(boardFromHash())

export function openBoard(id: Id) {
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
