export type ImageSize = { width: number; height: number }
export type Crop = { x: number; y: number; zoom: number }
export type CropCorner = { x: -1 | 1; y: -1 | 1 }
export type CropBounds = { left: number; top: number; right: number; bottom: number }
export const cropSide = (image: ImageSize, crop: Crop) => Math.min(image.width, image.height) / crop.zoom
export const initialCrop = (image: ImageSize): Crop => ({ x: image.width / 2, y: image.height / 2, zoom: 1.25 })
/** Display the entire image with enough space for outward-facing 44px handles. */
export function fitImage(image: ImageSize, size: number) {
  const scale = Math.max(1, size - 88) / Math.max(image.width, image.height)
  return { scale, left: (size - image.width * scale) / 2, top: (size - image.height * scale) / 2 }
}
export function clampCrop(image: ImageSize, crop: Crop): Crop {
  const zoom = Math.min(4, Math.max(1, crop.zoom))
  const half = Math.min(image.width, image.height) / zoom / 2
  return { zoom, x: Math.max(half, Math.min(image.width - half, crop.x)), y: Math.max(half, Math.min(image.height - half, crop.y)) }
}
export function moveCrop(image: ImageSize, crop: Crop, delta: { x: number; y: number }): Crop {
  return clampCrop(image, { ...crop, x: crop.x + delta.x, y: crop.y + delta.y })
}

/** Fingers spread to enlarge the selection, rather than zooming the photograph. */
export function pinchCrop(image: ImageSize, crop: Crop, ratio: number, delta: { x: number; y: number }): Crop {
  return clampCrop(image, { x: crop.x + delta.x, y: crop.y + delta.y, zoom: crop.zoom / ratio })
}

/** Resize a square about the opposite corner, projecting the drag onto its diagonal. */
export function resizeCrop(image: ImageSize, crop: Crop, corner: CropCorner, point: { x: number; y: number }, bounds: CropBounds = { left: 0, top: 0, right: image.width, bottom: image.height }): Crop {
  const old = cropSide(image, crop), minimum = Math.min(image.width, image.height) / 4
  const anchor = { x: crop.x - corner.x * old / 2, y: crop.y - corner.y * old / 2 }
  const maximum = Math.min(Math.min(image.width, image.height), corner.x > 0 ? bounds.right - anchor.x : anchor.x - bounds.left, corner.y > 0 ? bounds.bottom - anchor.y : anchor.y - bounds.top)
  const wanted = ((point.x - anchor.x) * corner.x + (point.y - anchor.y) * corner.y) / 2
  const side = Math.max(minimum, Math.min(maximum, wanted))
  return clampCrop(image, { x: anchor.x + corner.x * side / 2, y: anchor.y + corner.y * side / 2, zoom: Math.min(image.width, image.height) / side })
}


/** Insets keep the painted corner mark inside its own 44px hit target. */
export function cropHandle(frame: { x: number; y: number; side: number }, corner: CropCorner) {
  const inset = Math.min(10, frame.side / 3), half = frame.side / 2
  return { x: frame.x + corner.x * half + (corner.x < 0 ? -44 + inset : -inset), y: frame.y + corner.y * half + (corner.y < 0 ? -44 + inset : -inset), width: 44, height: 44 }
}

/** Find a clear 44px move grip in the mat, outside the tiny crop and its corner targets. */
export function placeMoveGrip(frame: { x: number; y: number; side: number }, size: number) {
  const half = frame.side / 2
  const obstacles = ([-1, 1] as const).flatMap((x) => ([-1, 1] as const).map((y) => cropHandle(frame, { x, y })))
  obstacles.push({ x: frame.x - half, y: frame.y - half, width: frame.side, height: frame.side })
  const xs = [Math.max(0, Math.min(size - 44, frame.x - 22)), 0, size - 44]
  const ys = [Math.max(0, Math.min(size - 44, frame.y - 22)), 0, size - 44]
  const clear = xs.flatMap((x) => ys.map((y) => ({ x, y }))).filter((p) => obstacles.every((o) => p.x + 44 <= o.x || p.x >= o.x + o.width || p.y + 44 <= o.y || p.y >= o.y + o.height))
  return clear.sort((a, b) => Math.hypot(a.x + 22 - frame.x, a.y + 22 - frame.y) - Math.hypot(b.x + 22 - frame.x, b.y + 22 - frame.y))[0]
}
