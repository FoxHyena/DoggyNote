/** The die-cut border's opacity, from an RGBA image's alpha. Like the old SVG
 * filter: take the strongest alpha within `radius` (a disc), then snap it with
 * `3a - 0.5` so soft shadows and feathered edges don't grow into a halo. */
export function outlineAlpha(rgba: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height)
  const disc: number[] = []
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (dx * dx + dy * dy <= radius * radius + radius) disc.push(dx, dy)
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let max = rgba[(y * width + x) * 4 + 3]
    for (let i = 0; i < disc.length && max < 255; i += 2) {
      const sx = x + disc[i], sy = y + disc[i + 1]
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
      const a = rgba[(sy * width + sx) * 4 + 3]
      if (a > max) max = a
    }
    out[y * width + x] = Math.max(0, Math.min(255, 3 * max - 127.5))
  }
  return out
}
