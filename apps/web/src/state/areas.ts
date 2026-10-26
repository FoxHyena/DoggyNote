import { createSignal } from 'solid-js'
import { AREA_HEADER, AREA_PADDING, areaBurialFamily, areaFamily, areaMembers, planAreaTidy, isArea, isAreaItem, itemArea, newId, union, type Card, type CardType, type Id, type Obj, type Vec } from '@doggynote/core'
import * as doc from './doc.ts'
import { beginEdit, boardId, endEdit, select, selection } from './ui.ts'
import { cardHeight, rectOf, worldPosition } from '../canvas/layout.ts'
import { columnCollapsed, hiddenByColumn } from './columns.ts'
import { isPositionLocked } from './position.ts'
import { showToast } from './toast.ts'

export const [areaDropTarget, setAreaDropTarget] = createSignal<Id | null>(null)
const itemsOn = (id: Id) => [...doc.cardsOn(id), ...doc.stickersOn(id)]
const retainedMembers = (area: Card) => areaFamily(area, Object.values(doc.objs).filter(isAreaItem), true).filter(item => item.areaId === area.id)
export function areaAt(point: Vec, exclude: ReadonlySet<Id> = new Set()): Card<'area'> | undefined {
  return doc.cardsOn(boardId()).filter(isArea).filter(area => !exclude.has(area.id) && !columnCollapsed(area) && !isPositionLocked(area.id)).sort((a, b) => b.z - a.z || b.id.localeCompare(a.id)).find(area => {
    const r = rectOf(area.id)
    return r && point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h
  })
}

/** Convert one root into area-local coordinates without changing its world position. */
export function areaPlacement(point: Vec, area?: Card): { x: number; y: number; areaId: Id | null } {
  return { x: point.x - (area?.x ?? 0), y: point.y - (area?.y ?? 0), areaId: area?.id ?? null }
}

export function canCreateAreaFromSelection(): boolean {
  const picked = [...selection()].map(doc.get).filter(isAreaItem)
  return picked.length > 0 && picked.every(item => !isArea(item) && !isPositionLocked(item.id) && doc.canWriteObject(item) && (item.kind !== 'card' || !item.columnId || selection().has(item.columnId)))
}
export function createAreaFromSelection(): Id | null {
  if (!canCreateAreaFromSelection()) return null
  endEdit()
  const picked = [...selection()].map(doc.get).filter(isAreaItem).filter(item => item.kind !== 'card' || !item.columnId || !selection().has(item.columnId))
  const bounds = union(picked.flatMap(item => { const r = rectOf(item.id); return r ? [r] : [] }))
  if (!bounds) return null
  const area: Card<'area'> = { id: newId(), kind: 'card', type: 'area', boardId: boardId(), createdAt: Date.now(), x: bounds.x - AREA_PADDING, y: bounds.y - AREA_HEADER - AREA_PADDING, w: Math.max(320, bounds.w + AREA_PADDING * 2), h: Math.max(160, bounds.h + AREA_HEADER + AREA_PADDING * 2), z: doc.maxZ(boardId()) + 1, color: 'none', areaId: null, columnId: null, content: { title: 'New area' } }
  const patches: Record<Id, Partial<Obj>> = {}
  for (const item of picked) patches[item.id] = areaPlacement(worldPosition(item), area)
  doc.commit([doc.createChange(area), ...doc.changesFor(patches)])
  select([area.id]); beginEdit(area.id)
  return area.id
}

export function removeArea(id: Id): boolean {
  const area = doc.getCard(id)
  if (!isArea(area)) return false
  if (isPositionLocked(id)) { showToast('Unlock this area and its locked members before removing it.'); return false }
  endEdit()
  const patches: Record<Id, Partial<Obj>> = {}
  for (const member of retainedMembers(area)) patches[member.id] = areaPlacement(worldPosition(member))
  patches[id] = { deletedAt: Date.now(), burialId: newId() }
  doc.update(patches); select(Object.keys(patches).filter(key => key !== id))
  return true
}
export function buryArea(id: Id, at = Date.now()) {
  const area = doc.getCard(id)
  if (!isArea(area)) return
  if (isPositionLocked(id)) { showToast('Unlock this area and its locked members before burying it.'); return }
  endEdit()
  const burialId = newId()
  doc.update(Object.fromEntries([area, ...areaFamily(area, itemsOn(area.boardId))].map(item => [item.id, { deletedAt: at, burialId }])))
  select([])
}

/** A final removal can race a remote join. Detach newly arrived members, then retry. */
export function repairAreaRemovals() {
  for (const change of doc.pendingOutbox()) {
    const area = doc.getCard(change.id)
    if (!isArea(area) || (!change.patch.deletedAt && !change.patch.purged)) continue
    const patches: Record<Id, Partial<Obj>> = {}
    const buriedTogether = new Set(areaBurialFamily(area, Object.values(doc.objs).filter(isAreaItem)).map(item => item.id))
    for (const member of retainedMembers(area)) if (!buriedTogether.has(member.id)) patches[member.id] = areaPlacement(worldPosition(member))
    if (Object.keys(patches).length) doc.silent(patches)
  }
}

export function tidyArea(id: Id) {
  const area = doc.getCard(id)
  if (!isArea(area)) return
  if (isPositionLocked(id)) { showToast('Unlock the area and its locked members before tidying.'); return }
  const patches = planAreaTidy(area, itemsOn(area.boardId), cardHeight)
  doc.update(patches); showToast('Area tidied. Undo restores the layout.')
}

/** Placement for toolbar creation into a selected or explicitly targeted area. */
export const [addingToArea, setAddingToArea] = createSignal<Id | null>(null)
export function areaAddPoint(type?: CardType): Vec | null {
  if (type === 'area') return null
  const area = doc.getCard(addingToArea() ?? ([...selection()].length === 1 ? [...selection()][0] : ''))
  if (!isArea(area) || isPositionLocked(area.id)) return null
  const members = areaMembers(area, itemsOn(area.boardId))
  const y = Math.max(area.y + AREA_HEADER + AREA_PADDING, ...members.flatMap(item => { const r = rectOf(item.id); return r ? [r.y + r.h + 24] : [] }))
  return { x: area.x + AREA_PADDING + 130, y: y + 20 }
}
export function rootAreaId(id: Id) { const item = doc.get(id); return isAreaItem(item) ? itemArea(item, doc.get)?.id : undefined }
export const visibleAreaMember = (id: Id) => !hiddenByColumn(id)

/** A lock racing a new item must keep the content while protecting the parent layout. */
export function detachLockedCreates(ids: Id[]) {
  const patches: Record<Id, Partial<Obj>> = {}
  for (const id of ids) {
    const item = doc.get(id)
    if (!isAreaItem(item)) continue
    const position = rectOf(id) ?? worldPosition(item)
    patches[id] = { ...areaPlacement(position), ...(item.kind === 'card' ? { columnId: null } : {}) }
  }
  doc.silent(patches)
  showToast('The parent was locked. Your new items were kept at their board positions.')
}
