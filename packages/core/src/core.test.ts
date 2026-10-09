import { describe, expect, it } from 'vitest'
import {
  MAX_FILE_BYTES,
  UndoStack,
  fileKind,
  formatBytes,
  compareVersions,
  cullRect,
  diff,
  docToText,
  autoSides,
  dotSpacing,
  snap,
  connectorPath,
  edgePoint,
  nearestSide,
  sideAnchor,
  findFreeSpot,
  intersects,
  fitCamera,
  invert,
  orderBetween,
  ordersBetween,
  rectFromPoints,
  sanitizeDoc,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Card,
  type Change,
} from './index.ts'

describe('camera', () => {
  const cam = { x: 100, y: 50, zoom: 2 }

  it('round-trips screen and world coordinates', () => {
    const w = screenToWorld(cam, { x: 40, y: 60 })
    expect(w).toEqual({ x: 120, y: 80 })
    expect(worldToScreen(cam, w)).toEqual({ x: 40, y: 60 })
  })

  it('zoomAt keeps the anchor point fixed', () => {
    const anchor = { x: 300, y: 200 }
    const before = screenToWorld(cam, anchor)
    const next = zoomAt(cam, anchor, 0.5)
    const after = screenToWorld(next, anchor)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(next.zoom).toBe(0.5)
  })

  it('zoomAt clamps zoom', () => {
    expect(zoomAt(cam, { x: 0, y: 0 }, 100).zoom).toBe(4)
    expect(zoomAt(cam, { x: 0, y: 0 }, 0.001).zoom).toBe(0.1)
  })

  it('cullRect snaps outward so small pans keep the same rect', () => {
    const a = cullRect({ x: 10, y: 10, w: 800, h: 600 }, 200, 256)
    const b = cullRect({ x: 12, y: 12, w: 800, h: 600 }, 200, 256)
    expect(a).toEqual(b)
    expect(a.x).toBeLessThanOrEqual(10 - 200)
  })

  it('fitCamera centres the bounds and never zooms past 100%', () => {
    const c = fitCamera({ x: 0, y: 0, w: 100, h: 100 }, 1000, 800)
    expect(c.zoom).toBe(1)
    const mid = worldToScreen(c, { x: 50, y: 50 })
    expect(mid.x).toBeCloseTo(500)
    expect(mid.y).toBeCloseTo(400)
  })
})

describe('grid', () => {
  it('snaps to the nearest grid line', () => {
    expect(snap(0)).toBe(0)
    expect(snap(9)).toBe(0)
    expect(snap(11)).toBe(20)
    expect(snap(-11)).toBe(-20)
    expect(snap(37, 10)).toBe(40)
  })
  it('dot spacing doubles until dots are far enough apart', () => {
    expect(dotSpacing(1)).toBe(20)
    expect(dotSpacing(0.5)).toBe(20) // 10 → 20
    expect(dotSpacing(0.1)).toBe(16) // 2 → 4 → 8 → 16
    expect(dotSpacing(2)).toBe(40)
  })
})

describe('connector anchors', () => {
  const r = { x: 0, y: 0, w: 200, h: 100 }
  it('sideAnchor is each side midpoint', () => {
    expect(sideAnchor(r, 'top')).toEqual({ x: 100, y: 0 })
    expect(sideAnchor(r, 'right')).toEqual({ x: 200, y: 50 })
    expect(sideAnchor(r, 'bottom')).toEqual({ x: 100, y: 100 })
    expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 50 })
  })
  it('nearestSide picks the closest edge, inside or out', () => {
    expect(nearestSide(r, { x: 20, y: 50 })).toBe('left')
    expect(nearestSide(r, { x: 100, y: 8 })).toBe('top')
    expect(nearestSide(r, { x: 190, y: 60 })).toBe('right')
    expect(nearestSide(r, { x: 100, y: 140 })).toBe('bottom')
  })
  it('autoSides faces the rects along the dominant axis', () => {
    expect(autoSides(r, { x: 400, y: 10, w: 200, h: 100 })).toEqual(['right', 'left'])
    expect(autoSides(r, { x: -400, y: 0, w: 200, h: 100 })).toEqual(['left', 'right'])
    expect(autoSides(r, { x: 0, y: 300, w: 200, h: 100 })).toEqual(['bottom', 'top'])
    expect(autoSides(r, { x: 50, y: -300, w: 200, h: 100 })).toEqual(['top', 'bottom'])
  })
  it('connectorPath starts and ends just outside the anchors', () => {
    const b = { x: 400, y: 0, w: 200, h: 100 }
    const p = connectorPath(r, 'right', { rect: b, side: 'left' })
    expect(p.start).toEqual({ x: 204, y: 50 })
    expect(p.end).toEqual({ x: 392, y: 50 })
    expect(p.d.startsWith('M204,50 C')).toBe(true)
    expect(p.d.endsWith('392,50')).toBe(true)
    const free = connectorPath(r, 'bottom', { x: 10, y: 400 })
    expect(free.end).toEqual({ x: 10, y: 400 })
  })
})

