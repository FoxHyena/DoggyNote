import { beforeEach, describe, expect, it } from 'vitest'
import { canvasInkEnvelope, duplicateObjects, inkBounds, isInkMark, type Board, type Card, type Stroke } from '@doggynote/core'
import * as doc from './doc.ts'

const board: Board = { id: 'ink-qa', kind: 'board', parentId: null, title: 'Ink QA', icon: 'paw', color: 'none', createdAt: 1 }
function gesture(id: string): [Card<'ink'>, Stroke] {
  const { rect, points } = canvasInkEnvelope([{ x: -50, y: 80 }, { x: 100, y: 140 }], 6)!
  const card: Card<'ink'> = { id, kind: 'card', type: 'ink', boardId: board.id, ...rect, z: 1, color: 'none', columnId: null, content: { width: rect.w, height: rect.h }, createdAt: 1 }
  const stroke: Stroke = { id: `${id}-stroke`, kind: 'stroke', cardId: id, boardId: board.id, points, width: 6, tool: 'pen', color: '#D7263D', opacity: 1, order: 1, bounds: inkBounds(points, 6), createdAt: 1 }
  return [card, stroke]
}
function creativeGesture(id: string, type: 'image' | 'sketch' | 'ink'): [Card, Stroke] {
  const [card, stroke] = gesture(id)
  if (type === 'image') return [{ ...card, type, content: { ...card.content, assetId: 'qa-image' } }, stroke]
  if (type === 'sketch') return [{ ...card, type, content: { ...card.content, title: 'QA sketch', background: 'paper' } }, stroke]
  return [card, stroke]
}
beforeEach(async () => {
  await doc.load({ persist: false, readOnly: false })
  doc.setWriteGuard(() => true)
  doc.reconcileSnapshot([structuredClone(board)], () => false)
})

