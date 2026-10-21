import { beforeEach, expect, it, vi } from 'vitest'
import { boardLabels, cardLabels, type Board, type Card } from '@doggynote/core'
vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))
vi.mock('./access.ts', () => ({ canEditBoard: () => true }))
vi.mock('./ui.ts', () => ({ endEdit: () => {}, openBoard: () => {}, select: () => {} }))
let doc: typeof import('./doc.ts')
let copyNote: typeof import('./synced-notes.ts').copyNote
const sourceToken = 'a'.repeat(32), targetToken = 'b'.repeat(32)
const board = (id: string, extra = {}): Board => ({ id, kind: 'board', parentId: null, title: id, icon: 'paw', color: 'none', createdAt: 1, ...extra })
const source = { id: 'source', kind: 'card', type: 'note', boardId: 'origin', x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', createdAt: 1, content: { md: 'Shared brief' }, [`label${sourceToken}`]: true } as Card<'note'>
beforeEach(async () => {
  vi.resetModules()
  doc = await import('./doc.ts')
  copyNote = (await import('./synced-notes.ts')).copyNote
  await doc.load({ persist: true, readOnly: false })
})
for (const synced of [false, true]) for (const reuse of [false, true]) {
  it(`${synced ? 'linked' : 'independent'} cross-board copy ${reuse ? 'reuses destination identity' : 'creates destination definition'} atomically with Undo/Redo`, async () => {
    const origin = board('origin', { [`labelName${sourceToken}`]: 'Lighting', [`labelColor${sourceToken}`]: 'gold' })
    const destination = board('destination', reuse ? { [`labelName${targetToken}`]: ' lighting ', [`labelColor${targetToken}`]: 'sky' } : {})
    doc.loadSnapshot([origin, destination, structuredClone(source)])
    const id = copyNote(source.id, destination.id, synced)!
    expect(id).toBeTruthy()
    const copied = doc.getCard(id)!
    const labels = cardLabels(copied, doc.getBoard(destination.id))
    expect(labels).toHaveLength(1)
    expect(labels[0].id).not.toBe(sourceToken)
    if (reuse) expect(labels[0]).toMatchObject({ id: targetToken, color: 'sky' })
    else expect(labels[0]).toMatchObject({ name: 'Lighting', color: 'gold' })
    expect(doc.getCard(source.id)).toMatchObject({ [`label${sourceToken}`]: true, content: source.content })
    expect(doc.getBoard(origin.id)).toEqual(origin)
    expect(copied.noteGroupId ?? null).toBe(synced ? doc.getCard(source.id)!.noteGroupId : null)
    if (!reuse) expect(doc.pendingOutbox().find((p) => p.id === destination.id)?.patch).toHaveProperty(`labelName${labels[0].id}`, 'Lighting')
    doc.undo()
    expect(doc.getCard(id)?.purged).toBe(true)
    expect(boardLabels(doc.getBoard(destination.id))).toHaveLength(reuse ? 1 : 0)
    expect(doc.getCard(source.id)?.noteGroupId ?? null).toBeNull()
    doc.redo()
    expect(doc.getCard(id)?.purged).toBe(false)
    expect(cardLabels(doc.getCard(id)!, doc.getBoard(destination.id))).toHaveLength(1)
    await doc.flush()
  })
}
it('same-board copy keeps its existing label identity without writing definitions', async () => {
  doc.loadSnapshot([board('origin', { [`labelName${sourceToken}`]: 'Lighting', [`labelColor${sourceToken}`]: 'gold' }), structuredClone(source)])
  const id = copyNote(source.id, 'origin', false)!
  expect(cardLabels(doc.getCard(id)!, doc.getBoard('origin'))[0].id).toBe(sourceToken)
  expect(doc.pendingOutbox().some((p) => p.id === 'origin')).toBe(false)
  await doc.flush()
})