describe('geometry', () => {
  it('findFreeSpot keeps a clear spot and moves off an occupied one', () => {
    const want = { x: 0, y: 0, w: 100, h: 50 }
    expect(findFreeSpot(want, [])).toEqual({ x: 0, y: 0 })
    const spot = findFreeSpot(want, [{ x: 0, y: 0, w: 100, h: 50 }])
    expect(intersects({ ...want, ...spot }, { x: 0, y: 0, w: 100, h: 50 })).toBe(false)
    expect(Math.hypot(spot.x, spot.y)).toBeLessThan(200)
  })

  it('rectFromPoints works in any drag direction', () => {
    expect(rectFromPoints({ x: 10, y: 10 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
  it('edgePoint lands on the rect edge toward the target', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 }
    expect(edgePoint(r, { x: 500, y: 25 })).toEqual({ x: 100, y: 25 })
    expect(edgePoint(r, { x: 50, y: -500 })).toEqual({ x: 50, y: 0 })
  })
})

describe('patches + undo', () => {
  const card = { id: 'a', kind: 'card', x: 0, y: 0, color: 'none' } as unknown as Card

  it('diff keeps only changed keys and records previous values', () => {
    expect(diff(card, { x: 10, y: 0 })).toEqual({ id: 'a', before: { x: 0 }, after: { x: 10 } })
    expect(diff(card, { x: 0 })).toBeNull()
  })

  it('treats null and undefined as equal', () => {
    expect(diff({ ...card, columnId: undefined } as Card, { columnId: null })).toBeNull()
  })

  it('invert swaps before/after and reverses order', () => {
    const tx: Change[] = [
      { id: 'a', before: { x: 0 }, after: { x: 1 } },
      { id: 'b', before: { x: 5 }, after: { x: 6 } },
    ]
    expect(invert(tx)).toEqual([
      { id: 'b', before: { x: 6 }, after: { x: 5 } },
      { id: 'a', before: { x: 1 }, after: { x: 0 } },
    ])
  })

  it('UndoStack undoes, redoes, and clears redo on new edits', () => {
    const s = new UndoStack()
    const t1: Change[] = [{ id: 'a', before: { x: 0 }, after: { x: 1 } }]
    const t2: Change[] = [{ id: 'a', before: { x: 1 }, after: { x: 2 } }]
    s.push(t1)
    s.push(t2)
    expect(s.undo()).toEqual(invert(t2))
    expect(s.canRedo).toBe(true)
    expect(s.redo()).toEqual(t2)
    s.undo()
    s.push([{ id: 'b', before: {}, after: { x: 9 } }])
    expect(s.canRedo).toBe(false)
  })
})

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('ordering', () => {
  it('orderBetween handles ends and middles', () => {
    expect(orderBetween(undefined, undefined)).toBe(1)
    expect(orderBetween(1, undefined)).toBe(2)
    expect(orderBetween(undefined, 1)).toBe(0)
    expect(orderBetween(1, 2)).toBe(1.5)
  })
  it('ordersBetween spaces values strictly inside the gap', () => {
    const o = ordersBetween(1, 2, 3)
    expect(o).toHaveLength(3)
    expect(o[0]).toBeGreaterThan(1)
    expect(o[2]).toBeLessThan(2)
    expect(o[0]).toBeLessThan(o[1])
  })
})

describe('rich text', () => {
  it('drops unknown nodes, marks and unsafe links', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'script', text: 'x' },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'strong' }, { type: 'onclick' }] },
            { type: 'text', text: ' ok', marks: [{ type: 'link', attrs: { href: 'https://dog.example/' } }] },
          ],
        },
      ],
    })
    expect(doc.content).toHaveLength(1)
    expect(doc.content![0].content![0].marks).toEqual([{ type: 'strong' }])
    expect(doc.content![0].content![1].marks).toEqual([{ type: 'link', attrs: { href: 'https://dog.example/' } }])
  })
  it('rejects non-docs', () => {
    expect(sanitizeDoc('<b>hi</b>')).toEqual({ type: 'doc', content: [] })
  })
  it('docToText joins blocks with newlines', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
          { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
        ],
      }),
    ).toBe('Title\none')
  })
})

describe('files', () => {
  it('knows common kinds by extension, then by type', () => {
    expect(fileKind('application/pdf', 'menu.pdf')).toBe('pdf')
    expect(fileKind('', 'Plan.KEY')).toBe('slides')
    expect(fileKind('application/octet-stream', 'photos.zip')).toBe('zip')
    expect(fileKind('audio/mpeg', 'bark')).toBe('audio')
    expect(fileKind('application/x-thing', 'mystery')).toBe('other')
  })
  it('formats sizes', () => {
    expect(formatBytes(950)).toBe('950 B')
    expect(formatBytes(12_300)).toBe('12 KB')
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB')
    expect(formatBytes(MAX_FILE_BYTES)).toBe('50 MB')
  })
})
