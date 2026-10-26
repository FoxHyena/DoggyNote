import { describe, expect, it } from 'vitest'
import { alignmentUnits, changesPosition, distributableUnits, planAlignment, planDistribution, positionLocks, type Alignment } from './position.ts'
import { type Card } from './model.ts'
import { invert } from './patch.ts'
const card = (id: string, x: number, y: number, w = 100, h = 60, extra: Partial<Card> = {}): Card => ({ id, kind: 'card', type: 'note', boardId: 'b', x, y, w, h, z: 1, color: 'none', content: { md: id }, createdAt: 1, ...extra })
const cards = [card('a', -20, 30, 81, 61), card('b', 200, 100, 120, 95), card('c', 400, -40, 63, 80)]
const rect = (list: Card[]) => (id: string) => list.find((c) => c.id === id) ?? null

describe('selection alignment contract', () => {
  it.each<Alignment>(['left', 'center-x', 'right', 'top', 'center-y', 'bottom'])('%s uses selection envelope and preserves the other axis', (mode) => {
    const result = planAlignment(cards, ['a', 'b', 'c'], rect(cards), mode)
    const aligned = cards.map((c) => ({ ...c, ...result.patches[c.id] }))
    const value = (c: Card) => mode === 'left' ? c.x : mode === 'right' ? c.x + c.w : mode === 'center-x' ? c.x + c.w / 2 : mode === 'top' ? c.y : mode === 'bottom' ? c.y + c.h : c.y + c.h / 2
    expect(new Set(aligned.map(value)).size).toBe(1)
    expect(aligned.map((c) => mode.includes('x') || ['left', 'right'].includes(mode) ? c.y : c.x)).toEqual(cards.map((c) => mode.includes('x') || ['left', 'right'].includes(mode) ? c.y : c.x))
    const tx = Object.entries(result.patches).map(([id, after]) => ({ id, before: Object.fromEntries(Object.keys(after).map((k) => [k, (cards.find((c) => c.id === id)! as unknown as Record<string, unknown>)[k]])), after }))
    const undone = aligned.map((c) => ({ ...c, ...invert(tx).find((ch) => ch.id === c.id)?.after }))
    expect(undone).toEqual(cards)
  })
  it('keeps locked reference geometry in the union and changes only movable units', () => {
    const list = cards.map((c) => ({ ...c, positionLocked: c.id === 'c' }))
    expect(planAlignment(list, list.map((c) => c.id), rect(list), 'right').patches).toEqual({ a: { x: 382 }, b: { x: 343 } })
    expect(planAlignment(list.map((c) => ({ ...c, positionLocked: true })), ['a', 'b'], rect(list), 'top').patches).toEqual({})
  })
  it('deduplicates selected column/member, never detaches, and pins the whole family', () => {
    const list = [card('col', 20, 40, 280, 400, { type: 'column' }), card('child', 0, 0, 260, 60, { columnId: 'col', positionLocked: true }), card('sibling', 0, 0, 260, 60, { columnId: 'col' }), cards[1]]
    expect(alignmentUnits(list, ['col', 'child', 'b']).map((c) => c.id)).toEqual(['col', 'b'])
    expect([...positionLocks(list)].sort()).toEqual(['child', 'col', 'sibling'])
    expect(planAlignment(list, ['child', 'b'], rect(list), 'top').patches).toEqual({ b: { y: 40 } })
  })
  it('inherits column lock; ignores deleted locks and malformed rects', () => {
    const list = [card('col', 0, 0, 280, 400, { type: 'column', positionLocked: true }), card('child', 0, 0, 260, 60, { columnId: 'col' }), card('gone', 0, 0, 10, 10, { positionLocked: true, deletedAt: 1 })]
    expect([...positionLocks(list)].sort()).toEqual(['child', 'col'])
    expect(planAlignment(cards, ['a', 'b'], () => ({ x: NaN, y: 1, w: 5, h: 6 }), 'left').patches).toEqual({})
  })
  it('accepts an effective collapsed/creative envelope and fractional coordinates without grid rounding', () => {
    const result = planAlignment(cards, ['a', 'b'], (id) => id === 'a' ? { ...cards[0], h: 58 } : cards[1], 'center-y')
    expect(result.patches).toEqual({ a: { y: 83.5 }, b: { y: 65 } })
    expect(planAlignment(cards, ['a'], rect(cards), 'left').patches).toEqual({})
  })
  it('distinguishes explicit position changes from content and natural height reflow', () => {
    expect(changesPosition(cards[0], { content: { md: 'new' }, h: 999, positionLocked: true })).toBe(false)
    expect(changesPosition(cards[0], { x: cards[0].x })).toBe(false)
    expect(changesPosition(cards[0], { w: 99 })).toBe(true)
    expect(changesPosition(cards[0], { columnId: 'other' })).toBe(true)
  })
})

