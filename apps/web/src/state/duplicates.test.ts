import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { duplicateObjects, inkBounds, isAlive, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'
// Node has no mounted canvas; navigation/history use the actual UI/store modules.
vi.mock('../canvas/layout.ts', () => ({ rectOf: () => null }))
vi.mock('./access.ts', () => ({ canEditBoard: () => true, canReadBoard: () => true, homeBoardId: () => 'source' }))
vi.mock('./sync.ts', () => ({ syncNow: async () => {}, syncState: () => 'idle' }))
vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))

const source: Obj[] = [
  { id: 'source', kind: 'board', parentId: null, title: 'Storyboard', icon: 'paw', color: 'gold', createdAt: 1 },
  { id: 'sketch', kind: 'card', type: 'sketch', boardId: 'source', x: 20, y: 30, w: 320, h: 240, z: 1, positionLocked: true, color: 'none', content: { title: 'Opening frame', width: 320, height: 240, background: 'paper' }, createdAt: 1 },
  { id: 'stroke', kind: 'stroke', boardId: 'source', cardId: 'sketch', points: [{ x: 10, y: 20 }, { x: 200, y: 100 }], bounds: inkBounds([{ x: 10, y: 20 }, { x: 200, y: 100 }], 6), tool: 'pen', color: '#245FE5', width: 6, opacity: 1, order: 1, createdAt: 1 },
  ...['one', 'two'].map((id) => ({ id, kind: 'card', type: 'note', boardId: 'source', x: 400, y: 30, w: 260, h: 60, z: 1, color: 'none', content: { md: 'Shared source brief' }, noteGroupId: 'source-group', createdAt: 1 }) as Obj),
]
afterEach(() => vi.unstubAllGlobals())
beforeEach(async () => {
  vi.stubGlobal('location', { pathname: '/', hash: '#/b/source' })
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  await doc.load({ persist: false, readOnly: false })
  doc.setWriteGuard(() => true)
  doc.loadSnapshot(structuredClone(source))
})

it('one store Undo/Redo removes and restores a complete copied graph with locked creative owners and strokes', () => {
  const copy = duplicateObjects(source, { rootBoardId: 'source' })
  doc.commit(copy.objects.map(doc.createChange))
  expect(copy.objects.every((o) => isAlive(doc.get(o.id)))).toBe(true)
  expect(doc.get(copy.idMap.get('stroke')!)).toMatchObject({ cardId: copy.idMap.get('sketch'), boardId: copy.rootId, purged: false })
  doc.undo()
  expect(copy.objects.some((o) => isAlive(doc.get(o.id)))).toBe(false)
  expect(source.every((o) => isAlive(doc.get(o.id)))).toBe(true)
  doc.redo()
  expect(copy.objects.every((o) => isAlive(doc.get(o.id)))).toBe(true)
  expect((doc.get(copy.idMap.get('stroke')!) as Extract<Obj, { kind: 'stroke' }>).points).toEqual((source[2] as Extract<Obj, { kind: 'stroke' }>).points)
})

it('a remote regroup prevents old copy Undo from partially purging its board and creative objects', () => {
  const copy = duplicateObjects(source, { rootBoardId: 'source' })
  doc.commit(copy.objects.map(doc.createChange))
  const note = doc.getCard(copy.idMap.get('one')!)!
  doc.receiveRemote([{ ...note, noteGroupId: 'remote-group' }])
  doc.undo()
  expect(copy.objects.every((o) => isAlive(doc.get(o.id)))).toBe(true)
  expect(doc.getCard(note.id)?.noteGroupId).toBe('remote-group')
  expect(doc.get(copy.idMap.get('stroke')!)).toMatchObject({ cardId: copy.idMap.get('sketch'), boardId: copy.rootId, purged: false })
})


it('a refused copy-toast Undo keeps the copied board open with its collaborator stroke', async () => {
  const { openCreatedBoard } = await import('./duplicates.ts')
  const { boardId } = await import('./ui.ts')
  const { toast, toastAction } = await import('./toast.ts')
  const copy = duplicateObjects(source, { rootBoardId: 'source' })
  doc.commit(copy.objects.map(doc.createChange))
  openCreatedBoard(copy.rootId!, 'source')
  const originalStroke = copy.objects.find((object) => object.kind === 'stroke')!
  doc.receiveRemote([{ ...structuredClone(originalStroke), id: 'later-peer-stroke' }])
  expect(boardId()).toBe(copy.rootId)
  const action = toastAction()
  expect(action?.label).toBe('Undo')
  action!.run()
  expect(toast()).toContain('Cannot undo')
  expect(copy.objects.every((object) => isAlive(doc.get(object.id)))).toBe(true)
  expect(isAlive(doc.get('later-peer-stroke'))).toBe(true)
  expect(boardId()).toBe(copy.rootId)
})

it('a successful copy-toast Undo still returns to the source through the purged-root observer', async () => {
  const { openCreatedBoard } = await import('./duplicates.ts')
  const { boardId } = await import('./ui.ts')
  const { toastAction } = await import('./toast.ts')
  const copy = duplicateObjects(source, { rootBoardId: 'source' })
  doc.commit(copy.objects.map(doc.createChange))
  openCreatedBoard(copy.rootId!, 'source')
  expect(boardId()).toBe(copy.rootId)
  toastAction()!.run()
  expect(copy.objects.some((object) => isAlive(doc.get(object.id)))).toBe(false)
  expect(source.every((object) => isAlive(doc.get(object.id)))).toBe(true)
  expect(boardId()).toBe('source')
})

it('Undo from inside a copied nested board returns to the original after removing the whole tree', async () => {
  const { openCreatedBoard } = await import('./duplicates.ts')
  const { boardId, openBoard } = await import('./ui.ts')
  const nested: Obj = { id: 'nested-source', kind: 'board', parentId: 'source', title: 'Frame references', icon: 'paw', color: 'none', createdAt: 1 }
  const copy = duplicateObjects([...source, nested], { rootBoardId: 'source' })
  doc.commit(copy.objects.map(doc.createChange))
  openCreatedBoard(copy.rootId!, 'source')
  openBoard(copy.idMap.get(nested.id)!)
  doc.undo()
  expect(copy.objects.some((object) => isAlive(doc.get(object.id)))).toBe(false)
  expect(source.every((object) => isAlive(doc.get(object.id)))).toBe(true)
  expect(boardId()).toBe('source')
})
