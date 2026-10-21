import { createSignal } from 'solid-js'
import { canvasInkHeight, COLUMN_HEADER, columnMembers, isKnownCardType, type Card, type Id, type Rect } from '@doggynote/core'
import { columnCollapsed } from '../state/columns.ts'
import * as doc from '../state/doc.ts'

// Measured card geometry. Cards report their rendered height through one shared
// ResizeObserver; connectors and culling read it from here. Heights also sync
// (debounced, not undoable) so other devices can cull before measuring.

const els = new Map<Id, HTMLElement>()
const elIds = new WeakMap<Element, Id>()
const measured = new Map<Id, number>()
const measuredWidths = new Map<Id, number>()
export const [layoutTick, setLayoutTick] = createSignal(0)
let layoutQueued = false
function invalidateMountedLayout() {
  if (layoutQueued) return
  layoutQueued = true
  queueMicrotask(() => { layoutQueued = false; setLayoutTick((n) => n + 1) })
}

let pendingHeights: Record<Id, { h: number }> = {}
let heightTimer: ReturnType<typeof setTimeout> | null = null
let measuring = true
let persistingHeights = true

/** Off while zoomed out: low-detail boxes must not overwrite real heights. */
export const setMeasuring = (on: boolean) => (measuring = on)
/** Export-only expanded captions affect raster bounds, never synced card geometry. */
export const setPersistingHeights = (on: boolean) => (persistingHeights = on)

const ro = new ResizeObserver((entries) => {
  if (!measuring) return
  let changed = false
  for (const e of entries) {
    const id = elIds.get(e.target)
    if (!id) continue
    const el = e.target as HTMLElement
    const card = doc.getCard(id)
    // A collapsed header must never replace the retained expanded height.
    if (card && columnCollapsed(card)) { delete pendingHeights[id]; continue }
    const h = el.offsetHeight
    // Hidden/detached cards have no rendered height. Keep their last geometry
    // until visible again rather than syncing a loading boundary's zero size.
    if (h === 0) continue
    const w = el.offsetWidth
    if (measured.get(id) !== h || measuredWidths.get(id) !== w) {
      measuredWidths.set(id, w)
      measured.set(id, h)
      changed = true
    }
    // Reading a full caption is local presentation; keep shared off-screen
    // geometry at its compact height while still measuring visible bounds.
    const expandedCaption = (card?.type === 'image' || card?.type === 'column') && !!el.querySelector('.image-metadata[data-expanded="true"]')
    if (persistingHeights && !expandedCaption && card && card.type !== 'ink' && isKnownCardType(card.type) && Math.abs((card.h ?? 0) - h) > 1) {
      pendingHeights[id] = { h }
      heightTimer ??= setTimeout(flushHeights, 400)
    }
  }
  if (changed) setLayoutTick((n) => n + 1)
})

function flushHeights() {
  heightTimer = null
  const p = pendingHeights
  pendingHeights = {}
  for (const id of Object.keys(p)) if (columnCollapsed(doc.getCard(id))) delete p[id]
  doc.silent(p)
}

export function registerCardEl(id: Id, el: HTMLElement) {
  els.set(id, el)
  elIds.set(el, id)
  ro.observe(el)
  // A remounted child may have exactly its old height. Still replace the
  // fallback stacked geometry with its actual DOM offsets for connectors.
  invalidateMountedLayout()
  return () => {
    ro.unobserve(el)
    if (els.get(id) === el) els.delete(id)
    invalidateMountedLayout()
  }
}

export const cardEl = (id: Id) => els.get(id)

export function cardHeight(c: Card): number {
  if (columnCollapsed(c)) return COLUMN_HEADER
  // On expansion a cached header measurement is never used.
  if (c.type === 'ink') return canvasInkHeight((c as Card<'ink'>).content, c.w)
  return measured.get(c.id) ?? c.h
}

/** World rect of a card, including cards stacked inside a column. */
export function rectOf(id: Id): Rect | null {
  const c = doc.getCard(id)
  if (!c || c.deletedAt || c.purged) return null
  if (c.columnId) {
    const col = doc.getCard(c.columnId)
    if (!col || col.deletedAt || col.purged || columnCollapsed(col)) return null
    const colRect = { x: col.x, y: col.y, w: col.w, h: cardHeight(col) }
    const el = els.get(id)
    const colEl = els.get(col.id)
    // Zoomed out, children aren't DOM: use the same stacking the overview draws.
    if (!el || !colEl) return stackedChildRect(col, id) ?? colRect
    // offsetTop/Left are relative to the column (it's the offsetParent) and unscaled.
    let x = 0
    let y = 0
    let n: HTMLElement | null = el
    while (n && n !== colEl) {
      x += n.offsetLeft
      y += n.offsetTop
      n = n.offsetParent as HTMLElement | null
    }
    return { x: col.x + x, y: col.y + y, w: el.offsetWidth, h: el.offsetHeight }
  }
  return { x: c.x, y: c.y, w: c.w, h: cardHeight(c) }
}

/** Column layout as drawn zoomed out: a header strip, then children stacked with an 8px inset and gap. */
export { COLUMN_HEADER }
export const COLUMN_INSET = 8

export function stackedChildRect(col: Card, id: Id): Rect | null {
  if (columnCollapsed(col)) return null
  const kids = columnMembers(col, doc.cardsOn(col.boardId))
  let y = col.y + COLUMN_HEADER + COLUMN_INSET - 1
  for (const k of kids) {
    const h = cardHeight(k)
    if (k.id === id) return { x: col.x + COLUMN_INSET + 1, y, w: col.w - (COLUMN_INSET + 1) * 2, h }
    y += h + COLUMN_INSET
  }
  return null
}
