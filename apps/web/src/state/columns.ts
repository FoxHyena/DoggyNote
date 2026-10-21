import { createSignal } from 'solid-js'
import { isAlive, isColumnCollapsed, visibleEndpoint, type Card, type Id } from '@doggynote/core'
import * as doc from './doc.ts'
import { boardId, editingId, endEdit, select, selection, viewport } from './ui.ts'
import { animateCamera } from '../canvas/Canvas.tsx'
import { cardEl, rectOf } from '../canvas/layout.ts'

// View-only exploration is local to this session and never enters the outbox.
const [viewOverrides, setViewOverrides] = createSignal<ReadonlyMap<Id, boolean>>(new Map())
export function columnCollapsed(card: Card | undefined): boolean {
  return card?.type === 'column' && (viewOverrides().get(card.id) ?? isColumnCollapsed(card))
}

export function hiddenByColumn(id: Id): boolean {
  const c = doc.getCard(id)
  const col = c?.columnId ? doc.getCard(c.columnId) : undefined
  return !!col && col.boardId === c?.boardId && columnCollapsed(col)
}

export const connectionEndpoint = (id: Id) => visibleEndpoint(id, doc.getCard, columnCollapsed)

export function setColumnCollapsed(id: Id, collapsed: boolean, viewOnly = false) {
  const c = doc.getCard(id)
  if (!isAlive(c) || c?.type !== 'column') return
  if (editingId() === id || (editingId() && doc.getCard(editingId()!)?.columnId === id)) endEdit()
  if (viewOnly || !doc.canWriteObject(c)) {
    setViewOverrides((old) => new Map(old).set(id, collapsed))
  } else {
    setViewOverrides((old) => { const next = new Map(old); next.delete(id); return next })
    doc.update({ [id]: { collapsed } })
  }
  if (collapsed) {
    const kept = [...selection()].filter((sid) => doc.getCard(sid)?.columnId !== id)
    if (kept.length !== selection().size) select(new Set([...kept, id]))
  }
}

/** Search/label navigation: reveal the member, then centre its actual stacked rect. */
export function revealCard(id: Id) {
  const c = doc.getCard(id)
  if (!isAlive(c) || c?.boardId !== boardId()) return
  if (c.columnId && hiddenByColumn(id)) setColumnCollapsed(c.columnId, false)
  select([id])
  // The board camera effect and column DOM must settle first.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (boardId() !== c.boardId || !isAlive(doc.getCard(id))) return
    const r = rectOf(id)
    if (!r) return
    const v = viewport()
    // An off-screen card isn't mounted until the glide brings it into view, so
    // focus it again once the camera arrives (if it's still the selection).
    const focus = () => { if (selection().has(id)) cardEl(id)?.focus({ preventScroll: true }) }
    animateCamera({ x: r.x + r.w / 2 - v.width / 2, y: r.y + Math.min(r.h, v.height) / 2 - v.height / 2, zoom: 1 }, undefined, focus)
    focus()
  }))
}
