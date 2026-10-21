import { beforeEach, describe, expect, it } from 'vitest'
import { duplicateObjects, inkBounds, type Card, type Stroke } from '@doggynote/core'
import * as doc from './doc.ts'

const paper = (): Card<'sketch'> => ({ id: 'sketch', kind: 'card', type: 'sketch', boardId: 'qa', x: 10, y: 20, w: 320, h: 240, z: 1, color: 'none', createdAt: 1, content: { title: '', width: 320, height: 240, background: 'paper' } })
const stroke = (id: string, order = 1): Stroke => {
  const points = [{ x: 20, y: 30 }, { x: 100, y: 150 }]
  return { id, kind: 'stroke', boardId: 'qa', cardId: 'sketch', tool: 'pen', color: '#D7263D', width: 6, opacity: 1, points, bounds: inkBounds(points, 6), order, createdAt: 1 }
}
beforeEach(async () => {
  await doc.load({ persist: false, readOnly: false }); doc.setWriteGuard(() => true)
  doc.loadSnapshot([{ id: 'qa', kind: 'board', parentId: null, title: 'QA', icon: 'paw', color: 'none', createdAt: 1 }, paper()])
})

describe('sketch document integration', () => {
  it('undoes one local stroke while preserving a concurrent remote addition', () => {
    doc.commit([doc.createChange(stroke('mine'))])
    doc.receiveRemote([stroke('theirs', 2)])
    expect(doc.get('mine')).toMatchObject(stroke('mine'))
    expect(doc.get('theirs')).toEqual(stroke('theirs', 2))
    expect(doc.canUndoDrawing('sketch')).toBe(true)
    doc.undo()
    expect(doc.get('mine')!.purged).toBe(true)
    expect(doc.get('theirs')).toEqual(stroke('theirs', 2))
    doc.redo()
    expect(doc.get('mine')!.purged).toBe(false)
    expect(doc.get('theirs')).toEqual(stroke('theirs', 2))
  })
  it('restores one continuous erase transaction without overwriting a newer addition', () => {
    doc.receiveRemote([stroke('first'), stroke('second', 2)])
    doc.update({ first: { deletedAt: 10 }, second: { deletedAt: 10 } })
    doc.receiveRemote([stroke('third', 3)])
    expect(doc.get('first')!.deletedAt).toBe(10)
    expect(doc.get('second')!.deletedAt).toBe(10)
    expect(doc.get('third')).toEqual(stroke('third', 3))
    doc.undo()
    expect(doc.get('first')!.deletedAt).toBeNull()
    expect(doc.get('second')!.deletedAt).toBeNull()
    expect(doc.get('third')).toEqual(stroke('third', 3))
  })
  it('keeps editable stroke identities through recoverable owner trash', () => {
    doc.receiveRemote([stroke('saved')])
    doc.update({ sketch: { deletedAt: 10 } })
    expect(doc.getCard('sketch')!.deletedAt).toBe(10)
    expect(doc.get('saved')).toEqual(stroke('saved'))
    doc.undo()
    expect(doc.getCard('sketch')!.deletedAt).toBeNull()
    expect(doc.get('saved')).toEqual(stroke('saved'))
  })
  it('allows title sessions and ink while locked, but refuses explicit two-axis resize', () => {
    doc.update({ sketch: { positionLocked: true } })
    const before = doc.snapshot('sketch', ['content'])
    doc.transient('sketch', { content: { ...paper().content, title: 'Opening frame' } })
    doc.commitFrom({ sketch: before })
    doc.update({ sketch: { w: 640, h: 480 } })
    doc.commit([doc.createChange(stroke('locked-ink'))])
    expect(doc.getCard('sketch')).toMatchObject({ w: 320, h: 240, positionLocked: true, content: { title: 'Opening frame' } })
    expect(doc.get('locked-ink')).toMatchObject(stroke('locked-ink'))
    doc.undo(); doc.undo()
    expect(doc.getCard('sketch')!.content).toEqual(paper().content)
  })
  it('cannot add or erase sketch marks through a read-only document store', async () => {
    doc.receiveRemote([stroke('existing')])
    await doc.load({ persist: false, readOnly: true })
    doc.commit([doc.createChange(stroke('denied'))]); doc.update({ existing: { deletedAt: 10 } })
    expect(doc.get('denied')).toBeUndefined()
    expect(doc.get('existing')).toEqual(stroke('existing'))
  })
  it('keeps an independent copied sketch when a collaborator adds a mark before creation Undo', () => {
    doc.receiveRemote([stroke('source-mark')])
    const copy = duplicateObjects(Object.values(doc.objs), { selectionIds: ['sketch'], targetBoardId: 'qa' })
    const owner = copy.objects.find((o) => o.kind === 'card')!
    const mark = copy.objects.find((o) => o.kind === 'stroke')!
    doc.commit(copy.objects.map(doc.createChange))
    doc.undo()
    expect(doc.get(owner.id)?.purged).toBe(true)
    expect(doc.get(mark.id)?.purged).toBe(true)
    doc.redo()
    const peer = { ...stroke('peer-copy-mark'), cardId: owner.id }
    doc.receiveRemote([peer])
    doc.undo()
    expect(doc.get(owner.id)?.purged).toBe(false)
    expect(doc.get(mark.id)?.purged).toBe(false)
    expect(doc.get(peer.id)).toEqual(peer)
    expect(doc.get('source-mark')).toEqual(stroke('source-mark'))
    expect(doc.getCard('sketch')).toEqual(paper())
  })
})
