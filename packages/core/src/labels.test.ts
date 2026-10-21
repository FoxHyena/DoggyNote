import { describe, expect, it } from 'vitest'
import { boardLabels, cardLabels, remapCardLabels, validLabelField } from './labels.ts'
import { agentObjectSchema } from './agent.ts'
import type { Board, Card } from './model.ts'
const one = 'a'.repeat(32), two = 'b'.repeat(32), three = 'c'.repeat(32)
const board = { id: 'source', kind: 'board', parentId: null, title: 'Research', color: 'none', icon: 'paw', createdAt: 1, [`labelName${one}`]: 'Lighting', [`labelColor${one}`]: 'sky' } as Board
const card = { id: 'card', kind: 'card', type: 'note', boardId: board.id, createdAt: 1, x: 0, y: 0, w: 260, h: 100, z: 1, color: 'none', content: { md: 'A real reference' }, [`label${one}`]: true } as Card<'note'>
describe('board-owned label identity', () => {
  it('renames and recolors all uses without modifying memberships; deletion is reversible', () => {
    expect(cardLabels(card, board)).toEqual([{ id: one, name: 'Lighting', color: 'sky' }])
    const renamed = { ...board, [`labelName${one}`]: 'Lighting references', [`labelColor${one}`]: 'gold' } as Board
    expect(cardLabels(card, renamed)[0]).toEqual({ id: one, name: 'Lighting references', color: 'gold' })
    expect(cardLabels(card, { ...renamed, [`labelName${one}`]: null })).toEqual([])
    expect(cardLabels(card, board)).toHaveLength(1)
    expect(cardLabels(card, { ...board, id: 'unrelated' })).toEqual([])
  })
  it('does not mistake duplicate names for shared identities or trust malformed metadata', () => {
    const duplicates = { ...board, [`labelName${two}`]: 'Lighting', [`labelColor${two}`]: 'invalid', [`labelName${three}`]: { bad: true } } as unknown as Board
    expect(boardLabels(duplicates)).toHaveLength(2)
    expect(cardLabels(card, duplicates)).toHaveLength(1)
    expect(boardLabels(duplicates).find((l) => l.id === two)?.color).toBe('none')
    expect(boardLabels({ ...board, deletedAt: 1 })).toEqual([])
  })
  it('reuses destination name deliberately, preserving destination identity and color', () => {
    const destination = { ...board, id: 'target', [`labelName${one}`]: null, [`labelName${two}`]: ' lighting ', [`labelColor${two}`]: 'gold' } as Board
    const mapped = remapCardLabels([card], board, destination)
    expect(mapped.board).toEqual({})
    expect(mapped.cards.card).toEqual({ [`label${one}`]: null, [`label${two}`]: true })
  })
  it('maps several cards to one independent definition without altering the source', () => {
    const destination = { ...board, id: 'target', [`labelName${one}`]: null } as Board
    const mapped = remapCardLabels([card, { ...card, id: 'second' }], board, destination, () => three)
    expect(mapped.board).toEqual({ [`labelName${three}`]: 'Lighting', [`labelColor${three}`]: 'sky' })
    expect(mapped.cards.second).toEqual(mapped.cards.card)
    expect(cardLabels(card, board)[0]?.id).toBe(one)
  })
  it('strictly validates placement, values, safe field names, and tombstones', () => {
    expect(validLabelField('board', `labelName${one}`, 'Lighting')).toBe(true)
    expect(validLabelField('board', `labelName${one}`, null)).toBe(true)
    expect(validLabelField('card', `label${one}`, false)).toBe(true)
    for (const [kind, key, value] of [['card', `labelName${one}`, 'x'], ['board', `label${one}`, true], ['board', `labelColor${one}`, '#fff'], ['board', `labelName${one}`, ' '], ['board', `labelName${one}`, 'x'.repeat(81)], ['card', 'labelbad', true]]) expect(validLabelField(kind, key as string, value)).toBe(false)
  })
  it('agent replacements preserve labels while rejecting unknown or malformed fields', () => {
    expect(agentObjectSchema.parse(board)).toEqual(board)
    expect(agentObjectSchema.parse(card)).toEqual(card)
    expect(agentObjectSchema.safeParse({ ...card, [`label${two}`]: 'yes' }).success).toBe(false)
    expect(agentObjectSchema.safeParse({ ...board, [`label${two}`]: true }).success).toBe(false)
    expect(agentObjectSchema.safeParse({ ...card, ownerId: 'attacker' }).success).toBe(false)
  })
})
