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
