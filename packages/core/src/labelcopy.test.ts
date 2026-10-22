import { describe, expect, it } from 'vitest'
import { MAX_LABELS, cardLabelIds, labelDefinitions, parseLabels, planLabelCopy, relabel, relabelPatch, type Label } from './labels.ts'
import { collectClip, copyBoardTree, materialise, parseClip } from './clip.ts'
import type { Board, Card, Obj } from './model.ts'

const card = (extra: Record<string, unknown> = {}) => ({ id: 'c', kind: 'card', type: 'note', boardId: 'b', x: 0, y: 0, w: 200, h: 80, z: 1, color: 'none', createdAt: 1, content: { md: '' }, ...extra }) as Card

const source: Label[] = [
  { id: 'aaaaaaaaaaaa', name: 'Lighting', color: 'gold' },
  { id: 'bbbbbbbbbbbb', name: 'Props', color: '#12AB3F' },
  { id: 'cccccccccccc', name: 'Unused', color: 'sky' },
]

it('maps copied labels by name, reusing a match and creating the rest with their colour', () => {
  const target: Label[] = [{ id: 'dddddddddddd', name: ' lighting ', color: 'ball' }]
  const plan = planLabelCopy(source, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'eeeeeeeeeeee'], target, () => 'ffffffffffff')
  expect([...plan.map]).toEqual([['aaaaaaaaaaaa', 'dddddddddddd'], ['bbbbbbbbbbbb', 'ffffffffffff']])
  // Only labels in use come along; the target keeps its own colour for a name match.
  expect(plan.create).toEqual([{ id: 'ffffffffffff', name: 'Props', color: '#12AB3F' }])
  expect(labelDefinitions(plan.create)).toEqual({ labelNameffffffffffff: 'Props', labelColorffffffffffff: '#12AB3F' })
})

