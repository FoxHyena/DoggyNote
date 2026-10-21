import { describe, expect, it } from 'vitest'
import { COLUMN_HEADER, columnMembers, isColumnCollapsed, visibleEndpoint } from './columns.ts'
import { applyPatch, diff, UndoStack } from './patch.ts'
import type { Card } from './model.ts'
import { planAlignment } from './position.ts'

const column: Card<'column'> = { id: 'column', kind: 'card', type: 'column', boardId: 'board', x: 10, y: 20, w: 280, h: 1600, z: 1, color: 'none', content: { title: 'References' }, createdAt: 1 }
const child = (id: string, extra: Partial<Card> = {}): Card => ({ ...column, id, type: 'note', columnId: column.id, content: { md: id }, ...extra })

describe('column presentation contract', () => {
  it('counts only live direct members on the same board in deterministic order', () => {
    const cards = [child('b', { order: 2 }), child('a', { order: 2 }), child('first', { order: 1 }), child('trash', { deletedAt: 10 }), child('purged', { purged: true }), child('elsewhere', { boardId: 'other' }), child('nested', { columnId: 'other' })]
    expect(columnMembers(column, cards).map((c) => c.id)).toEqual(['first', 'a', 'b'])
  })
  it('collapses through one independent undo field without touching expanded geometry or member content/order', () => {
    const kid = child('reference', { order: 42 })
    const original = structuredClone(kid)
    const tx = diff(column, { collapsed: true })!
    expect(tx.after).toEqual({ collapsed: true })
    const stack = new UndoStack()
    stack.push([tx])
    let current = applyPatch(column, tx.after) as Card
    expect(isColumnCollapsed(current)).toBe(true)
    expect(current.h).toBe(1600)
    current = applyPatch(current, stack.undo()![0]!.after) as Card
    expect(isColumnCollapsed(current)).toBe(false)
    current = applyPatch(current, stack.redo()![0]!.after) as Card
    expect(isColumnCollapsed(current)).toBe(true)
    expect(kid).toEqual(original)
    expect(COLUMN_HEADER).toBe(58)
  })
  it('bottom alignment keeps a lower movable edge as the target and uses the locked collapsed header when it is lowest', () => {
    // Fixture coordinates with a deterministic 42px note: bottom142 versus118.
    // A family lock does not make its edge an unconditional alignment target.
    const col: Card = { ...column, x: 60, y: 60, h: 1800, collapsed: true }
    const first = child('first', { order: 1, positionLocked: true, h: 42 })
    const second = child('second', { order: 2, h: 42 })
    const nearby: Card = { ...child('nearby'), columnId: null, x: 420, y: 100, h: 42 }
    const cards = [col, first, second, nearby]
    const original = structuredClone(cards)
    const effectiveRect = (list: Card[]) => (id: string) => {
      const card = list.find(c => c.id === id)
      return card ? { x: card.x, y: card.y, w: card.w, h: isColumnCollapsed(card) ? COLUMN_HEADER : card.h } : null
    }
    const selected = cards.map(card => card.id)
    expect(planAlignment(cards, selected, effectiveRect(cards), 'bottom')).toEqual({ patches: {}, units: 2, locked: 1 })

    // Put the movable note above the header, as the real-input regression does.
    const above = cards.map(card => card.id === nearby.id ? { ...card, y: 40 } : card)
    const plan = planAlignment(above, selected, effectiveRect(above), 'bottom')
    expect(plan).toEqual({ patches: { nearby: { y: 76 } }, units: 2, locked: 1 })
    const aligned = above.map(card => ({ ...card, ...plan.patches[card.id] }))
    expect(aligned.find(card => card.id === nearby.id)!.y + nearby.h).toBe(col.y + COLUMN_HEADER)
    expect(aligned.slice(0, 3)).toEqual(original.slice(0, 3))
    expect(columnMembers(col, aligned).map(card => [card.id, card.order])).toEqual([['first', 1], ['second', 2]])
    expect(aligned[0]!.h).toBe(1800)

    const change = diff(above[3]!, plan.patches.nearby!)!
    const history = new UndoStack()
    history.push([change])
    expect(applyPatch(aligned[3]!, history.undo()![0]!.after)).toEqual(above[3])
    expect(cards).toEqual(original)
  })
  it('projects external connections onto the collapsed column and restores the original child endpoint', () => {
    const kid = child('reference')
    let col: Card = { ...column, collapsed: true }
    const get = (id: string) => id === col.id ? col : id === kid.id ? kid : undefined
    expect(visibleEndpoint(kid.id, get)).toBe(col.id)
    col = { ...col, collapsed: false }
    expect(visibleEndpoint(kid.id, get)).toBe(kid.id)
    col = { ...col, deletedAt: 10 }
    expect(visibleEndpoint(kid.id, get)).toBeNull()
    expect(visibleEndpoint('missing', get)).toBeNull()
  })
  it('treats malformed synced collapse values as expanded and supports view-only projection', () => {
    expect(isColumnCollapsed({ ...column, collapsed: 'yes' } as unknown as Card)).toBe(false)
    expect(isColumnCollapsed({ ...child('note'), collapsed: true })).toBe(false)
    const kid = child('reference')
    expect(visibleEndpoint(kid.id, (id) => id === kid.id ? kid : column, () => true)).toBe(column.id)
  })
})
