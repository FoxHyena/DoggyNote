import { describe, expect, it } from 'vitest'
import { outlineAlpha } from './stickerOutlineMask.ts'

const W = 21, H = 21
function image(paint: (x: number, y: number) => number) {
  const rgba = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba[(y * W + x) * 4 + 3] = paint(x, y)
  return rgba
}
const at = (mask: Uint8ClampedArray, x: number, y: number) => mask[y * W + x]

describe('outlineAlpha', () => {
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
