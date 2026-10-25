// Getting around the board without a mouse. Tab lands on the board and goes to the
// selected card (or the first one); Option/Alt + arrows go to the nearest card that way.
// Plain arrows still nudge the selection (ui/shortcuts.ts).

import { LOD_ZOOM, isAlive, nearestInDirection, readingOrder, viewRect, type Direction, type Id, type Placed, type Rect } from '@doggynote/core'
import * as doc from './doc.ts'
import { hiddenByColumn } from './columns.ts'
import { boardId, camera, select, selection, viewport } from './ui.ts'
import { animateCamera } from '../canvas/Canvas.tsx'
import { cardEl, rectOf } from '../canvas/layout.ts'

function placedCards(): Placed<Id>[] {
  const out: Placed<Id>[] = []
  for (const c of doc.cardsOn(boardId())) {
    if (!isAlive(c) || hiddenByColumn(c.id)) continue
    const rect = rectOf(c.id)
    if (rect) out.push({ id: c.id, rect })
  }
  return out
}

const inside = (r: Rect, v: Rect) => r.x >= v.x && r.y >= v.y && r.x + r.w <= v.x + v.w && r.y + r.h <= v.y + v.h

/** Select a card and focus it, gliding it into view first if it's off screen. */
export function goToCard(id: Id) {
  select([id])
  const r = rectOf(id)
  if (!r) return
  const cam = camera()
  const v = viewport()
  const focus = () => { if (selection().has(id)) cardEl(id)?.focus({ preventScroll: true }) }
  // Below the low-detail zoom cards aren't DOM, so there'd be nothing to focus.
  if (cam.zoom >= LOD_ZOOM && inside(r, viewRect(cam, v.width, v.height))) return focus()
  const zoom = cam.zoom >= LOD_ZOOM ? cam.zoom : 1
  const x = r.x + r.w / 2 - v.width / 2 / zoom
  const y = r.y + Math.min(r.h, v.height / zoom) / 2 - v.height / 2 / zoom
  // An off-screen card mounts as the camera arrives: focus it then.
  animateCamera({ x, y, zoom }, undefined, focus)
  focus()
}

/** Option/Alt + arrow: the nearest card that way. With nothing selected, the first card. */
export function moveToCard(dir: Direction) {
  const cards = placedCards()
  const from = [...selection()].find((id) => doc.getCard(id))
  const r = from ? rectOf(from) : null
  if (!from || !r) {
    const first = readingOrder(cards)[0]
    if (first) goToCard(first)
    return
  }
  // A column and its own cards overlap: step out of (or into) it with the other keys.
  const parent = doc.getCard(from)?.columnId
  const next = nearestInDirection(r, cards.filter((c) => c.id !== from && c.id !== parent && doc.getCard(c.id)?.columnId !== from), dir)
  if (next) goToCard(next)
}

/** Tab has just arrived on the board: carry on from the selection, or start at the first card. */
export function enterBoard() {
  const target = [...selection()].find((id) => doc.getCard(id)) ?? readingOrder(placedCards())[0]
  if (target) goToCard(target)
}
