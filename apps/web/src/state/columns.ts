import { createSignal } from 'solid-js'
import { isAlive, isArea, isAreaItem, itemArea, areaFamily, areaVisibleEndpoint, type Card, type Id } from '@doggynote/core'
import * as doc from './doc.ts'
import { boardId, editingId, endEdit, select, selection, viewport } from './ui.ts'
import { animateCamera } from '../canvas/Canvas.tsx'
import { cardEl, rectOf } from '../canvas/layout.ts'

// View-only exploration is local to this session and never enters the outbox.
const [viewOverrides, setViewOverrides] = createSignal<ReadonlyMap<Id, boolean>>(new Map())
export function columnCollapsed(card: Card | undefined): boolean {
  return !!card && (card.type === 'column' || card.type === 'area') && (viewOverrides().get(card.id) ?? card.collapsed === true)
}

export function hiddenByColumn(id: Id): boolean {
  const item = doc.get(id)
  if (!isAreaItem(item)) return false
  const area = itemArea(item, doc.get)
  if (area && isAlive(area) && columnCollapsed(area)) return true
  const col = item.kind === 'card' && item.columnId ? doc.getCard(item.columnId) : undefined
  return !!col && col.boardId === item.boardId && columnCollapsed(col)
}

export const connectionEndpoint = (id: Id) => areaVisibleEndpoint(id, doc.get, columnCollapsed)

export function setColumnCollapsed(id: Id, collapsed: boolean, viewOnly = false) {
  const c = doc.getCard(id)
  if (!isAlive(c) || !c || (c.type !== 'column' && c.type !== 'area')) return
  const family = new Set(isArea(c) ? areaFamily(c, [...doc.cardsOn(c.boardId), ...doc.stickersOn(c.boardId)]).map(o => o.id) : doc.cardsOn(c.boardId).filter(o => o.columnId === id).map(o => o.id))
  if (editingId() === id || (editingId() && family.has(editingId()!))) endEdit()
  if (viewOnly || !doc.canWriteObject(c)) {
    setViewOverrides((old) => new Map(old).set(id, collapsed))
  } else {
    setViewOverrides((old) => { const next = new Map(old); next.delete(id); return next })
    doc.update({ [id]: { collapsed } })
  }
  if (collapsed) {
    const kept = [...selection()].filter(sid => !family.has(sid))
    if (kept.length !== selection().size) select(new Set([...kept, id]))
  }
}

/** Search/label navigation: reveal the member, then centre its actual stacked rect. */
export function revealCard(id: Id) {
  const c = doc.getCard(id)
  if (!isAlive(c) || c?.boardId !== boardId()) return
  const area = itemArea(c, doc.get)
  if (area && isAlive(area) && columnCollapsed(area)) setColumnCollapsed(area.id, false)
  if (c.columnId && columnCollapsed(doc.getCard(c.columnId))) setColumnCollapsed(c.columnId, false)
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
