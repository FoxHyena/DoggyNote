import type { CardContent, SketchBackground } from './model.ts'

const HEX = /^#[0-9a-f]{6}$/i
/** Ready-made paper colours (document data, like INK_PALETTE). The editor also offers a custom picker. */
export const SKETCH_PAPERS: readonly { value: SketchBackground; name: string }[] = [
  { value: 'paper', name: 'White' }, { value: '#EDEDEA', name: 'Light grey' }, { value: '#FBF3DF', name: 'Cream' },
  { value: '#E3EEF9', name: 'Pale blue' }, { value: '#2B2E34', name: 'Charcoal' }, { value: 'transparent', name: 'No paper' },
]

function background(value: unknown): SketchBackground {
  return value === 'transparent' ? 'transparent' : typeof value === 'string' && HEX.test(value) ? value as SketchBackground : 'paper'
}

/** The CSS colour to paint a sketch's paper with, or null for no paper. */
export function sketchPaperColor(value: SketchBackground, paper: string): string | null {
  return value === 'transparent' ? null : value === 'paper' ? paper : value
}

/** A sketch's logical paper never changes when its card is resized. */
export const DEFAULT_SKETCH: CardContent['sketch'] = {
  title: '', width: 320, height: 240, background: 'paper',
}

/** Renderers must tolerate malformed content received from older/synced clients. */
export function sketchContent(value: unknown): CardContent['sketch'] {
  const c = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const dimension = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : fallback
  return {
    title: typeof c.title === 'string' ? c.title.slice(0, 1000) : '',
    width: dimension(c.width, DEFAULT_SKETCH.width),
    height: dimension(c.height, DEFAULT_SKETCH.height),
    background: background(c.background),
  }
}

/** Same xMidYMid meet mapping as the SVG, also used by overview rendering. */
export function fitSketch(width: number, height: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / width, boxHeight / height)
  return { scale, x: (boxWidth - width * scale) / 2, y: (boxHeight - height * scale) / 2 }
}

/** Sync validation bounds document dimensions before any client renders them. */
export function isSketchContent(value: unknown): value is CardContent['sketch'] {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return typeof c.title === 'string' && c.title.length <= 1000 &&
    typeof c.width === 'number' && Number.isFinite(c.width) && c.width >= 1 && c.width <= 10_000 &&
    typeof c.height === 'number' && Number.isFinite(c.height) && c.height >= 1 && c.height <= 10_000 &&
    (c.background === 'paper' || c.background === 'transparent' || (typeof c.background === 'string' && HEX.test(c.background)))
}
