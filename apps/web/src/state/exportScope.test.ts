import { describe, expect, it } from 'vitest'
import type { Card } from '@doggynote/core'
import { exportCardIds, exportRootIds } from './exportScope.ts'
const card = (id: string, columnId: string | null = null, type: 'note' | 'column' = 'note'): Card => ({ id, kind: 'card', type, boardId: 'qa', x: 10, y: 20, w: 260, h: 100, z: 1, color: 'none', content: type === 'column' ? { title: 'Frames' } : { md: id }, createdAt: 1, columnId })
const cards = [card('column', null, 'column'), card('first', 'column'), card('second', 'column'), card('free')]
describe('PNG selection scope', () => {
  it('exports a selected member without requiring its column or unrelated members', () => {
    const roots = exportRootIds(cards, 'selection', new Set(['first']))
    expect(roots).toEqual(['first'])
    expect([...exportCardIds(cards, roots)]).toEqual(['first'])
  })
  it('renders a selected column once even when its members are also selected', () => {
    const roots = exportRootIds(cards, 'selection', new Set(['column', 'first', 'second']))
    expect(roots).toEqual(['column'])
    expect([...exportCardIds(cards, roots)]).toEqual(['column', 'first', 'second'])
  })
  it('retains board roots and connections between visible column members', () => {
    const roots = exportRootIds(cards, 'board', new Set())
    expect(roots).toEqual(['column', 'free'])
    expect([...exportCardIds(cards, roots)]).toEqual(['column', 'free', 'first', 'second'])
  })
  it('supports mixed child/free selections and ignores non-card selections without changing membership', () => {
    expect(exportRootIds(cards, 'selection', new Set(['first', 'free', 'connection']))).toEqual(['first', 'free'])
    expect(exportRootIds(cards, 'selection', new Set(['connection']))).toEqual([])
    expect(cards[1]!.columnId).toBe('column')
  })
})
