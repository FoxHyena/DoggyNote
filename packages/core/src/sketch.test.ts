import { describe, expect, it } from 'vitest'
import { DEFAULT_SKETCH, fitSketch, sketchContent } from './sketch.ts'
import { agentObjectSchema } from './agent.ts'

describe('bounded sketch paper', () => {
  it('fits aspect changes without clipping or distortion', () => {
    expect(fitSketch(320, 240, 640, 240)).toEqual({ scale: 1, x: 160, y: 0 })
    expect(fitSketch(320, 240, 80, 120)).toEqual({ scale: .25, x: 0, y: 30 })
  })
  it('survives malformed synced data without unbounded geometry', () => {
    for (const value of [null, 'bad', { width: Infinity, height: -1, title: {}, background: '<bad>' }]) {
      expect(sketchContent(value)).toEqual(DEFAULT_SKETCH)
    }
    expect(sketchContent({ width: 10001, height: NaN }).width).toBe(320)
  })
  it('keeps a picked hex paper colour and paints the theme white for plain paper', async () => {
    const { isSketchContent, sketchPaperColor } = await import('./sketch.ts')
    expect(sketchContent({ ...DEFAULT_SKETCH, background: '#EDEDEA' }).background).toBe('#EDEDEA')
    expect(isSketchContent({ ...DEFAULT_SKETCH, background: '#2b2e34' })).toBe(true)
    expect(isSketchContent({ ...DEFAULT_SKETCH, background: 'red' })).toBe(false)
    expect(sketchPaperColor('paper', '#fff')).toBe('#fff')
    expect(sketchPaperColor('#EDEDEA', '#fff')).toBe('#EDEDEA')
    expect(sketchPaperColor('transparent', '#fff')).toBeNull()
  })
  it('validates editable sketch proposal content and rejects invalid paper', () => {
    const card = { id: 'sketch-1', kind: 'card', type: 'sketch', boardId: 'board-1', x: 0, y: 0, w: 320, h: 240, z: 1, color: 'none', createdAt: 1, content: DEFAULT_SKETCH }
    expect(agentObjectSchema.safeParse(card).success).toBe(true)
    for (const content of [{ ...DEFAULT_SKETCH, width: 0 }, { ...DEFAULT_SKETCH, height: Infinity }, { ...DEFAULT_SKETCH, background: 'url(unsafe)' }, { ...DEFAULT_SKETCH, strokes: [] }]) {
      expect(agentObjectSchema.safeParse({ ...card, content }).success).toBe(false)
    }
  })
})

it('selection and template copies preserve editable sketch paper and independently clone stroke identities', async () => {
  const { duplicateObjects } = await import('./duplicate.ts')
  const { inkBounds } = await import('./ink.ts')
  const points = [{ x: 20, y: 30 }, { x: 300, y: 200 }]
  const source = [
    { id: 'root', kind: 'board', parentId: null, title: 'Storyboard', icon: 'paw', color: 'none', createdAt: 1 },
    { id: 'paper', kind: 'card', type: 'sketch', boardId: 'root', x: 0, y: 0, w: 440, h: 200, z: 1, color: 'none', positionLocked: true, createdAt: 1, content: { ...DEFAULT_SKETCH, title: 'Opening frame' } },
    { id: 'mark', kind: 'stroke', cardId: 'paper', boardId: 'root', tool: 'highlighter', color: '#D7263D', opacity: .3, width: 6, order: 1, points, bounds: inkBounds(points, 6), createdAt: 1 },
  ] as import('./model.ts').Obj[]
  for (const options of [{ selectionIds: ['paper'], targetBoardId: 'root' }, { rootBoardId: 'root' }]) {
    const copy = duplicateObjects(source, options)
    const paper = copy.objects.find((o) => o.kind === 'card') as import('./model.ts').Card<'sketch'>
    const mark = copy.objects.find((o) => o.kind === 'stroke') as import('./model.ts').Stroke
    expect(paper.content).toEqual({ ...DEFAULT_SKETCH, title: 'Opening frame' })
    expect(paper).toMatchObject({ w: 440, h: 200, positionLocked: true })
    expect(paper.id).not.toBe('paper'); expect(mark.id).not.toBe('mark')
    expect(mark).toMatchObject({ cardId: paper.id, boardId: paper.boardId, points, tool: 'highlighter', width: 6, opacity: .3 })
    mark.points[0].x = 99; paper.content.title = 'Independent alternative'
    expect(points[0].x).toBe(20)
    expect((source[1] as import('./model.ts').Card<'sketch'>).content.title).toBe('Opening frame')
  }
})
