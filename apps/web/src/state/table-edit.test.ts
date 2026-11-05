import { beforeEach, expect, it, vi } from 'vitest'
import { cellKey, setCells, starterTable, tableColumns, tableRows, type Card, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'
vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))

// Editing a table must not hold back other people's cell edits (no busy flag) and
// must not turn the whole card into one undo step (it has no content snapshot).

vi.stubGlobal('location', { hash: '', pathname: '/' })
vi.stubGlobal('window', { addEventListener() {} })
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
const ui = await import('./ui.ts')

const card = (type: string, extra: Record<string, unknown> = {}): Card => ({ id: type, kind: 'card', type, boardId: 'qa-board', x: 0, y: 0, w: 420, h: 140, z: 1, color: 'none', createdAt: 1, content: type === 'table' ? { title: '' } : { md: 'hi' }, ...extra } as unknown as Card)

beforeEach(async () => {
  await doc.load({ persist: false, readOnly: false })
  doc.setWriteGuard(() => true)
  doc.loadSnapshot([{ id: 'qa-board', kind: 'board', parentId: null, title: 'QA', icon: 'paw', color: 'none', createdAt: 1 }, card('table', starterTable(['A', 'B', 'C'])), card('todo', { content: { title: 'T', items: [] } })] as Obj[])
})

it('remote cell edits keep arriving while a table is being edited, and each action is its own undo step', () => {
  ui.beginEdit('table')
  expect(ui.editingId()).toBe('table')
  const t = doc.get('table') as unknown as Record<string, unknown>
  const [r0, r1] = tableRows(t), [c0, c1] = tableColumns(t)
  doc.update({ table: setCells(t, [{ row: r0!.id, col: c0!.id, value: 'mine' }]) })
  // A pull lands mid-edit: with the card busy it would wait until the edit ended.
  doc.receiveRemote([{ ...(doc.get('table') as Obj), [cellKey(r1!.id, c1!.id)]: 'theirs' } as unknown as Obj])
  expect((doc.get('table') as unknown as Record<string, unknown>)[cellKey(r1!.id, c1!.id)]).toBe('theirs')
  ui.endEdit()
  expect(ui.editingId()).toBeNull()
  const after = doc.get('table') as unknown as Record<string, unknown>
  expect(after[cellKey(r0!.id, c0!.id)]).toBe('mine')
  expect(after[cellKey(r1!.id, c1!.id)]).toBe('theirs')
  // Ending the edit added no undo step of its own: one undo takes back the one action.
  doc.undo()
  const undone = doc.get('table') as unknown as Record<string, unknown>
  expect(undone[cellKey(r0!.id, c0!.id)] ?? null).toBeNull()
  expect(undone[cellKey(r1!.id, c1!.id)]).toBe('theirs')
})

it('other card types still hold remote rows back while they are edited', () => {
  ui.beginEdit('todo')
  doc.receiveRemote([{ ...(doc.get('todo') as Obj), x: 99 } as unknown as Obj])
  expect(doc.getCard('todo')!.x).toBe(0)
  ui.endEdit()
  expect(doc.getCard('todo')!.x).toBe(99)
})

it('checkpoints and ending a table edit send nothing of their own', () => {
  ui.beginEdit('table', { isNew: true })
  ui.checkpointEdit()
  ui.endEdit()
  expect(doc.pendingOutbox()).toEqual([])
})
