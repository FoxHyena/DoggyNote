import { describe, expect, it } from 'vitest'
import {
  CLIP_LIMIT, CLIP_STROKE_LIMIT, DEFAULT_SKETCH, DEFAULT_SKETCH_PAPER, sketchOf, SKETCH_PAPERS, boardInkEnvelope, boardInkHeight, boardInkLocal, collectClip, copyBoardTree, hitInkStroke,
  inkBounds, inkPath, isInkMark, isSketchContent, isSketchPaper, materialise, parseClip, sketchContent, sketchPaperColor, sortedInkStrokes,
  type Board, type Card, type ClipPayload, type InkMark, type Obj, type Stroke,
} from './index.ts'
import { agentObjectSchema, strokeObjectSchema } from './agent.ts'

const mark = (extra: Partial<InkMark> = {}): InkMark => {
  const points = [{ x: 10, y: 10 }, { x: 90, y: 90 }]
  return { id: 'a', tool: 'pen', color: '#D7263D', width: 6, opacity: 1, points, order: 1, bounds: inkBounds(points, 6), ...extra }
}

describe('sketch paper colour', () => {
  it('offers light grey among the presets, all as canonical #RRGGBB', () => {
    expect(SKETCH_PAPERS.map((p) => p.name)).toContain('Light grey')
    for (const p of SKETCH_PAPERS) expect(isSketchPaper(p.hex)).toBe(true)
  })

  it('paints a picked colour, and white for anything that is not a colour', () => {
    expect(sketchPaperColor('#EDEDEA')).toBe('#EDEDEA')
    expect(sketchPaperColor('#ededea')).toBe('#EDEDEA')
    expect(sketchPaperColor('abc')).toBe('#AABBCC')
    for (const bad of [undefined, null, 'red', 'url(https://x.test/a.png)', '#12345', 42, 'paper']) expect(sketchPaperColor(bad)).toBe(DEFAULT_SKETCH_PAPER)
  })

  it('stores only canonical hex: lowercase, short or junk paper is refused', () => {
    expect(isSketchPaper('#2B2E34')).toBe(true)
    for (const bad of ['#2b2e34', '#FFF', 'FFFFFF', 'transparent', 'red;background:url(x)', '', null]) expect(isSketchPaper(bad)).toBe(false)
  })
})

describe('sketch content', () => {
  it('survives malformed synced data with a drawable default', () => {
    for (const value of [null, 'bad', { width: Infinity, height: -1, title: {}, background: '<bad>' }]) expect(sketchContent(value)).toEqual(DEFAULT_SKETCH)
    expect(sketchContent({ ...DEFAULT_SKETCH, title: 'Walk route', background: '#EDEDEA' })).toEqual({ ...DEFAULT_SKETCH, title: 'Walk route', background: '#EDEDEA' })
  })

  it('validates what the server and agents accept', () => {
    expect(isSketchContent(DEFAULT_SKETCH)).toBe(true)
    for (const content of [{ ...DEFAULT_SKETCH, width: 0 }, { ...DEFAULT_SKETCH, height: Infinity }, { ...DEFAULT_SKETCH, background: 'url(unsafe)' }, { ...DEFAULT_SKETCH, background: '#ffffff' }, { ...DEFAULT_SKETCH, strokes: [] }]) {
      expect(isSketchContent(content)).toBe(false)
    }
    const card = { id: 's1', kind: 'card', type: 'sketch', boardId: 'b1', x: 0, y: 0, w: 320, h: 240, z: 1, color: 'none', createdAt: 1, content: DEFAULT_SKETCH }
    expect(agentObjectSchema.safeParse(card).success).toBe(true)
    expect(agentObjectSchema.safeParse({ ...card, content: { ...DEFAULT_SKETCH, background: 'red' } }).success).toBe(false)
  })
})

describe('sketch title and paper fields', () => {
  const card = { content: { ...DEFAULT_SKETCH, title: 'Old name', background: '#EDEDEA' } }

  it('reads the old content fields when a sketch has no fields of its own', () => {
    expect(sketchOf(card)).toEqual({ ...DEFAULT_SKETCH, title: 'Old name', background: '#EDEDEA' })
    expect(sketchOf({ ...card, sketchTitle: null, sketchPaper: null }).title).toBe('Old name')
  })

  it('prefers its own title and paper, each on its own', () => {
    expect(sketchOf({ ...card, sketchTitle: 'Walk route' })).toMatchObject({ title: 'Walk route', background: '#EDEDEA' })
    expect(sketchOf({ ...card, sketchPaper: '#2B2E34' })).toMatchObject({ title: 'Old name', background: '#2B2E34' })
    // A cleared title is a title: it doesn't bring the old one back.
    expect(sketchOf({ ...card, sketchTitle: '' }).title).toBe('')
    // Junk paper never reaches CSS.
    expect(sketchOf({ ...card, sketchPaper: 'url(x)' }).background).toBe('#EDEDEA')
  })

  it('agents can carry the fields, but only valid paper', () => {
    const c = { id: 's1', kind: 'card', type: 'sketch', boardId: 'b1', x: 0, y: 0, w: 320, h: 240, z: 1, color: 'none', createdAt: 1, content: DEFAULT_SKETCH }
    expect(agentObjectSchema.safeParse({ ...c, sketchTitle: 'Plan', sketchPaper: '#FBF3DF' }).success).toBe(true)
    expect(agentObjectSchema.safeParse({ ...c, sketchPaper: 'red' }).success).toBe(false)
  })
})

