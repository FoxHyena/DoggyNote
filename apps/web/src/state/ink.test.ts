import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inkBounds, type Card, type Stroke } from '@doggynote/core'
import * as doc from './doc.ts'
import * as idb from './idb.ts'
vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: vi.fn(async () => {}), clearAll: async () => {} }))
const image: Card<'image'> = { id: 'qa-image', kind: 'card', type: 'image', boardId: 'qa-board', x: 0, y: 0, w: 400, h: 300, z: 1, color: 'none', createdAt: 1, content: { assetId: '', width: 800, height: 600 } }
const stroke = (id: string, extra: Partial<Stroke> = {}): Stroke => {
  const points = [{ x: 20, y: 20 }, { x: 200, y: 100 }]
  return { id, kind: 'stroke', boardId: image.boardId, cardId: image.id, createdAt: 1, tool: 'pen', color: '#D7263D', width: 6, opacity: 1, points, order: 1, bounds: inkBounds(points, 6), ...extra }
}
beforeEach(async () => {
  await doc.load({ persist: false, readOnly: false })
  doc.setWriteGuard(() => true)
  doc.loadSnapshot([{ id: image.boardId, kind: 'board', parentId: null, title: 'QA', icon: 'paw', color: 'none', createdAt: 1 }, image, stroke('a'), stroke('b')])
})
describe('drawing transactions and recovery', () => {
  it('undoes a whole erase gesture without removing a concurrent addition', () => {
    doc.update({ a: { deletedAt: 10 }, b: { deletedAt: 10 } })
    expect(doc.canUndoDrawing(image.id)).toBe(true)
    doc.receiveRemote([stroke('remote')])
    doc.undo()
    expect(doc.get('a')?.deletedAt).toBeNull()
    expect(doc.get('b')?.deletedAt).toBeNull()
    expect(doc.get('remote')).toEqual(stroke('remote'))
    doc.redo()
    expect(doc.get('a')?.deletedAt).toBe(10)
    expect(doc.get('b')?.deletedAt).toBe(10)
    expect(doc.get('remote')).toEqual(stroke('remote'))
  })
  it('does not clear a newer collaborator erasure or partially restore a gesture', () => {
    doc.update({ a: { deletedAt: 10 }, b: { deletedAt: 10 } })
    doc.receiveRemote([stroke('a', { deletedAt: 20 })])
    doc.undo()
    expect(doc.get('a')?.deletedAt).toBe(20)
    expect(doc.get('b')?.deletedAt).toBe(10)
    expect(doc.canUndoDrawing(image.id)).toBe(true)
  })
  it('does not expose unrelated board history as drawing Undo', () => {
    doc.update({ [image.id]: { x: 100 } })
    expect(doc.canUndoDrawing(image.id)).toBe(false)
    doc.commit([doc.createChange(stroke('new'))])
    expect(doc.canUndoDrawing(image.id)).toBe(true)
    doc.undo()
    expect(doc.canUndoDrawing(image.id)).toBe(false)
    expect(doc.canRedoDrawing(image.id)).toBe(true)
    doc.redo()
    expect(doc.get('new')?.purged).toBe(false)
  })
  it('keeps marks editable on a position-locked owner and retains geometry through owner trash', () => {
    doc.update({ [image.id]: { positionLocked: true } })
    doc.commit([doc.createChange(stroke('locked-edit'))])
    expect(doc.get('locked-edit')).toMatchObject(stroke('locked-edit'))
    doc.update({ [image.id]: { deletedAt: 10 } })
    expect(doc.getCard(image.id)?.deletedAt).toBe(10)
    expect(doc.get('locked-edit')).toMatchObject(stroke('locked-edit'))
    doc.undo()
    expect(doc.get('locked-edit')).toMatchObject(stroke('locked-edit'))
  })
  it('retains a completed stroke and its outgoing patch when device storage fails, then retries', async () => {
    await doc.load({ persist: true, readOnly: false })
    doc.loadSnapshot([image])
    vi.mocked(idb.putDocument).mockRejectedValueOnce(new Error('Synthetic storage failure'))
    doc.commit([doc.createChange(stroke('durable'))])
    await expect(doc.flush()).rejects.toThrow('Synthetic storage failure')
    expect(doc.localSaveError()).toContain('could not be saved')
    expect(doc.get('durable')?.kind).toBe('stroke')
    expect(doc.pendingOutbox().some((p) => p.id === 'durable')).toBe(true)
    await doc.flush()
    expect(doc.localSaveError()).toBeNull()
    expect(vi.mocked(idb.putDocument).mock.calls.at(-1)?.[0].some(([id]) => id === 'durable')).toBe(true)
    doc.ackOutbox(doc.pendingOutbox())
    await doc.flush()
    await doc.resetLocal()
  })
})
