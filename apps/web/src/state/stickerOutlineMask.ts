/** The die-cut border's opacity, from an RGBA image's alpha. Like the old SVG
 * filter: take the strongest alpha within `radius` (a disc), then snap it with
 * `3a - 0.5` so soft shadows and feathered edges don't grow into a halo.
 * The disc is one horizontal span per row offset; each span width is a sliding
 * max (van Herk/Gil-Werman), so a pixel costs 2r+1 lookups, not a disc scan. */
export function outlineAlpha(rgba: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const n = width * height, alpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) alpha[i] = rgba[i * 4 + 3]
  const byWidth = new Map<number, Uint8Array>(), rows: Uint8Array[] = []
  for (let dy = -radius; dy <= radius; dy++) {
    const w = Math.floor(Math.sqrt(radius * radius + radius - dy * dy))
    if (!byWidth.has(w)) byWidth.set(w, rowMax(alpha, width, height, w))
    rows.push(byWidth.get(w)!)
  }
  const out = new Uint8ClampedArray(n)
  for (let y = 0; y < height; y++) {
    const top = Math.max(-radius, -y), bottom = Math.min(radius, height - 1 - y)
    for (let x = 0; x < width; x++) {
      let max = 0
      for (let dy = top; dy <= bottom && max < 255; dy++) {
        const a = rows[dy + radius][(y + dy) * width + x]
        if (a > max) max = a
      }
      out[y * width + x] = 3 * max - 127.5
    }
  }
  return out
}

/** For every pixel, the max alpha within `w` pixels left or right on its row. */
function rowMax(alpha: Uint8Array, width: number, height: number, w: number): Uint8Array {
  const out = new Uint8Array(width * height), k = 2 * w + 1, len = width + 2 * w
  const padded = new Uint8Array(len), g = new Uint8Array(len), h = new Uint8Array(len)
  for (let y = 0; y < height; y++) {
    padded.set(alpha.subarray(y * width, (y + 1) * width), w)
    for (let i = 0; i < len; i++) g[i] = i % k ? Math.max(g[i - 1], padded[i]) : padded[i]
    for (let i = len - 1; i >= 0; i--) h[i] = i % k === k - 1 || i === len - 1 ? padded[i] : Math.max(h[i + 1], padded[i])
    for (let x = 0; x < width; x++) out[y * width + x] = Math.max(h[x], g[x + k - 1])
  }
  return out
}
