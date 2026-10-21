import { describe, expect, it } from 'vitest'
import { hitInkStroke, inkBounds, inkPath, isInkMark, sortedInkStrokes, type InkMark } from './ink.ts'
const mark = (extra: Partial<InkMark> = {}): InkMark => {
  const points = [{ x: 10, y: 10 }, { x: 90, y: 90 }], width = 6
  return { id: 'a', tool: 'pen', color: '#D7263D', width, opacity: 1, points, order: 1, bounds: inkBounds(points, width), ...extra }
}
describe('editable ink', () => {
  it('includes stroke radius in tap and line bounds', () => {
    expect(inkBounds([{ x: 4, y: 5 }], 6)).toEqual({ x: 1, y: 2, w: 6, h: 6 })
    expect(mark().bounds).toEqual({ x: 7, y: 7, w: 86, h: 86 })
  })
  it('hits a swept eraser crossing a line, including between pointer samples', () => {
    expect(hitInkStroke(mark(), { x: 90, y: 10 }, 2, { x: 10, y: 90 })).toBe(true)
    expect(hitInkStroke(mark(), { x: 10, y: 90 }, 2)).toBe(false)
    expect(hitInkStroke(mark(), { x: 50, y: 54 }, 2)).toBe(true)
  })
  it('renders taps and orders simultaneous additions deterministically without mutation', () => {
    expect(inkPath({ points: [{ x: 4, y: 5 }] })).toBe('M 4 5 L 4.001 5')
    const input = [mark({ id: 'z' }), mark({ id: 'b', order: 0 }), mark()]
    expect(sortedInkStrokes(input).map((s) => s.id)).toEqual(['b', 'a', 'z'])
    expect(input[0].id).toBe('z')
  })
  it('rejects untrusted markup/style, nonfinite or enormous coordinates and stale bounds', () => {
    expect(isInkMark(mark())).toBe(true)
    for (const extra of [{ color: 'url(https://example.test)' }, { width: NaN }, { opacity: 0 }, { points: [] }, { points: [{ x: Infinity, y: 0 }] }, { bounds: { x: 0, y: 0, w: 1, h: 1 } }]) expect(isInkMark(mark(extra))).toBe(false)
  })
})
