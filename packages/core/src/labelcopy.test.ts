import { expect, it } from 'vitest'
import { MAX_LABELS, cardLabelIds, labelDefinitions, parseLabels, planLabelCopy, relabel, relabelPatch, type Label } from './labels.ts'
import { collectClip, materialise, parseClip } from './clip.ts'
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

it('a clip carries the source board’s labels that its cards use', () => {
  const board = { id: 'b', kind: 'board', parentId: null, title: 'B', icon: 'paw', color: 'none', createdAt: 1, labelNameaaaaaaaaaaaa: 'Lighting', labelColoraaaaaaaaaaaa: 'gold', labelNamecccccccccccc: 'Unused', labelColorcccccccccccc: 'sky' } as unknown as Board
  const objs: Obj[] = [board, card({ labelaaaaaaaaaaaa: true })]
  const clip = collectClip(['c'], { get: (id) => objs.find((o) => o.id === id), all: () => objs, rect: () => null })
  if (!clip || clip === 'too-big') throw new Error('no clip')
  expect(clip.labels).toEqual([{ id: 'aaaaaaaaaaaa', name: 'Lighting', color: 'gold' }])
  expect(parseClip(JSON.stringify(clip))?.labels).toEqual(clip.labels)
})