describe('ink', () => {
  it('bounds include the line width; a tap still draws a dot', () => {
    expect(inkBounds([{ x: 4, y: 5 }], 6)).toEqual({ x: 1, y: 2, w: 6, h: 6 })
    expect(inkPath({ points: [{ x: 4, y: 5 }] })).toBe('M 4 5 L 4.001 5')
  })

  it('erases along the eraser’s path, including between pointer samples', () => {
    expect(hitInkStroke(mark(), { x: 90, y: 10 }, 2, { x: 10, y: 90 })).toBe(true)
    expect(hitInkStroke(mark(), { x: 10, y: 90 }, 2)).toBe(false)
    expect(hitInkStroke(mark(), { x: 50, y: 54 }, 2)).toBe(true)
  })

  it('orders strokes by paint order, then id, without touching the input', () => {
    const input = [mark({ id: 'z' }), mark({ id: 'b', order: 0 }), mark()]
    expect(sortedInkStrokes(input).map((s) => s.id)).toEqual(['b', 'a', 'z'])
    expect(input[0].id).toBe('z')
  })

  it('rejects markup in colours, non-finite or huge points and stale bounds', () => {
    expect(isInkMark(mark())).toBe(true)
    for (const extra of [{ color: 'url(https://example.test)' }, { width: NaN }, { opacity: 0 }, { points: [] }, { points: [{ x: Infinity, y: 0 }] }, { bounds: { x: 0, y: 0, w: 1, h: 1 } }]) {
      expect(isInkMark(mark(extra))).toBe(false)
    }
    const stroke = { ...mark(), kind: 'stroke', boardId: 'b1', cardId: 'c1', createdAt: 1 }
    expect(strokeObjectSchema.safeParse(stroke).success).toBe(true)
    expect(strokeObjectSchema.safeParse({ ...stroke, color: 'red' }).success).toBe(false)
  })

  it('wraps a mark drawn on the board in a box, with points local to it', () => {
    const box = boardInkEnvelope([{ x: 100, y: 200 }, { x: 140, y: 230 }], 6)!
    expect(box.rect).toEqual({ x: 96, y: 196, w: 48, h: 38 })
    expect(box.points).toEqual([{ x: 4, y: 4 }, { x: 44, y: 34 }])
    expect(boardInkEnvelope([{ x: 0, y: 0 }, { x: 9000, y: 0 }], 6)).toBeNull()
    expect(boardInkHeight({ width: 48, height: 38 }, 96)).toBe(76)
    expect(boardInkLocal({ x: 120, y: 216 }, { x: 96, y: 196, w: 96, h: 76 }, 48)).toEqual({ x: 12, y: 10 })
  })
})

describe('sketches travel with copies', () => {
  const sketch = { id: 's', kind: 'card', type: 'sketch', boardId: 'B', x: 0, y: 0, w: 320, h: 240, z: 1, color: 'none', createdAt: 1, content: DEFAULT_SKETCH } as Card
  const stroke = { ...mark({ id: 'k' }), kind: 'stroke', boardId: 'B', cardId: 's', createdAt: 1 } as Stroke
  const erased = { ...mark({ id: 'gone' }), kind: 'stroke', boardId: 'B', cardId: 's', createdAt: 1, deletedAt: 5 } as Stroke
  const store = (objs: Obj[]) => {
    const m = new Map(objs.map((o) => [o.id, o]))
    return { get: (id: string) => m.get(id), all: () => m.values(), rect: () => null }
  }

  it('a copied sketch brings its live strokes, re-pointed at the copy', () => {
    const clip = collectClip(['s'], store([sketch, stroke, erased])) as ClipPayload
    expect(clip.objects.map((o) => o.id).sort()).toEqual(['k', 's'])
    expect(parseClip(JSON.stringify(clip))).not.toBeNull()
    let n = 0
    const { objects, roots } = materialise(clip, { at: { x: 0, y: 0 }, boardId: 'T', maxZ: 0, now: 9, newId: () => `n${++n}` })
    const copy = objects.find((o) => o.id === roots[0]) as Card
    const ink = objects.find((o) => o.kind === 'stroke') as Stroke
    expect([ink.cardId, ink.boardId, copy.boardId]).toEqual([copy.id, 'T', 'T'])
    expect(ink.points).toEqual(stroke.points)
  })

  it('strokes don’t count toward the clip limit, but have caps of their own', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...stroke, id: `k${i}`, order: i }) as Stroke)
    const big = collectClip(['s'], store([sketch, ...many(CLIP_LIMIT + 100)])) as ClipPayload
    expect(big.objects.filter((o) => o.kind === 'stroke')).toHaveLength(CLIP_LIMIT + 100)
    expect(parseClip(JSON.stringify(big))).not.toBeNull()
    expect(collectClip(['s'], store([sketch, ...many(CLIP_STROKE_LIMIT + 1)]))).toBe('too-big')
  })

  it('duplicating a board copies the strokes on its sketches', () => {
    const board = { id: 'B', kind: 'board', parentId: 'home', title: 'Plans', icon: 'paw', color: 'gold', createdAt: 1 } as Board
    let n = 0
    const out = copyBoardTree('B', store([board, sketch, stroke]), { onBoard: 'home', at: { x: 0, y: 0 }, maxZ: 0, now: 9, newId: () => `d${++n}` })
    if (!out || out === 'too-big') throw new Error('no copy')
    const copied = out.objects.find((o) => o.kind === 'card' && o.type === 'sketch') as Card
    const ink = out.objects.find((o) => o.kind === 'stroke') as Stroke
    expect(copied.boardId).toBe(out.board.id)
    expect([ink.cardId, ink.boardId]).toEqual([copied.id, out.board.id])
  })
})
