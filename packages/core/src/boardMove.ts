import { areaFamily, isArea, isAreaItem, itemWorldPosition, type AreaItem } from './areas.ts'
import { union, type Rect, type Vec } from './geometry.ts'
import { isAlive, type Board, type Id, type Obj } from './model.ts'
import { stickerBounds } from './stickers.ts'
import { positionLocks } from './position.ts'

export type BoardMovePlan = { ok: true; roots: Id[]; ids: Id[]; source: Id; bounds: Rect; patches: Record<Id, Partial<Obj>> } | { ok: false; reason: string }
export type BoardMovePlacement = { at: Vec } | { columnId: Id; order: number }
export type BoardMoveInput = {
  objects: readonly Obj[]
  ids: Iterable<Id>
  destination: Id
  rect: (id: Id) => Rect | null
  canWrite: (object: Obj) => boolean
  canManage: (board: Id) => boolean
  placement?: BoardMovePlacement
}

/** Container roots and their complete family; connections alone aren't movable items. */
export function boardMoveFamily(objects: readonly Obj[], ids: Iterable<Id>): { roots: AreaItem[]; items: AreaItem[] } {
  const items = objects.filter((o): o is AreaItem => isAreaItem(o) && isAlive(o))
  const selected = new Set(ids)
  const candidates = items.filter(o => selected.has(o.id))
  const family = (o: AreaItem) => isArea(o) ? areaFamily(o, items) : o.kind === 'card' && o.type === 'column' ? items.filter(k => k.kind === 'card' && k.boardId === o.boardId && k.columnId === o.id) : []
  const carried = new Set(candidates.flatMap(o => family(o).map(k => k.id)))
  const roots = candidates.filter(o => !carried.has(o.id))
  return { roots, items: [...new Map(roots.flatMap(o => [o, ...family(o)]).map(o => [o.id, o])).values()] }
}

/** Pure, all-or-nothing move. Label mapping is added by the document adapter. */
export function planBoardMove(input: BoardMoveInput): BoardMovePlan {
  const { objects, destination, canWrite, canManage } = input
  const byId = new Map(objects.map(o => [o.id, o]))
  const target = byId.get(destination)
  const selected = [...input.ids]
  const { roots, items } = boardMoveFamily(objects, selected)
  const fail = (reason: string): BoardMovePlan => ({ ok: false, reason })
  if (selected.some(id => { const o = byId.get(id); return !o || (isAreaItem(o) && !isAlive(o)) })) return fail('Some selected items are no longer available.')
  if (!roots.length) return fail('Select an item to move.')
  const source = roots[0].boardId
  if (roots.some(o => o.boardId !== source)) return fail('Select items from one board.')
  if (source === destination) return fail('These items are already on this board.')
  if (target?.kind !== 'board' || !isAlive(target) || !canWrite(target)) return fail('This board is no longer available to edit.')
  if (!items.every(canWrite)) return fail('You cannot move all of these items.')
  const locks = positionLocks(objects.filter(isAreaItem))
  if (items.some(o => locks.has(o.id))) return fail('Unlock the selected items and their containers before moving them.')
  const moved = new Set(items.map(o => o.id))
  const patches: Record<Id, Partial<Obj>> = {}
  for (const o of items) if (o.kind === 'card' && o.type === 'board') {
    const id = (o.content as { boardId: Id }).boardId
    const board = byId.get(id)
    if (board?.kind !== 'board' || !isAlive(board) || !canWrite(board) || !canManage(id)) return fail('You need permission to manage every board being moved.')
    const seen = new Set<Id>()
    let ancestor: Obj | undefined = target
    while (ancestor?.kind === 'board') {
      if (ancestor.id === id || seen.has(ancestor.id)) return fail('A board cannot be moved into itself or one of its boards.')
      seen.add(ancestor.id)
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined
    }
    patches[id] = { parentId: destination } as Partial<Board>
  }
  const rect = (o: AreaItem): Rect => input.rect(o.id) ?? (o.kind === 'sticker' ? stickerBounds({ ...o, ...itemWorldPosition(o, id => byId.get(id)) }) : { ...itemWorldPosition(o, id => byId.get(id)), w: o.w, h: o.h })
  const bounds = union(roots.map(rect))!
  const occupied = union(objects.filter((o): o is AreaItem => isAreaItem(o) && isAlive(o) && o.boardId === destination && !(o.kind === 'card' && o.columnId)).map(rect))
  const at = input.placement && 'at' in input.placement ? input.placement.at : occupied ? { x: occupied.x + occupied.w + 64, y: occupied.y } : { x: 0, y: 0 }
  const column = input.placement && 'columnId' in input.placement ? input.placement : null
  if (column) {
    const col = byId.get(column.columnId)
    if (roots.length !== 1 || roots[0].kind !== 'card' || ['column', 'area', 'ink'].includes(roots[0].type) || col?.kind !== 'card' || col.type !== 'column' || col.boardId !== destination || !isAlive(col) || !canWrite(col) || locks.has(col.id)) return fail('These items cannot be moved into this column.')
  }
  let z = Math.max(0, ...objects.filter((o): o is AreaItem => isAreaItem(o) && isAlive(o) && o.boardId === destination).map(o => o.z))
  const rootIds = new Set(roots.map(o => o.id))
  for (const o of [...items].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id))) {
    const p: Partial<AreaItem> = { boardId: destination }
    if (rootIds.has(o.id)) {
      const r = rect(o)
      const origin = o.kind === 'card' && o.columnId ? r : itemWorldPosition(o, id => byId.get(id))
      Object.assign(p, { x: Math.round(at.x + origin.x - bounds.x), y: Math.round(at.y + origin.y - bounds.y), areaId: null, z: ++z })
      if (o.kind === 'card') Object.assign(p, { columnId: column?.columnId ?? null, order: column?.order ?? 0 })
    }
    patches[o.id] = p as Partial<Obj>
  }
  for (const o of objects) {
    if (o.kind === 'connection' && isAlive(o) && o.boardId === source) {
      if (moved.has(o.from) && moved.has(o.to)) patches[o.id] = { boardId: destination }
      else if (moved.has(o.from) || moved.has(o.to)) patches[o.id] = { purged: true }
    }
    if ((o.kind === 'comment' || o.kind === 'stroke') && !o.purged && moved.has(o.cardId)) patches[o.id] = { boardId: destination }
  }
  if (Object.keys(patches).some(id => { const o = byId.get(id); return o && !canWrite(o) })) return fail('You cannot move all of these items and their related content.')
  return { ok: true, roots: roots.map(o => o.id), ids: [...moved], source, bounds, patches }
}

/** Bounded destination previews and title search share one deterministic order. */
export function rankMoveBoards(boards: readonly Board[], localIds: ReadonlySet<Id>, query: string): Board[] {
  const q = query.trim().toLocaleLowerCase()
  const title = (b: Board) => typeof b.title === 'string' && b.title.trim() ? b.title.toLocaleLowerCase() : 'untitled board'
  const score = (b: Board) => title(b).startsWith(q) ? 1 : 0
  return boards.filter(b => !q || title(b).includes(q)).sort((a, b) =>
    (q ? score(b) - score(a) : 0) || Number(localIds.has(b.id)) - Number(localIds.has(a.id)) || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}
