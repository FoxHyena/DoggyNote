import type { Card, CardContent } from './model.ts'
import type { Rect, Vec } from './geometry.ts'
import { normalizeSwatchHex } from './swatch.ts'

// Sketch cards and ink drawn straight on the board. Both own their strokes as
// separate `stroke` objects (model.ts), so two people drawing at once, or one
// drawing while another renames the sketch, never overwrite each other.

/** A sketch's paper is a fixed logical page; the card scales it to fit. */
export const SKETCH_WIDTH = 800
export const SKETCH_HEIGHT = 600
export const DEFAULT_SKETCH_PAPER = '#FFFFFF'

/**
 * Ready-made paper colours. Like ink and swatch colours these are document
 * data, not theme colours: a sketch looks the same in light and dark. The
 * editor also offers a custom colour.
 */
export const SKETCH_PAPERS = [
  { hex: '#FFFFFF', name: 'White' },
  { hex: '#EDEDEA', name: 'Light grey' },
  { hex: '#FBF3DF', name: 'Cream' },
  { hex: '#E3EEF9', name: 'Pale blue' },
  { hex: '#2B2E34', name: 'Charcoal' },
] as const

/** The paper colour to paint. Synced data: never hand an unchecked string to CSS or a canvas. */
export function sketchPaperColor(value: unknown): string {
  return normalizeSwatchHex(value) ?? DEFAULT_SKETCH_PAPER
}

/** Is `value` a stored paper colour (canonical `#RRGGBB`)? */
export const isSketchPaper = (value: unknown): value is string => typeof value === 'string' && normalizeSwatchHex(value) === value

export const DEFAULT_SKETCH: CardContent['sketch'] = { title: '', width: SKETCH_WIDTH, height: SKETCH_HEIGHT, background: DEFAULT_SKETCH_PAPER }

const dimension = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : fallback)

/** A sketch's content, made safe to draw whatever another device sent. */
export function sketchContent(value: unknown): CardContent['sketch'] {
  const c = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    title: typeof c.title === 'string' ? c.title.slice(0, 1000) : '',
    width: dimension(c.width, SKETCH_WIDTH),
    height: dimension(c.height, SKETCH_HEIGHT),
    background: sketchPaperColor(c.background),
  }
}

/**
 * Everything a sketch shows: its paper size from `content`, and its title and
 * paper colour from their own fields (`sketchTitle`, `sketchPaper`), falling
 * back to the older `content.title`/`content.background` when those are missing.
 */
export function sketchOf(card: Pick<Card, 'content' | 'sketchTitle' | 'sketchPaper'>): CardContent['sketch'] {
  const c = sketchContent(card.content)
  return {
    ...c,
    title: typeof card.sketchTitle === 'string' ? card.sketchTitle.slice(0, 1000) : c.title,
    background: isSketchPaper(card.sketchPaper) ? card.sketchPaper : c.background,
  }
}

/** What the server and agents accept as a sketch's title field. */
export const isSketchTitle = (value: unknown): value is string => typeof value === 'string' && value.length <= 1000

/** What the server and agents accept as a sketch's content. */
export function isSketchContent(value: unknown): value is CardContent['sketch'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const c = value as Record<string, unknown>
  return Object.keys(c).every((k) => ['title', 'width', 'height', 'background'].includes(k)) &&
    typeof c.title === 'string' && c.title.length <= 1000 &&
    dimension(c.width, NaN) === c.width && dimension(c.height, NaN) === c.height && isSketchPaper(c.background)
}

// ---- ink on the board ------------------------------------------------------------
// Each mark drawn on the board is a small `ink` card wrapped tightly around it,
// so it can be selected, moved, resized and buried like any card.

/** Limits for one mark; a board can hold as many marks as it likes. */
export const BOARD_INK_MAX_SPAN = 8192
const WORLD_LIMIT = 1_000_000

/** The card box around a mark drawn at world `points`, and the points in that box. Null if it's out of bounds. */
export function boardInkEnvelope(points: readonly Vec[], width: number): { rect: Rect; points: Vec[] } | null {
  if (!points.length || !Number.isFinite(width) || width <= 0 || width > 128) return null
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > WORLD_LIMIT || Math.abs(p.y) > WORLD_LIMIT) return null
    left = Math.min(left, p.x); right = Math.max(right, p.x)
    top = Math.min(top, p.y); bottom = Math.max(bottom, p.y)
  }
  if (right - left > BOARD_INK_MAX_SPAN || bottom - top > BOARD_INK_MAX_SPAN) return null
  const pad = width / 2 + 1
  const rect = { x: Math.floor(left - pad), y: Math.floor(top - pad), w: 0, h: 0 }
  rect.w = Math.ceil(right + pad - rect.x)
  rect.h = Math.ceil(bottom + pad - rect.y)
  const round = (n: number) => Math.round(n * 10) / 10
  return { rect, points: points.map((p) => ({ x: round(p.x - rect.x), y: round(p.y - rect.y) })) }
}

/** Is `value` an ink card's logical size? */
export function isBoardInkSize(value: unknown): value is CardContent['ink'] {
  if (!value || typeof value !== 'object') return false
  const { width, height } = value as Record<string, unknown>
  return [width, height].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= BOARD_INK_MAX_SPAN + 300)
}

/** An ink card keeps its drawing's shape: its height follows its width. */
export function boardInkHeight(logical: unknown, width: number): number {
  if (!isBoardInkSize(logical) || !Number.isFinite(width) || width <= 0) return 1
  return (width * logical.height) / logical.width
}

/** A world point in an ink card's logical space. */
export function boardInkLocal(point: Vec, rect: Rect, logicalWidth: number): Vec {
  const scale = logicalWidth / rect.w
  return { x: (point.x - rect.x) * scale, y: (point.y - rect.y) * scale }
}
