import { beforeEach, expect, it, vi } from 'vitest'
import type { Board, Card } from '@doggynote/core'
import * as doc from './doc.ts'
import { moveDestinations, moveItemsToBoard, moveItemsToNewBoard, moveSelectionProblem } from './boardMoves.ts'
import { select, selection } from './ui.ts'

vi.mock('./ui.ts', async () => {
  const { createSignal } = await import('solid-js')
  const [selection, set] = createSignal<ReadonlySet<string>>(new Set())
  return { boardId: () => 'source', endEdit: () => {}, selection, select: (ids: Iterable<string>) => set(new Set(ids)) }
})
vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))
vi.mock('./access.ts', () => ({ canReadBoard: () => true, canManageBoard: () => true }))
vi.mock('./copies.ts', () => ({ inTemplate: (id: string) => id === 'template' }))
vi.mock('../canvas/layout.ts', () => ({ rectOf: () => null }))
const board = (id: string, extra: Partial<Board> = {}): Board => ({ id, kind: 'board', parentId: null, title: id, icon: 'paw', color: 'gold', createdAt: 1, ...extra })
const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, kind: 'card', type: 'todo', boardId: 'source', x: 200, y: 150, w: 200, h: 80, z: 1, color: 'none', content: { title: id, items: [] }, createdAt: 1, ...extra })
beforeEach(async () => {
  vi.restoreAllMocks()
  await doc.resetLocal()
  await doc.load({ persist: false, readOnly: false }); doc.setWriteGuard(() => true)
  doc.reconcileSnapshot([board('source'), board('target'), card('a'), card('b', { x: 500, y: 200 })], () => false)
  select(['a', 'b'])
})
it('moves a group in one undo step, preserves identity and clears the moved selection', () => {
  expect(moveItemsToBoard(['a', 'b'], 'target').ok).toBe(true)
  expect(doc.getCard('a')).toMatchObject({ boardId: 'target', x: 0, y: 0 })
  expect(doc.getCard('b')).toMatchObject({ boardId: 'target', x: 300, y: 50 })
  expect(selection().size).toBe(0)
  doc.undo()
  expect(doc.getCard('a')).toMatchObject({ boardId: 'source', x: 200, y: 150 })
  expect(doc.getCard('b')).toMatchObject({ boardId: 'source', x: 500, y: 200 })
  doc.redo(); expect(doc.getCard('a')!.boardId).toBe('target')
})
it('creates a named board and source tile in the same transaction as the move', () => {
  const result = moveItemsToNewBoard(['a', 'b'], '  Weekend plans  ')
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(doc.getBoard(result.destination)).toMatchObject({ title: 'Weekend plans', parentId: 'source' })
  const tile = Object.values(doc.objs).find((c): c is Card => c.kind === 'card' && c.type === 'board' && c.boardId === 'source')!
  expect(tile).toMatchObject({ x: 200, y: 150, content: { boardId: result.destination } })
  expect(doc.getCard('a')!.boardId).toBe(result.destination)
  doc.undo()
  expect(doc.getCard('a')!.boardId).toBe('source')
  expect(doc.getBoard(result.destination)!.purged).toBe(true)
  expect(doc.getCard(tile.id)!.purged).toBe(true)
  doc.redo()
  expect(doc.getCard('a')!.boardId).toBe(result.destination)
  expect(doc.getCard(tile.id)!.purged).toBe(false)
})
it('rejects locks and revoked permissions atomically without creating a board or moving other items', () => {
  doc.reconcileSnapshot([board('source'), board('target'), card('a'), card('b', { positionLocked: true })], () => false)
  expect(moveSelectionProblem(['a', 'b'])).toContain('Unlock')
  expect(moveItemsToNewBoard(['a', 'b'], 'Rejected').ok).toBe(false)
  expect(Object.values(doc.objs).filter(o => o.kind === 'board')).toHaveLength(2)
  expect(doc.getCard('a')!.boardId).toBe('source')
  doc.setWriteGuard(o => o.id !== 'target')
  expect(moveItemsToBoard(['a'], 'target').ok).toBe(false)
  expect(moveItemsToNewBoard(['a'], '   ').ok).toBe(false)
})
it('maps labels by name and restores source flags and destination definitions with Undo', () => {
  doc.reconcileSnapshot([board('source', { labelNameaaaaaaaaaaaa: 'Walk', labelColoraaaaaaaaaaaa: 'gold' } as Partial<Board>), board('target'), card('a', { labelaaaaaaaaaaaa: true } as Partial<Card>)], () => false)
  expect(moveItemsToBoard(['a'], 'target').ok).toBe(true)
  expect(Object.values(doc.getBoard('target')!)).toContain('Walk')
  doc.undo()
  expect(doc.getCard('a')!.boardId).toBe('source')
  expect(Object.values(doc.getBoard('target')!)).not.toContain('Walk')
})
it('filters destinations before ranking, including descendants, templates and inaccessible boards', () => {
  doc.reconcileSnapshot([board('source'), board('nested', { parentId: 'source' }), board('descendant', { parentId: 'nested' }), board('local', { createdAt: 2 }), board('remote', { createdAt: 100 }), board('template'), board('toybox:me'), board('view'), board('buried', { deletedAt: 1 }), card('a', { type: 'board', content: { boardId: 'nested' } }), card('local-tile', { type: 'board', content: { boardId: 'local' } })], () => false)
  // Node's Solid build freezes memos. Feed the adapter the current browser index.
  vi.spyOn(doc, 'index').mockReturnValue({ ...doc.index(), boards: Object.values(doc.objs).filter((o): o is Board => o.kind === 'board' && !o.deletedAt && !o.purged) })
  vi.spyOn(doc, 'cardsOn').mockImplementation(id => Object.values(doc.objs).filter((o): o is Card => o.kind === 'card' && o.boardId === id && !o.deletedAt && !o.purged))
  doc.setWriteGuard(o => o.id !== 'view')
  expect(moveDestinations(['a'], '').map(b => b.id)).toEqual(['local', 'remote'])
})

it('permits a move into a board created in the transaction only when its parent is writable', () => {
  const writable = new Set(['source', 'target'])
  doc.setWriteGuard(o => writable.has(o.kind === 'board' ? o.id : o.boardId))
  const result = moveItemsToNewBoard(['a'], 'Created atomically')
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(doc.getCard('a')!.boardId).toBe(result.destination)
  writable.add(result.destination)
  doc.undo(); expect(doc.getCard('a')!.boardId).toBe('source')
  doc.redo(); expect(doc.getCard('a')!.boardId).toBe(result.destination)
})

it('rejects a destination at its label limit without losing memberships or moving any item', async () => {
  const { MAX_LABELS } = await import('@doggynote/core')
  const fields = Object.fromEntries(Array.from({ length: MAX_LABELS }, (_, i) => {
    const id = String(i).padStart(12, 'b')
    return [[`labelName${id}`, `Existing ${i}`], [`labelColor${id}`, 'gold']]
  }).flat())
  doc.reconcileSnapshot([board('source', { labelNameaaaaaaaaaaaa: 'Travel', labelColoraaaaaaaaaaaa: 'gold' } as Partial<Board>), board('target', fields as Partial<Board>), card('a', { labelaaaaaaaaaaaa: true } as Partial<Card>), card('b')], () => false)
  const result = moveItemsToBoard(['a', 'b'], 'target')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toContain('labels')
  expect(doc.getCard('a')).toMatchObject({ boardId: 'source', labelaaaaaaaaaaaa: true })
  expect(doc.getCard('b')!.boardId).toBe('source')
})
