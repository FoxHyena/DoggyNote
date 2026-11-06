import { beforeEach, expect, it, vi } from 'vitest'
import { planBoardMove, type Card, type Connection, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'
import { removalWithoutRestore } from './syncRemovals.ts'
vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))
beforeEach(async () => { await doc.resetLocal(); await doc.load({ persist: true, readOnly: false }); doc.setWriteGuard(() => true) })
it('retains a crossing connection’s real nullable Undo patch when an older purge snapshot arrives', () => {
  const a: Card = { id: 'a', kind: 'card', type: 'todo', boardId: 'source', x: 0, y: 0, w: 200, h: 80, z: 1, color: 'none', content: { title: 'Moves', items: [] }, createdAt: 1 }
  const b = { ...a, id: 'b', x: 300 }
  const connection: Connection = { id: 'line', kind: 'connection', boardId: 'source', from: 'a', to: 'b', arrow: 'end', createdAt: 1 }
  const objects: Obj[] = [a, b, connection, ...['source', 'target'].map(id => ({ id, kind: 'board' as const, parentId: null, title: id, icon: 'paw' as const, color: 'gold' as const, createdAt: 1 }))]
  doc.reconcileSnapshot(objects, () => false)
  const plan = planBoardMove({ objects, ids: ['a'], destination: 'target', rect: () => null, canWrite: () => true, canManage: () => true })
  expect(plan.ok).toBe(true)
  if (!plan.ok) return
  doc.update(plan.patches)
  const delayedTombstone = { ...doc.get('line')! }
  doc.ackOutbox(doc.pendingOutbox())
  doc.undo()
  const pending = doc.pendingOutbox().find(change => change.id === 'line')!.patch
  expect(pending.purged).toBeNull()
  expect(removalWithoutRestore(delayedTombstone, pending)).toBe(false)
  expect(removalWithoutRestore(delayedTombstone, { arrow: 'none' })).toBe(true)
})
it('keeps privacy revocations distinct from restoration and still sends explicit removals', () => {
  expect(removalWithoutRestore({ hidden: true }, { purged: false })).toBe(true)
  expect(removalWithoutRestore({ deletedAt: 100 }, { deletedAt: null })).toBe(false)
  expect(removalWithoutRestore({ deletedAt: 100 }, { deletedAt: 200 })).toBe(false)
  expect(removalWithoutRestore({ purged: true }, { purged: true })).toBe(false)
  expect(removalWithoutRestore({ purged: true }, { noteRestore: true })).toBe(false)
  expect(removalWithoutRestore({ purged: true }, { purged: false, noteUpdate: 'stale note text' })).toBe(true)
  expect(removalWithoutRestore({ purged: true }, undefined)).toBe(true)
})
