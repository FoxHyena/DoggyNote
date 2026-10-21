import { describe, expect, it } from 'vitest'
import { outlineAlpha } from './stickerOutlineMask.ts'

const W = 21, H = 21
function image(paint: (x: number, y: number) => number) {
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba[(y * W + x) * 4 + 3] = paint(x, y)
  return rgba
}
const at = (mask: Uint8ClampedArray, x: number, y: number) => mask[y * W + x]

// The straightforward disc scan the fast version must match exactly.
function reference(rgba: Uint8ClampedArray, width: number, height: number, radius: number) {
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let max = 0
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const sx = x + dx, sy = y + dy
      if (dx * dx + dy * dy > radius * radius + radius || sx < 0 || sy < 0 || sx >= width || sy >= height) continue
      max = Math.max(max, rgba[(sy * width + sx) * 4 + 3])
    }
    out[y * width + x] = Math.max(0, Math.min(255, 3 * max - 127.5))
  }
  return out
}

describe('outlineAlpha', () => {
  it('matches a plain disc scan on irregular art', () => {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (const [width, height, radius] of [[37, 23, 1], [41, 29, 3], [64, 48, 6]]) {
      const rgba = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = random() < .15 ? Math.floor(random() * 256) : 0
      expect(outlineAlpha(rgba, width, height, radius)).toEqual(reference(rgba, width, height, radius))
    }
  })

  it('grows an opaque dot into a solid disc of the radius', () => {
    const mask = outlineAlpha(image((x, y) => x === 10 && y === 10 ? 255 : 0), W, H, 4)
    expect(at(mask, 14, 10)).toBe(255)
    expect(at(mask, 10, 6)).toBe(255)
    expect(at(mask, 14, 13)).toBe(0)
    expect(at(mask, 15, 10)).toBe(0)
  })

  it('drops faint shadows instead of building a halo', () => {
    const mask = outlineAlpha(image(() => 26), W, H, 4)
    expect(Math.max(...mask)).toBe(0)
  })

  it('keeps a partial edge for faint-but-visible pixels', () => {
    const mask = outlineAlpha(image((x) => x < 10 ? 64 : 0), W, H, 2)
    expect(at(mask, 11, 10)).toBeGreaterThan(0)
    expect(at(mask, 11, 10)).toBeLessThan(255)
    expect(at(mask, 12, 10)).toBe(0)
  })
})
