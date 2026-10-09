import { createSignal } from 'solid-js'
import type { Card, Id, Rect } from '@doggynote/core'
import * as doc from '../state/doc.ts'

// Measured card geometry. Cards report their rendered height through one shared
// ResizeObserver; connectors and culling read it from here. Heights also sync
// (debounced, not undoable) so other devices can cull before measuring.

const els = new Map<Id, HTMLElement>()
const elIds = new WeakMap<Element, Id>()
const measured = new Map<Id, number>()
export const [layoutTick, setLayoutTick] = createSignal(0)

let pendingHeights: Record<Id, { h: number }> = {}
let heightTimer: ReturnType<typeof setTimeout> | null = null
let measuring = true

/** Off while zoomed out: low-detail boxes must not overwrite real heights. */
export const setMeasuring = (on: boolean) => (measuring = on)

const ro = new ResizeObserver((entries) => {
  if (!measuring) return
  let changed = false
  for (const e of entries) {
    const id = elIds.get(e.target)
    if (!id) continue
    const el = e.target as HTMLElement
    const h = el.offsetHeight
    if (measured.get(id) !== h) {
      measured.set(id, h)
      changed = true
    }
    const card = doc.getCard(id)
    if (card && Math.abs((card.h ?? 0) - h) > 1) {
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
  doc.silent(p)
}

export function registerCardEl(id: Id, el: HTMLElement) {
  els.set(id, el)
  elIds.set(el, id)
  ro.observe(el)
  return () => {
    ro.unobserve(el)
    if (els.get(id) === el) els.delete(id)
  }
}

export const cardEl = (id: Id) => els.get(id)

export function cardHeight(c: Card): number {
  return measured.get(c.id) ?? c.h
}

/** World rect of a card, including cards stacked inside a column. */
export function rectOf(id: Id): Rect | null {
  const c = doc.getCard(id)
  if (!c || c.deletedAt || c.purged) return null
  if (c.columnId) {
    const col = doc.getCard(c.columnId)
    if (!col || col.deletedAt || col.purged) return null
    const colRect = { x: col.x, y: col.y, w: col.w, h: cardHeight(col) }
    const el = els.get(id)
    const colEl = els.get(col.id)
    if (!el || !colEl) return colRect
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