describe('canvas ink document integration', () => {
  it('treats one gesture as one undo boundary without undoing another session’s ink', () => {
    const local = gesture('local'), remote = gesture('remote')
    doc.commit(local.map(doc.createChange))
    doc.receiveRemote(remote)
    doc.undo()
    for (const o of local) expect(doc.get(o.id)?.purged).toBe(true)
    for (const o of remote) expect(doc.get(o.id)).toEqual(o)
    doc.redo()
    for (const o of local) expect(doc.get(o.id)).toMatchObject(o)
    for (const o of remote) expect(doc.get(o.id)).toEqual(o)
  })
  it('clones the actual typed ink graph with independent editable marks and one undo boundary', () => {
    const [owner, stroke] = gesture('original')
    doc.receiveRemote([owner, stroke])
    const copy = duplicateObjects([board, owner, stroke], { selectionIds: [owner.id], targetBoardId: board.id })
    const copiedOwner = copy.objects.find((o): o is Card<'ink'> => o.kind === 'card' && o.type === 'ink')!
    const copiedStroke = copy.objects.find((o): o is Stroke => o.kind === 'stroke')!
    expect(copiedStroke.cardId).toBe(copiedOwner.id)
    expect(copiedStroke.points).toEqual(stroke.points)
    expect(copiedStroke.points).not.toBe(stroke.points)
    expect(copiedOwner).toMatchObject({ x: owner.x + 32, y: owner.y + 32, content: owner.content, columnId: null })
    doc.commit(copy.objects.map(doc.createChange))
    doc.undo()
    for (const o of copy.objects) expect(doc.get(o.id)?.purged).toBe(true)
    expect(doc.get(stroke.id)).toEqual(stroke)
    doc.redo()
    expect(doc.get(copiedStroke.id)).toMatchObject(copiedStroke)
    doc.update({ [copiedStroke.id]: { deletedAt: 20 } })
    expect(doc.get(stroke.id)).toEqual(stroke)
  })
  it('restores the envelope and final stroke together after erasure', () => {
    const [owner, stroke] = gesture('erased')
    doc.receiveRemote([owner, stroke])
    doc.update({ [stroke.id]: { deletedAt: 30 }, [owner.id]: { deletedAt: 30 } })
    const remote = gesture('later')
    doc.receiveRemote(remote)
    doc.undo()
    expect(doc.get(owner.id)).toMatchObject({ ...owner, deletedAt: null })
    expect(doc.get(stroke.id)).toMatchObject({ ...stroke, deletedAt: null })
    for (const o of remote) expect(doc.get(o.id)).toEqual(o)
  })
  it.each(['image', 'sketch', 'ink'] as const)('keeps a later collaborator stroke when undoing %s owner creation', (type) => {
    const [owner, stroke] = creativeGesture(`shared-created-${type}`, type)
    doc.commit([owner, stroke].map(doc.createChange))
    const remote = { ...stroke, id: 'new-shared-stroke', order: 2 }
    expect(isInkMark(remote)).toBe(true)
    doc.receiveRemote([remote])
    doc.undo()
    expect(doc.get(owner.id)?.purged).not.toBe(true)
    expect(doc.get(stroke.id)?.purged).not.toBe(true)
    expect(doc.get(stroke.id)?.deletedAt).toBeUndefined()
    expect(doc.get(remote.id)?.deletedAt).toBeUndefined()
    expect(doc.get(remote.id)).toEqual(remote)
  })
  it.each(['image', 'sketch', 'ink'] as const)('does not redo owner-only %s burial across a later collaborator stroke', (type) => {
    const [owner, stroke] = creativeGesture(`shared-restored-${type}`, type)
    doc.receiveRemote([owner, stroke])
    doc.update({ [owner.id]: { deletedAt: 30 } })
    doc.undo()
    const remote = { ...stroke, id: 'new-restored-stroke', order: 2 }
    expect(isInkMark(remote)).toBe(true)
    doc.receiveRemote([remote])
    doc.redo()
    expect(doc.get(owner.id)?.deletedAt).toBeNull()
    expect(doc.get(stroke.id)?.deletedAt).toBeUndefined()
    expect(doc.get(remote.id)).toEqual(remote)
  })
  it('retains legacy owner-only Bury Undo/Redo and does not resurrect earlier erasures', () => {
    const [owner, stroke] = gesture('buried')
    const erased = { ...stroke, id: 'already-erased', deletedAt: 7 }
    doc.receiveRemote([owner, stroke, erased])
    doc.update({ [owner.id]: { deletedAt: 30 } })
    doc.undo()
    expect(doc.get(owner.id)?.deletedAt).toBeNull()
    expect(doc.get(stroke.id)?.deletedAt).toBeUndefined()
    doc.redo()
    expect(doc.get(owner.id)?.deletedAt).toBe(30)
    expect(doc.get(stroke.id)?.deletedAt).toBeUndefined()
    doc.undo()
    expect(doc.get(owner.id)?.deletedAt).toBeNull()
    expect(doc.get(stroke.id)?.deletedAt).toBeUndefined()
    expect(doc.get(erased.id)?.deletedAt).toBe(7)
  })
  it('retains the owner child snapshot for history recorded through commitFrom', () => {
    const [owner, stroke] = gesture('checkpoint-burial')
    doc.receiveRemote([owner, stroke])
    const snapshot = { [owner.id]: doc.snapshot(owner.id, ['deletedAt']) }
    doc.transient(owner.id, { deletedAt: 30 })
    expect(doc.commitFrom(snapshot)).toBe(true)
    doc.undo()
    doc.redo()
    expect(doc.get(owner.id)?.deletedAt).toBe(30)
    doc.undo()
    const remote = { ...stroke, id: 'checkpoint-peer-stroke', order: 2 }
    doc.receiveRemote([remote])
    doc.redo()
    expect(doc.get(owner.id)?.deletedAt).toBeNull()
    expect(doc.get(remote.id)).toEqual(remote)
  })
  it('protects all actual copied graph objects when a peer annotates its copied owner', () => {
    const [owner, stroke] = gesture('copy-original')
    doc.receiveRemote([owner, stroke])
    const copy = duplicateObjects([board, owner, stroke], { rootBoardId: board.id })
    doc.commit(copy.objects.map(doc.createChange))
    const copied = copy.objects.find((o): o is Stroke => o.kind === 'stroke')!
    const remote = { ...copied, id: 'peer-copied-stroke', order: 2 }
    expect(isInkMark(remote)).toBe(true)
    doc.receiveRemote([remote])
    doc.undo()
    for (const object of copy.objects) expect(doc.get(object.id)?.purged).not.toBe(true)
    expect(doc.get(copied.id)?.deletedAt).toBeUndefined()
    expect(doc.get(remote.id)).toEqual(remote)
    expect(doc.get(stroke.id)).toEqual(stroke)
  })
  it('allows whole copied graph creation Undo/Redo when all owned marks are removed atomically', () => {
    const [owner, stroke] = gesture('atomic-original')
    doc.receiveRemote([owner, stroke])
    const copy = duplicateObjects([board, owner, stroke], { rootBoardId: board.id })
    doc.commit(copy.objects.map(doc.createChange))
    doc.undo()
    for (const object of copy.objects) expect(doc.get(object.id)?.purged).toBe(true)
    doc.redo()
    for (const object of copy.objects) expect(doc.get(object.id)).toMatchObject(object)
    expect(doc.get(stroke.id)).toEqual(stroke)
  })
  it('ignores invalid, foreign-board and already erased children for owner creation Undo', () => {
    const [owner, stroke] = gesture('ignored-children')
    doc.commit([owner, stroke].map(doc.createChange))
    doc.receiveRemote([
      { ...stroke, id: 'invalid-child', points: [] },
      { ...stroke, id: 'foreign-child', boardId: 'other-board' },
      { ...stroke, id: 'erased-child', deletedAt: 7 },
      { ...stroke, id: 'purged-child', purged: true },
    ])
    doc.undo()
    expect(doc.get(owner.id)?.purged).toBe(true)
    expect(doc.get(stroke.id)?.purged).toBe(true)
  })
  it('keeps the geometry and exact stroke-tombstone guards active alongside owner history', () => {
    const [owner, stroke] = gesture('other-guards')
    const initialX = owner.x
    doc.receiveRemote(structuredClone([owner, stroke]))
    doc.update({ [owner.id]: { x: initialX + 20 } })
    doc.receiveRemote([{ ...owner, x: initialX + 99 }])
    doc.undo()
    expect(doc.getCard(owner.id)?.x).toBe(initialX + 99)
    doc.update({ [stroke.id]: { deletedAt: 30 } })
    doc.receiveRemote([{ ...stroke, deletedAt: 40 }])
    doc.undo()
    expect(doc.get(stroke.id)?.deletedAt).toBe(40)
  })
})