it('rewrites a copied card’s flags and drops ones with no label', () => {
  const plan = planLabelCopy(source, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'], [], (() => { const ids = ['111111111111', '222222222222']; return () => ids.shift()! })())
  const copied = relabel(card({ labelaaaaaaaaaaaa: true, labelbbbbbbbbbbbb: true, labeleeeeeeeeeeee: true, labelcccccccccccc: false }), plan)
  expect(cardLabelIds(copied).sort()).toEqual(['111111111111', '222222222222'])
  expect(Object.keys(copied).filter((k) => k.startsWith('label'))).toHaveLength(2)
  expect((copied as Card).content).toEqual({ md: '' })
})

it('moves a card’s flags with a patch: old ones off, mapped ones on', () => {
  const plan = planLabelCopy(source, ['aaaaaaaaaaaa'], [{ id: 'dddddddddddd', name: 'LIGHTING', color: 'ball' }])
  expect(relabelPatch(card({ labelaaaaaaaaaaaa: true, labeleeeeeeeeeeee: true }), plan)).toEqual({ labelaaaaaaaaaaaa: null, labeleeeeeeeeeeee: null, labeldddddddddddd: true })
  // Same ids on both boards (a duplicated board): the flag stays on.
  const same = planLabelCopy(source, ['aaaaaaaaaaaa'], [source[0]!])
  expect(relabelPatch(card({ labelaaaaaaaaaaaa: true }), same)).toEqual({ labelaaaaaaaaaaaa: true })
})

it('never takes a board past the label limit, and never reuses a taken id', () => {
  const full: Label[] = Array.from({ length: MAX_LABELS - 1 }, (_, i) => ({ id: i.toString(16).padStart(12, '0'), name: `L${i}`, color: 'sky' }))
  const ids = ['000000000000', '0123456789ab']
  const plan = planLabelCopy(source, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'], full, () => ids.shift()!)
  expect(plan.create).toEqual([{ id: '0123456789ab', name: 'Lighting', color: 'gold' }])
  expect(plan.map.has('bbbbbbbbbbbb')).toBe(false)
})

it('cleans label definitions read from a clipboard', () => {
  expect(parseLabels([{ id: 'aaaaaaaaaaaa', name: ' Ok ', color: 'url(x)' }, { id: 'nope', name: 'x', color: 'sky' }, { id: 'bbbbbbbbbbbb', name: '  ', color: 'sky' }, null])).toEqual([{ id: 'aaaaaaaaaaaa', name: 'Ok', color: 'sky' }])
  expect(parseLabels('x')).toEqual([])
})

it('stickers on a copied board move to the copy, not back onto the original', () => {
  const inner = { id: 'inner', kind: 'board', parentId: 'b', title: 'Inner', icon: 'paw', color: 'none', createdAt: 1 } as Board
  const sticker = { id: 's', kind: 'sticker', boardId: 'inner', x: 0, y: 0, w: 80, angle: 0, z: 1, createdAt: 1, content: { assetId: 'a' } } as unknown as Obj
  const objs: Obj[] = [inner, sticker, card({ id: 'bc', type: 'board', content: { boardId: 'inner' } })]
  const clip = collectClip(['bc'], { get: (id) => objs.find((o) => o.id === id), all: () => objs, rect: () => null })
  if (!clip || clip === 'too-big') throw new Error('no clip')
  let n = 0
  const out = materialise(clip, { at: { x: 0, y: 0 }, boardId: 'b', maxZ: 0, now: 2, newId: () => `n${++n}` })
  const copy = out.objects.find((o) => o.kind === 'board')!
  expect(out.objects.find((o) => o.kind === 'sticker')).toMatchObject({ boardId: copy.id })
})

describe('copyBoardTree', () => {
  // A board with a note, a column holding two cards, a nested board holding a note, and a line.
  const b = (id: string, parentId: string | null, extra = {}) => ({ id, kind: 'board', parentId, title: id, icon: 'paw', color: 'none', createdAt: 1, ...extra }) as unknown as Board
  const objs: Obj[] = [
    b('home', null, { labelNameaaaaaaaaaaaa: 'Urgent', labelColoraaaaaaaaaaaa: 'gold' }),
    b('inner', 'home'),
    card({ id: 'n1', boardId: 'home', labelaaaaaaaaaaaa: true }),
    card({ id: 'col', boardId: 'home', type: 'column', content: { title: 'Todo' } }),
    card({ id: 'm1', boardId: 'home', columnId: 'col', order: 1 }),
    card({ id: 'm2', boardId: 'home', columnId: 'col', order: 2 }),
    card({ id: 'bc', boardId: 'home', type: 'board', content: { boardId: 'inner' }, x: 5000, y: 5000 }),
    card({ id: 'deep', boardId: 'inner', content: { md: 'deep' } }),
    { id: 'line', kind: 'connection', boardId: 'home', from: 'n1', to: 'col', createdAt: 1 } as Obj,
  ]
  const src = { get: (id: string) => objs.find((o) => o.id === id), all: () => objs, rect: () => null }

  for (const onBoard of ['home', 'elsewhere']) {
    it(`copies every card, column member and nested board${onBoard === 'home' ? ', even onto the board it copies' : ''}`, () => {
      let n = 0
      const out = copyBoardTree('home', src, { onBoard, at: { x: 0, y: 0 }, maxZ: 0, now: 2, newId: () => `x${++n}` })
      if (!out || out === 'too-big') throw new Error('no copy')
      const root = out.board.id
      expect(out.card).toMatchObject({ boardId: onBoard, content: { boardId: root } })
      expect(out.board).toMatchObject({ parentId: onBoard, labelNameaaaaaaaaaaaa: 'Urgent' })
      const on = (id: string) => out.objects.filter((o) => (o as Card).boardId === id && o.id !== out.card.id)
      // Nothing lands back on the original board.
      expect(on('home')).toEqual([])
      expect(on(root).map((o) => o.kind + ':' + ((o as Card).type ?? ''))).toEqual(['card:column', 'card:note', 'card:note', 'card:note', 'card:board', 'connection:'])
      const col = on(root).find((o) => (o as Card).type === 'column')!
      expect(on(root).filter((o) => (o as Card).columnId === col.id)).toHaveLength(2)
      expect(on(root).find((o) => (o as unknown as Record<string, unknown>).labelaaaaaaaaaaaa === true)).toBeTruthy()
      const inner = out.objects.find((o) => o.kind === 'board' && o.id !== root) as Board
      expect(inner.parentId).toBe(root)
      expect(on(inner.id)).toEqual([expect.objectContaining({ content: { md: 'deep' } })])
    })
  }
})

it('a clip carries the source board’s labels that its cards use', () => {
  const board = { id: 'b', kind: 'board', parentId: null, title: 'B', icon: 'paw', color: 'none', createdAt: 1, labelNameaaaaaaaaaaaa: 'Lighting', labelColoraaaaaaaaaaaa: 'gold', labelNamecccccccccccc: 'Unused', labelColorcccccccccccc: 'sky' } as unknown as Board
  const objs: Obj[] = [board, card({ labelaaaaaaaaaaaa: true })]
  const clip = collectClip(['c'], { get: (id) => objs.find((o) => o.id === id), all: () => objs, rect: () => null })
  if (!clip || clip === 'too-big') throw new Error('no clip')
  expect(clip.labels).toEqual([{ id: 'aaaaaaaaaaaa', name: 'Lighting', color: 'gold' }])
  expect(parseClip(JSON.stringify(clip))?.labels).toEqual(clip.labels)
})
