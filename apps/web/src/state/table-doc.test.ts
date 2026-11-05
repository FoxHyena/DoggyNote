import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cellKey, colKey, rowKey, setCells, starterTable, tableColumns, tableRows, type Card, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'
import { toast, setToast } from './toast.ts'
vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))

// A table's rows, columns and cells are fields of the card. Undo must not put an
// old value back over what someone else has since written to that same field.

const table = (): Card => ({ id: 't', kind: 'card', type: 'table', boardId: 'qa-board', x: 0, y: 0, w: 420, h: 140, z: 1, color: 'none', createdAt: 1, content: { title: '' }, ...starterTable(['A', 'B', 'C']) } as unknown as Card)
const grid = () => {
  const card = doc.get('t') as unknown as Record<string, unknown>
  return { card, row: tableRows(card).map((r) => r.id), col: tableColumns(card).map((c) => c.id) }
}
const value = (row: string, col: string) => (doc.get('t') as unknown as Record<string, unknown>)[cellKey(row, col)]

beforeEach(async () => {
  await doc.load({ persist: false, readOnly: false })
  doc.setWriteGuard(() => true)
  doc.loadSnapshot([{ id: 'qa-board', kind: 'board', parentId: null, title: 'QA', icon: 'paw', color: 'none', createdAt: 1 }, table()] as Obj[])
  setToast(null)
})

describe('undoing a table edit', () => {
  it('puts the old value back when nobody else touched the cell', () => {
    const { card, row, col } = grid()
    doc.update({ t: setCells(card, [{ row: row[0]!, col: col[0]!, value: 'mine' }]) })
    expect(value(row[0]!, col[0]!)).toBe('mine')
    doc.undo()
    expect(value(row[0]!, col[0]!) ?? null).toBeNull()
    doc.redo()
    expect(value(row[0]!, col[0]!)).toBe('mine')
  })

  it('is refused, with the toast, when someone else changed that cell since', () => {
    const { card, row, col } = grid()
    doc.update({ t: setCells(card, [{ row: row[0]!, col: col[0]!, value: 'mine' }]) })
    doc.receiveRemote([{ ...(doc.get('t') as Obj), [cellKey(row[0]!, col[0]!)]: 'theirs' } as unknown as Obj])
    doc.undo()
    expect(value(row[0]!, col[0]!)).toBe('theirs')
    expect(toast()).toMatch(/Cannot undo/)
  })

  it('still works when the other person changed a different cell', () => {
    const { card, row, col } = grid()
    doc.update({ t: setCells(card, [{ row: row[0]!, col: col[0]!, value: 'mine' }]) })
    doc.receiveRemote([{ ...(doc.get('t') as Obj), [cellKey(row[1]!, col[1]!)]: 'theirs' } as unknown as Obj])
    doc.undo()
    expect(value(row[0]!, col[0]!) ?? null).toBeNull()
    expect(value(row[1]!, col[1]!)).toBe('theirs')
    expect(toast()).toBeNull()
  })

  it('is refused when a row or column I changed was removed by someone else', () => {
    const { card, row, col } = grid()
    doc.update({ t: { [rowKey(row[0]!)]: { o: 50 } } })
    doc.receiveRemote([{ ...(doc.get('t') as Obj), [rowKey(row[0]!)]: null } as unknown as Obj])
    doc.undo()
    expect((doc.get('t') as unknown as Record<string, unknown>)[rowKey(row[0]!)] ?? null).toBeNull()
    expect(toast()).toMatch(/Cannot undo/)
    setToast(null)
    doc.update({ t: { [colKey(col[0]!)]: { n: 'Renamed', o: 1, w: 1, t: 'text' } } })
    void card
    doc.undo()
    expect(tableColumns(doc.get('t') as unknown as Record<string, unknown>)[0]!.n).toBe('A')
    expect(toast()).toBeNull()
  })

  it('undoes redo the same way after a remote edit', () => {
    const { card, row, col } = grid()
    doc.update({ t: setCells(card, [{ row: row[2]!, col: col[2]!, value: 'x' }]) })
    doc.undo()
    doc.receiveRemote([{ ...(doc.get('t') as Obj), [cellKey(row[2]!, col[2]!)]: 'theirs' } as unknown as Obj])
    doc.redo()
    expect(value(row[2]!, col[2]!)).toBe('theirs')
    expect(toast()).toMatch(/Cannot redo/)
  })
})
