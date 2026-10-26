import { describe, expect, it } from 'vitest'
import { noteDocument, noteState, replaceText } from './collaboration.ts'
import { canSyncNote, holdsAll, isLiveSynced, mergeNoteStates, syncedSiblings, syncIdOf } from './synced.ts'
import { materialise } from './clip.ts'
import type { Card } from './model.ts'

const note = (id: string, extra: Partial<Card> = {}) => ({ id, kind: 'card', type: 'note', boardId: 'b1', x: 0, y: 0, w: 200, h: 60, z: 1, color: 'none', createdAt: 1, content: { md: '' }, ...extra }) as Card
const edit = (state: string, text: string) => {
  const doc = noteDocument(state)
  replaceText(doc.getText('markdown'), text)
  try { return noteState(doc) } finally { doc.destroy() }
}

describe('synced notes', () => {
  it('merges two copies of one history without doubling text', () => {
    const base = edit('', 'Walk the dog')
    const a = edit(base, 'Walk the dog at 6')
    const b = edit(base, 'Please walk the dog')
    expect(mergeNoteStates([a, b]).md).toBe('Please walk the dog at 6')
    expect(mergeNoteStates([a, a, null]).md).toBe('Walk the dog at 6')
  })

  it('two unrelated documents would double, which is why only clones may join', () => {
    expect(mergeNoteStates([edit('', 'Hi'), edit('', 'Hi')]).md).toBe('HiHi')
  })

  it('knows when a copy already holds the merged state', () => {
    const base = edit('', 'Bone')
    const merged = mergeNoteStates([base, edit(base, 'Bones')]).state
    expect(holdsAll(merged, merged)).toBe(true)
    expect(holdsAll(base, merged)).toBe(false)
    // A deletion doesn't move the state vector; the text still tells them apart.
    expect(holdsAll(base, mergeNoteStates([base, edit(base, 'Bon')]).state)).toBe(false)
    expect(holdsAll(null, merged)).toBe(false)
  })

  it('finds live siblings only', () => {
    const cards = [note('a', { syncId: 'a' }), note('b', { syncId: 'a' }), note('c', { syncId: 'a', deletedAt: 3 }), note('d', { syncId: 'x' }), note('e')]
    expect(syncedSiblings(cards, cards[0]).map((c) => c.id)).toEqual(['b'])
    expect(syncedSiblings(cards, cards[4])).toEqual([])
    expect(isLiveSynced(cards[2])).toBe(false)
    expect(syncIdOf({ ...note('t'), type: 'todo', syncId: 'a' } as never)).toBeNull()
  })

  it('never syncs a note in a Toy box', () => {
    expect(canSyncNote(note('a'))).toBe(true)
    expect(canSyncNote(note('a', { boardId: 'toybox:rex' }))).toBe(false)
    expect(canSyncNote(note('a', { deletedAt: 1 }))).toBe(false)
  })

  it('pasted and duplicated copies start independent', () => {
    let n = 0
    const { objects } = materialise({ boardId: 'b1', roots: ['a'], objects: [note('a', { syncId: 'a' })] } as never, { at: { x: 0, y: 0 }, boardId: 'b2', maxZ: 0, now: 1, newId: () => `n${n++}` })
    expect((objects[0] as Card).syncId).toBeUndefined()
  })
})