describe('selection distribution', () => {
  const row = [card('a', 0, 10, 100), card('b', 130, 50, 40), card('c', 400, -20, 80), card('d', 600, 0, 100)]
  const gaps = (list: Card[], horizontal: boolean) => {
    const sorted = [...list].sort((p, q) => (horizontal ? p.x - q.x : p.y - q.y))
    return sorted.slice(1).map((c, i) => horizontal ? c.x - (sorted[i].x + sorted[i].w) : c.y - (sorted[i].y + sorted[i].h))
  }
  it('spaces units with equal gaps, keeps the ends, and touches only that axis', () => {
    const result = planDistribution(row, row.map((c) => c.id), rect(row), 'horizontal')
    const after = row.map((c) => ({ ...c, ...result.patches[c.id] }))
    const g = gaps(after, true)
    for (const x of g) expect(x).toBeCloseTo(g[0], 9)
    expect(g[0]).toBeCloseTo((700 - 320) / 3, 9)
    expect(result.patches.a).toBeUndefined()
    expect(result.patches.d).toBeUndefined()
    expect(Object.values(result.patches).every((p) => Object.keys(p).join() === 'x')).toBe(true)
  })
  it('distributes vertically by height', () => {
    const col = [card('a', 0, 0, 100, 50), card('b', 50, 60, 100, 100), card('c', 10, 300, 100, 20)]
    const result = planDistribution(col, ['a', 'b', 'c'], rect(col), 'vertical')
    expect(result.patches).toEqual({ b: { y: 125 } })
    const after = col.map((c) => ({ ...c, ...result.patches[c.id] }))
    expect(gaps(after, false)).toEqual([75, 75])
  })
  it('needs three movable units; already even is a no-op', () => {
    expect(planDistribution(row, ['a', 'b'], rect(row), 'horizontal').patches).toEqual({})
    const even = [card('a', 0, 0), card('b', 150, 0), card('c', 300, 0)]
    expect(planDistribution(even, ['a', 'b', 'c'], rect(even), 'horizontal').patches).toEqual({})
  })
  it('leaves locked units out: they neither move nor take a slot', () => {
    const list = row.map((c) => ({ ...c, positionLocked: c.id === 'c' }))
    expect(distributableUnits(list, list.map((c) => c.id)).map((c) => c.id)).toEqual(['a', 'b', 'd'])
    const result = planDistribution(list, list.map((c) => c.id), rect(list), 'horizontal')
    expect(result.locked).toBe(1)
    expect(result.patches.c).toBeUndefined()
    expect(result.patches).toEqual({ b: { x: 330 } })
    const twoFree = row.map((c) => ({ ...c, positionLocked: c.id !== 'a' && c.id !== 'b' }))
    expect(planDistribution(twoFree, row.map((c) => c.id), rect(twoFree), 'horizontal').patches).toEqual({})
  })
  it('moves a column as one unit and is undone by one inverse', () => {
    const list = [card('col', 0, 0, 280, 400, { type: 'column' }), card('child', 0, 0, 260, 60, { columnId: 'col' }), card('m', 300, 0, 100), card('z', 1000, 0, 100)]
    const result = planDistribution(list, ['child', 'm', 'z'], rect(list), 'horizontal')
    expect(Object.keys(result.patches)).toEqual(['m'])
    expect(result.patches.m!.x).toBeCloseTo(280 + (1100 - 480) / 2, 9)
    const tx = Object.entries(result.patches).map(([id, after]) => ({ id, before: Object.fromEntries(Object.keys(after).map((k) => [k, (list.find((c) => c.id === id)! as unknown as Record<string, unknown>)[k]])), after }))
    const moved = list.map((c) => ({ ...c, ...result.patches[c.id] }))
    expect(moved.map((c) => ({ ...c, ...invert(tx).find((ch) => ch.id === c.id)?.after }))).toEqual(list)
  })
})
