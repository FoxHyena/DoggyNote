import { createMemo, createRoot } from 'solid-js'
import { alignmentUnits, planAlignment, positionLocks, isAreaItem, areaFamily, isArea, type Alignment, type Id, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'
import { boardId, endEdit, selection } from './ui.ts'
import { rectOf } from '../canvas/layout.ts'
import { showToast } from './toast.ts'

// Reads only lock/membership metadata, not geometry; pan/drag doesn't rebuild it.
export const lockedPositions = createRoot(() => createMemo(() => positionLocks(Object.values(doc.objs).filter(isAreaItem))))
export const isPositionLocked = (id: Id) => lockedPositions().has(id)
export const selectedAlignmentUnits = () => alignmentUnits(doc.cardsOn(boardId()), selection())
export function lockSelection(locked: boolean) {
  endEdit()
  const patches: Record<Id, Partial<Obj>> = {}
  for (const id of selection()) if (doc.getCard(id) && doc.canWriteObject(doc.get(id))) patches[id] = { positionLocked: locked }
  doc.update(patches)
  showToast(locked ? 'Position locked. Content is still editable.' : 'Position unlocked.')
}
export function unlockSelectionLayouts() {
  const families = new Set([...selection()].flatMap((id) => {
    const c = doc.getCard(id)
    return c ? [c.columnId || c.id, ...(isArea(c) ? areaFamily(c, doc.cardsOn(c.boardId)).map(item => item.id) : [])] : []
  }))
  const patches: Record<Id, Partial<Obj>> = {}
  for (const c of doc.cardsOn(boardId())) if (families.has(c.columnId || c.id) && c.positionLocked === true) patches[c.id] = { positionLocked: false }
  doc.update(patches)
  showToast('Column layout unlocked.')
}
export function alignSelection(mode: Alignment) {
  endEdit()
  const result = planAlignment(doc.cardsOn(boardId()), selection(), rectOf, mode)
  doc.update(result.patches)
  showToast(result.locked ? `${result.locked} locked ${result.locked === 1 ? 'unit stayed' : 'units stayed'} in place. ${Object.keys(result.patches).length} aligned.` : Object.keys(result.patches).length ? 'Aligned. Undo restores the previous positions.' : 'Already aligned.', 5000, Object.keys(result.patches).length ? { label: 'Undo', run: () => doc.undo() } : null)
}
export function nudgeSelection(dx: number, dy: number) {
  const patches: Record<Id, Partial<Obj>> = {}
  let locked = 0
  for (const c of selectedAlignmentUnits()) {
    if (isPositionLocked(c.id)) { locked++; continue }
    patches[c.id] = { ...(dx ? { x: c.x + dx } : {}), ...(dy ? { y: c.y + dy } : {}) }
  }
  doc.update(patches)
  if (locked) showToast('Locked positions stayed in place. Unlock in the selection toolbar.')
}
