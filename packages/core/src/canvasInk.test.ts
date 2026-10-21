import { describe, expect, it } from 'vitest'
import { CANVAS_INK_MAX_POINTS, canvasInkEnvelope, canvasInkHasContent, canvasInkHeight, canvasInkLocal } from './canvasInk.ts'
import { inkBounds } from './ink.ts'
import type { Stroke } from './model.ts'
import { screenToWorld, worldToScreen } from './camera.ts'

describe('board-space ink geometry', () => {
  it('bounds dots, horizontal and vertical gestures without zero dimensions', () => {
    for (const points of [[{ x: 20, y: -10 }], [{ x: 0, y: 0 }, { x: 0, y: 300 }], [{ x: -100, y: 4 }, { x: 200, y: 4 }]]) {
      const envelope = canvasInkEnvelope(points, 6)!
      expect(envelope.rect.w).toBeGreaterThanOrEqual(8)
      expect(envelope.rect.h).toBeGreaterThanOrEqual(8)
      expect(envelope.rect.w * envelope.rect.h).toBeLessThan(2500)
      envelope.points.forEach((p, i) => {
        expect(p.x + envelope.rect.x).toBe(points[i].x)
        expect(p.y + envelope.rect.y).toBe(points[i].y)
      })
    }
  })
  it('rejects nonfinite, extreme, empty and oversize gestures', () => {
    for (const points of [[], [{ x: NaN, y: 2 }], [{ x: 0, y: Infinity }], [{ x: 1e9, y: 0 }], [{ x: 0, y: 0 }, { x: 9000, y: 0 }], Array.from({ length: CANVAS_INK_MAX_POINTS + 1 }, () => ({ x: 1, y: 1 }))]) {
      expect(canvasInkEnvelope(points, 4)).toBeNull()
    }
    expect(canvasInkEnvelope([{ x: 1, y: 1 }], 0)).toBeNull()
    expect(canvasInkHeight(null, 40)).toBe(1)
    expect(canvasInkHeight({ width: 'bad', height: 40 }, 40)).toBe(1)
  })
  it('round-trips pointer coordinates at several zooms, after outer move/resize', () => {
    const envelope = canvasInkEnvelope([{ x: -320, y: 400 }, { x: -200, y: 520 }], 4)!
    const logical = { width: envelope.rect.w, height: envelope.rect.h }
    const moved = { ...envelope.rect, x: 700, y: -600, w: envelope.rect.w * 1.8, h: canvasInkHeight(logical, envelope.rect.w * 1.8) }
    for (const zoom of [0.15, 0.3, 0.75, 1, 2.5]) {
      const camera = { x: -800, y: -900, zoom }
      const local = envelope.points[1]
      const world = { x: moved.x + local.x * 1.8, y: moved.y + local.y * 1.8 }
      const actual = canvasInkLocal(screenToWorld(camera, worldToScreen(camera, world)), moved, logical.width)
      expect(actual.x).toBeCloseTo(local.x, 8)
      expect(actual.y).toBeCloseTo(local.y, 8)
    }
    // Nearby card positions are deliberately absent from this mapping.
    expect(canvasInkHeight(logical, logical.width * 2)).toBe(logical.height * 2)
  })
  it('hides empty envelopes without deleting ownership needed by concurrent additions', () => {
    const points = [{ x: 4, y: 4 }]
    const mark: Stroke = { id: 'mark', kind: 'stroke', cardId: 'ink', boardId: 'board', tool: 'pen', color: '#D7263D', width: 3, opacity: 1, order: 1, points, bounds: inkBounds(points, 3), createdAt: 1 }
    const erased = { ...mark, deletedAt: 10 }
    expect(canvasInkHasContent('ink', 'board', [erased])).toBe(false)
    expect(canvasInkHasContent('ink', 'board', [erased, { ...mark, id: 'concurrent' }])).toBe(true)
    expect(canvasInkHasContent('ink', 'board', [{ ...mark, boardId: 'private-other' }])).toBe(false)
    expect(canvasInkHasContent('ink', 'board', [{ ...mark, points: [] }])).toBe(false)
    expect(canvasInkHasContent('ink', 'board', [{ ...mark, purged: true }])).toBe(false)
  })
})
