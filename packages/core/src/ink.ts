import type { Rect } from './geometry.ts'

// Freehand ink, shared by sketch cards and drawing on the board. A mark's
// points are in its owner's logical space (a sketch's paper, or a board ink
// card's own box), so resizing the owner scales the drawing without touching
// the synced points.

export type InkPoint = { x: number; y: number }
export type InkTool = 'pen' | 'highlighter'
export type InkMark = {
  id: string
  tool: InkTool
  color: string
  width: number
  opacity: number
  points: InkPoint[]
  /** Paint order. Timestamps, so two people's strokes interleave by when they were drawn. */
  order: number
  bounds: Rect
}

/** Ink colours are document data, like swatch colours: they read the same in light and dark. */
export const INK_PALETTE = [
  { hex: '#292D35', name: 'Charcoal' },
  { hex: '#D7263D', name: 'Red' },
  { hex: '#245FE5', name: 'Blue' },
  { hex: '#21835B', name: 'Green' },
  { hex: '#F2C94C', name: 'Yellow' },
  { hex: '#FFFFFF', name: 'White' },
] as const
export const INK_WIDTHS = [
  { width: 3, name: 'Fine' },
  { width: 6, name: 'Medium' },
  { width: 12, name: 'Bold' },
] as const
/** A highlighter is a wide, see-through pen. */
export const HIGHLIGHTER = { scale: 3, opacity: 0.3 } as const
export const MAX_INK_POINTS = 4096
export const MAX_INK_COORD = 100_000

export function inkBounds(points: readonly InkPoint[], width: number): Rect {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const p of points) {
    left = Math.min(left, p.x); top = Math.min(top, p.y)
    right = Math.max(right, p.x); bottom = Math.max(bottom, p.y)
  }
  return { x: left - width / 2, y: top - width / 2, w: right - left + width, h: bottom - top + width }
}

/** A round-ended polyline. A tap repeats its point so SVG and canvas both draw a dot. */
export function inkPath(mark: Pick<InkMark, 'points'>): string {
  const points = mark.points
  if (!points.length) return ''
  return `M ${points[0].x} ${points[0].y} ` + (points.length === 1
    ? `L ${points[0].x + 0.001} ${points[0].y}`
    : points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' '))
}

/** Points are stored to a tenth of a unit: plenty for a pen, and a third of the bytes. */
export const roundInk = (n: number) => Math.round(n * 10) / 10

export function sortedInkStrokes<T extends InkMark>(strokes: readonly T[]): T[] {
  return [...strokes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

function distanceSquared(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2
}

const cross = (u: InkPoint, v: InkPoint, w: InkPoint) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x)

/** Does an eraser of `radius`, swept from `previous` to `point`, touch the mark? */
export function hitInkStroke(mark: InkMark, point: InkPoint, radius: number, previous = point): boolean {
  const r2 = (radius + mark.width / 2) ** 2
  const ps = mark.points
  for (let i = 0; i < ps.length; i++) {
    const a = ps[Math.max(0, i - 1)], b = ps[i]
    if (distanceSquared(point, a, b) <= r2 || distanceSquared(previous, a, b) <= r2 ||
      distanceSquared(a, previous, point) <= r2 || distanceSquared(b, previous, point) <= r2) return true
    // The eraser's path crosses this segment between two samples.
    if (cross(a, b, previous) * cross(a, b, point) < 0 && cross(previous, point, a) * cross(previous, point, b) < 0) return true
  }
  return false
}

const finite = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max

/** Synced geometry goes straight into SVG and canvas paths: reject anything malformed. */
export function isInkMark(value: unknown): value is InkMark {
  if (!value || typeof value !== 'object') return false
  const m = value as InkMark
  if (typeof m.id !== 'string' || (m.tool !== 'pen' && m.tool !== 'highlighter') ||
    typeof m.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(m.color) ||
    !finite(m.width, 0.1, 2000) || !finite(m.opacity, 0.05, 1) || !finite(m.order, 0, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(m.points) || !m.points.length || m.points.length > MAX_INK_POINTS ||
    !m.points.every((p) => !!p && finite(p.x, 0, MAX_INK_COORD) && finite(p.y, 0, MAX_INK_COORD))) return false
  const b = inkBounds(m.points, m.width)
  return !!m.bounds && (['x', 'y', 'w', 'h'] as const).every((k) => finite(m.bounds[k], -2000, MAX_INK_COORD + 2000) && Math.abs(m.bounds[k] - b[k]) < 0.01)
}
