export type Vec = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function contains(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** Normalised rect from two corner points (either drag direction). */
export function rectFromPoints(a: Vec, b: Vec): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function center(r: Rect): Vec {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Where the ray from the centre of `r` towards `toward` leaves `r`, pushed out
 * by `gap`. Connectors start and end here so arrows touch card edges.
 */
export function edgePoint(r: Rect, toward: Vec, gap = 0): Vec {
  const c = center(r)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = r.w / 2 + gap
  const hh = r.h / 2 + gap
  const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

/** Distance from point `p` to segment `a`–`b`. Used to hit-test connectors. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Nearest position to `want` (searching outward in rings of `step`) where a
 * w×h rect overlaps none of `taken` (with `gap` between). New cards land here
 * instead of on top of each other.
 */
export function findFreeSpot(want: Rect, taken: Rect[], step = 40, gap = 16, maxRings = 30): Vec {
  const clear = (x: number, y: number) =>
    !taken.some((t) => intersects({ x: x - gap, y: y - gap, w: want.w + gap * 2, h: want.h + gap * 2 }, t))
  if (clear(want.x, want.y)) return { x: want.x, y: want.y }
  for (let ring = 1; ring <= maxRings; ring++) {
    let best: Vec | null = null
    let bestD = Infinity
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ]) {
        const x = want.x + dx * step
        const y = want.y + dy * step
        const d = dx * dx + dy * dy
        if (d < bestD && clear(x, y)) {
          best = { x, y }
          bestD = d
        }
      }
    }
    if (best) return best
  }
  return { x: want.x, y: want.y }
}
