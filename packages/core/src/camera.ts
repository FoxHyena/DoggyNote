import type { Rect, Vec } from './geometry.ts'

/** Screen = (world - {x,y}) * zoom. `x`,`y` is the world point at the viewport's top-left. */
export type Camera = { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
/** Below this zoom cards render their low-detail version. */
export const LOD_ZOOM = 0.35

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export function screenToWorld(cam: Camera, p: Vec): Vec {
  return { x: cam.x + p.x / cam.zoom, y: cam.y + p.y / cam.zoom }
}

export function worldToScreen(cam: Camera, p: Vec): Vec {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom }
}

/** Zoom to `zoom`, keeping the world point under screen point `anchor` fixed. */
export function zoomAt(cam: Camera, anchor: Vec, zoom: number): Camera {
  const z = clampZoom(zoom)
  const w = screenToWorld(cam, anchor)
  return { x: w.x - anchor.x / z, y: w.y - anchor.y / z, zoom: z }
}

export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...cam, x: cam.x - dxScreen / cam.zoom, y: cam.y - dyScreen / cam.zoom }
}

/** The world rect visible in a viewport of the given screen size. */
export function viewRect(cam: Camera, width: number, height: number): Rect {
  return { x: cam.x, y: cam.y, w: width / cam.zoom, h: height / cam.zoom }
}

/**
 * Expand a view rect by `margin` and snap it outward to a `step` grid. Culling
 * keys off this, so small pans don't recompute the visible set every frame.
 */
export function cullRect(view: Rect, margin: number, step: number): Rect {
  const x0 = Math.floor((view.x - margin) / step) * step
  const y0 = Math.floor((view.y - margin) / step) * step
  const x1 = Math.ceil((view.x + view.w + margin) / step) * step
  const y1 = Math.ceil((view.y + view.h + margin) / step) * step
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Camera that fits `bounds` in the viewport with padding, capped at 100%. */
export function fitCamera(bounds: Rect, width: number, height: number, pad = 80): Camera {
  const zoom = clampZoom(Math.min(1, (width - pad * 2) / Math.max(bounds.w, 1), (height - pad * 2) / Math.max(bounds.h, 1)))
  return {
    zoom,
    x: bounds.x + bounds.w / 2 - width / 2 / zoom,
    y: bounds.y + bounds.h / 2 - height / 2 / zoom,
  }
}

// ---- touch ---------------------------------------------------------------------

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * Two-finger pinch and pan. The world point under the fingers' starting
 * midpoint follows their current midpoint; zoom scales with their spread.
 */
export function pinchCamera(start: Camera, a0: Vec, b0: Vec, a1: Vec, b1: Vec): Camera {
  const m0 = mid(a0, b0)
  const m1 = mid(a1, b1)
  const zoom = clampZoom((start.zoom * Math.hypot(a1.x - b1.x, a1.y - b1.y)) / Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y)))
  const w = screenToWorld(start, m0)
  return { x: w.x - m1.x / zoom, y: w.y - m1.y / zoom, zoom }
}

/** One step of a flick: screen distance to pan over `dt` ms, and the slowed velocity (px/ms). */
export function momentumStep(v: Vec, dt: number, friction = 0.92): { delta: Vec; v: Vec } {
  const k = Math.pow(friction, dt / 16)
  return { delta: { x: v.x * dt, y: v.y * dt }, v: { x: v.x * k, y: v.y * k } }
}

export type Tap = { x: number; y: number; t: number }

/** Whether `next` completes a double-tap after `prev` (close in time and place). */
export function isDoubleTap(prev: Tap | null, next: Tap, ms = 300, px = 24): boolean {
  return !!prev && next.t - prev.t <= ms && Math.hypot(next.x - prev.x, next.y - prev.y) <= px
}

/**
 * Camera for editing `card` on a small touch screen: readable zoom, the card's
 * top just below the visible top, centred if it fits across.
 * `top`/`bottom` bound the part of the viewport the keyboard leaves visible.
 */
export function editCamera(card: Rect, view: { width: number; top: number }, current: Camera, opts: { min?: number; max?: number; pad?: number } = {}): Camera {
  const { min = 0.9, max = 1.4, pad = 12 } = opts
  const room = view.width - pad * 2
  const keep = current.zoom >= min && current.zoom <= max && card.w * current.zoom <= room
  const zoom = keep ? current.zoom : Math.min(max, Math.max(min, room / card.w))
  const x = card.w * zoom <= room ? card.x + card.w / 2 - view.width / 2 / zoom : card.x - pad / zoom
  return { x, y: card.y - (view.top + pad) / zoom, zoom }
}

/**
 * Opening a board on a phone: fit it if that stays readable, otherwise start
 * at `minZoom` from the content's top-left, like reading a page.
 */
export function readableCamera(bounds: Rect, width: number, height: number, minZoom: number, pad = 16): Camera {
  const fit = fitCamera(bounds, width, height, pad)
  if (fit.zoom >= minZoom) return fit
  return { zoom: minZoom, x: bounds.x - pad / minZoom, y: bounds.y - pad / minZoom }
}
