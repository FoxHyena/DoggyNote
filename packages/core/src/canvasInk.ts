import type { Rect, Vec } from './geometry.ts'
import { isInkMark } from './ink.ts'
import type { Stroke } from './model.ts'

/** Deliberate limits for one gesture; documents can contain many separate marks. */
export const CANVAS_INK_MAX_SPAN = 8192
export const CANVAS_INK_MAX_POINTS = 4096
export const CANVAS_INK_WORLD_LIMIT = 1_000_000

/** A tight, nonzero owner envelope, including round caps and a small safety inset. */
export function canvasInkEnvelope(points: readonly Vec[], width: number): { rect: Rect; points: Vec[] } | null {
  if (!points.length || points.length > CANVAS_INK_MAX_POINTS || !Number.isFinite(width) || width <= 0 || width > 128) return null
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > CANVAS_INK_WORLD_LIMIT || Math.abs(p.y) > CANVAS_INK_WORLD_LIMIT) return null
    left = Math.min(left, p.x); right = Math.max(right, p.x)
    top = Math.min(top, p.y); bottom = Math.max(bottom, p.y)
  }
  if (right - left > CANVAS_INK_MAX_SPAN || bottom - top > CANVAS_INK_MAX_SPAN) return null
  const pad = width / 2 + 1
  const rect = { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 }
  if (Math.abs(rect.x) > CANVAS_INK_WORLD_LIMIT || Math.abs(rect.y) > CANVAS_INK_WORLD_LIMIT) return null
  return { rect, points: points.map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })) }
}

/** Width-only resizing preserves the original aspect ratio, including dots and vertical marks. */
export function isCanvasInkSize(logical: unknown): logical is { width: number; height: number } {
  if (!logical || typeof logical !== 'object') return false
  const { width, height } = logical as { width: unknown; height: unknown }
  return typeof width === 'number' && typeof height === 'number' && [width, height].every((n) => Number.isFinite(n) && n > 0 && n <= CANVAS_INK_MAX_SPAN + 130)
}

export function canvasInkHeight(logical: unknown, width: number): number {
  if (!isCanvasInkSize(logical) || !Number.isFinite(width) || width <= 0) return 1
  return width * logical.height / logical.width
}

/** Inverse of the SVG's uniform scaling; independent of camera and DOM. */
export function canvasInkLocal(point: Vec, rect: Rect, logicalWidth: number): Vec {
  const scale = logicalWidth / rect.w
  return { x: (point.x - rect.x) * scale, y: (point.y - rect.y) * scale }
}

/** Retain the owner's identity while keeping erased/foreign marks out of visual bounds. */
export function canvasInkHasContent(id: string, boardId: string, strokes: readonly Stroke[]): boolean {
  return strokes.some((s) => s.cardId === id && s.boardId === boardId && !s.deletedAt && !s.purged && isInkMark(s))
}
