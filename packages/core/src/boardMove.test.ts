import { describe, expect, it } from 'vitest'
import { boardMoveFamily, planBoardMove, rankMoveBoards, type BoardMoveInput } from './boardMove.ts'
import type { Board, Card, Obj, Sticker } from './model.ts'
import { stickerBounds } from './stickers.ts'

const board = (id: string, extra: Partial<Board> = {}): Board => ({ id, kind: 'board', parentId: null, title: id, color: 'gold', icon: 'paw', createdAt: 1, ...extra })
const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, kind: 'card', type: 'todo', boardId: 'source', x: 100, y: 150, w: 200, h: 80, z: 1, color: 'none', content: { title: id, items: [] }, createdAt: 1, ...extra })
const plan = (items: Obj[], ids: string[] = ['a'], extra: Partial<BoardMoveInput> = {}) => planBoardMove({ objects: [board('source'), board('target'), ...items], ids, destination: 'target', rect: () => null, canWrite: () => true, canManage: () => true, ...extra })

describe('moving board selections', () => {
  it('preserves group shape and relative stacking, appending beside occupied destination bounds', () => {
    const result = plan([card('a'), card('b', { x: 360, y: 200, z: 5 }), card('existing', { boardId: 'target', x: -100, y: -80, w: 300, z: 9 })], ['a', 'b'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patches.a).toMatchObject({ boardId: 'target', x: 264, y: -80, z: 10, columnId: null, areaId: null })
    expect(result.patches.b).toMatchObject({ x: 524, y: -30, z: 11 })
    expect(result.patches.a).not.toHaveProperty('content')
  })
  it('deduplicates an area, its column and children, and carries stickers with local coordinates intact', () => {
    const area = card('area', { type: 'area', w: 800, h: 480 }), col = card('col', { type: 'column', areaId: 'area', x: 20, y: 60 }), child = card('a', { columnId: 'col' })
    const sticker = { ...card('s'), kind: 'sticker', areaId: 'area', angle: 0, content: { width: 100, height: 100 } } as unknown as Sticker
    const objects = [area, col, child, sticker]
    expect(boardMoveFamily(objects, ['area', 'col', 'a', 's']).roots.map(o => o.id)).toEqual(['area'])
    const result = plan(objects, ['area', 'col', 'a', 's'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ids.sort()).toEqual(['a', 'area', 'col', 's'])
    expect(result.patches.area).toMatchObject({ x: 0, y: 0 })
    for (const id of ['col', 'a', 's']) expect(result.patches[id]).toEqual({ boardId: 'target' })
  })
  it('detaches a selected column child at its measured world position', () => {
    const result = plan([card('col', { type: 'column' }), card('a', { columnId: 'col' }), card('b', { x: 700, y: 900 })], ['a', 'b'], { rect: id => id === 'a' ? { x: 120, y: 210, w: 180, h: 100 } : null })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.patches.a).toMatchObject({ x: 0, y: 0, columnId: null })
      expect(result.patches.b).toMatchObject({ x: 580, y: 690 })
      expect(result.patches).not.toHaveProperty('col')
    }
  })
  it('keeps rotated sticker origins relative to the group rather than moving their bounding-box corners', () => {
    const s = { id: 's', kind: 'sticker', boardId: 'source', x: 350, y: 200, w: 120, angle: 90, z: 5, content: { width: 200, height: 100 }, createdAt: 1 } as Sticker
    const result = plan([card('a'), s], ['a', 's'], { rect: id => id === 's' ? stickerBounds(s) : null })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.patches.s).toMatchObject({ x: 250, y: 50 })
  })
  it('moves internal connections, removes crossing connections, and carries comments and strokes', () => {
    const connection = (id: string, from: string, to: string) => ({ id, kind: 'connection', boardId: 'source', from, to, createdAt: 1, arrow: 'end' }) as Obj
    const related = [{ id: 'comment', kind: 'comment', cardId: 'a', boardId: 'source', createdAt: 1 }, { id: 'stroke', kind: 'stroke', cardId: 'a', boardId: 'source', createdAt: 1 }] as Obj[]
    const result = plan([card('a'), card('b'), card('c'), connection('internal', 'a', 'b'), connection('external', 'a', 'c'), ...related], ['a', 'b', 'external'])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.patches.internal).toEqual({ boardId: 'target' })
      expect(result.patches.external).toEqual({ purged: true })
      expect(result.patches.comment).toEqual({ boardId: 'target' })
      expect(result.patches.stroke).toEqual({ boardId: 'target' })
    }
    expect(plan([], ['external']).ok).toBe(false)
  })
  it('reparents a carried board and refuses self, descendant and unmanageable destinations', () => {
    const tile = card('a', { type: 'board', content: { boardId: 'nested' } })
    const items = [tile, board('nested', { parentId: 'source' }), board('descendant', { parentId: 'nested' })]
    const result = plan(items)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.patches.nested).toEqual({ parentId: 'target' })
    expect(plan(items, ['a'], { destination: 'nested' }).ok).toBe(false)
    expect(plan(items, ['a'], { destination: 'descendant' }).ok).toBe(false)
    expect(plan(items, ['a'], { canManage: () => false }).ok).toBe(false)
  })
  it('rejects a complete selection for locks, permissions and unavailable destinations', () => {
    expect(plan([card('a'), card('b', { positionLocked: true })], ['a', 'b']).ok).toBe(false)
    expect(plan([card('col', { type: 'column' }), card('a', { columnId: 'col', positionLocked: true })], ['col']).ok).toBe(false)
    expect(plan([card('a'), card('b')], ['a', 'b'], { canWrite: o => o.id !== 'b' }).ok).toBe(false)
    expect(plan([card('a')], ['a'], { canWrite: o => o.id !== 'target' }).ok).toBe(false)
    expect(plan([card('a')], ['a'], { destination: 'source' }).ok).toBe(false)
    expect(plan([card('a')], ['a'], { destination: 'gone' }).ok).toBe(false)
  })
  it('supports the Inbox wrapper’s explicit point and column placements', () => {
    const items = [card('a'), card('col', { type: 'column', boardId: 'target' })]
    const at = plan(items, ['a'], { placement: { at: { x: 50, y: 70 } } })
    if (at.ok) expect(at.patches.a).toMatchObject({ x: 50, y: 70 })
    const into = plan(items, ['a'], { placement: { columnId: 'col', order: 3 } })
    expect(into.ok).toBe(true)
    if (into.ok) expect(into.patches.a).toMatchObject({ columnId: 'col', order: 3 })
  })
})

it('ranks local newest boards first, searches case-insensitively and prioritizes prefix matches', () => {
  const list = [board('other', { title: 'Other', createdAt: 30 }), board('old', { title: 'Walk plans', createdAt: 1 }), board('new', { title: 'Weekend walk', createdAt: 10 }), board('prefix', { title: 'Walk ideas', createdAt: 40 })]
  expect(rankMoveBoards(list, new Set(['old', 'new']), '').map(b => b.id)).toEqual(['new', 'old', 'prefix', 'other'])
  expect(rankMoveBoards(list, new Set(['new']), ' WALK ').map(b => b.id)).toEqual(['prefix', 'old', 'new'])
})
