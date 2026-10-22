import { worldToScreen, type Rect, type Vec } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { boardId, camera, viewport } from '../state/ui.ts'
import { layoutTick, rectOf } from '../canvas/layout.ts'

/** Visible card geometry, in canvas or window coordinates. A selected member's
 * column is a container, so its shelf doesn't count as neighbouring content. */
export function cardObstacles(selected: readonly string[], windowCoordinates = false): Rect[] {
  layoutTick()
  const parents = new Set(selected.map((id) => doc.getCard(id)?.columnId).filter(Boolean))
  const cam = camera(), v = viewport()
  return doc.cardsOn(boardId()).flatMap((c) => {
    if (parents.has(c.id)) return []
    const r = rectOf(c.id)
    if (!r) return []
    const p = worldToScreen(cam, r)
    const screen = { x: p.x, y: p.y, w: r.w * cam.zoom, h: r.h * cam.zoom }
    if (screen.x + screen.w < 0 || screen.y + screen.h < 0 || screen.x > v.width || screen.y > v.height) return []
    return [{ ...screen, x: screen.x + (windowCoordinates ? v.left : 0), y: screen.y + (windowCoordinates ? v.top : 0) }]
  })
}

/** Prefer the first clear position; slide around nearby edges on crowded boards.
 * When every position is occupied, use the smallest covered area. */
export function placeFloating(size: { width: number; height: number }, bounds: Rect, preferred: Vec[], obstacles: Rect[], gap = 8): Vec {
  const clamp = (p: Vec): Vec => ({ x: Math.max(bounds.x, Math.min(p.x, bounds.x + bounds.w - size.width)), y: Math.max(bounds.y, Math.min(p.y, bounds.y + bounds.h - size.height)) })
  const overlap = (p: Vec) => obstacles.reduce((area, r) => area + Math.max(0, Math.min(p.x + size.width + gap, r.x + r.w) - Math.max(p.x - gap, r.x)) * Math.max(0, Math.min(p.y + size.height + gap, r.y + r.h) - Math.max(p.y - gap, r.y)), 0)
  let best = clamp(preferred[0]), covered = Infinity
  const consider = (p: Vec) => {
    const at = clamp(p), area = overlap(at)
    if (area < covered) { best = at; covered = area }
    return area === 0
  }
  for (const p of preferred) if (consider(p)) return best
  const shifts = obstacles.flatMap((r) => preferred.flatMap((p) => [
    { x: r.x - size.width - gap, y: p.y }, { x: r.x + r.w + gap, y: p.y },
    { x: p.x, y: r.y - size.height - gap }, { x: p.x, y: r.y + r.h + gap },
  ]))
  const distance = (p: Vec) => Math.min(...preferred.map((a) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y)))
  shifts.sort((a, b) => distance(a) - distance(b))
  for (const p of shifts) if (consider(p)) break
  return best
}
