import { isAlive, type Card, type Id, type Obj, type Sticker } from './model.ts'
import { union, type Rect, type Vec } from './geometry.ts'

export type AreaItem = Card | Sticker
export const AREA_HEADER = 48
export const AREA_PADDING = 24
export const isArea = (o: Obj | undefined): o is Card<'area'> => o?.kind === 'card' && o.type === 'area'
export const isAreaItem = (o: Obj | undefined): o is AreaItem => o?.kind === 'card' || o?.kind === 'sticker'

/** Column members inherit their column's area; never two independent parents. */
export function itemArea(item: AreaItem, get: (id: Id) => Obj | undefined): Card<'area'> | undefined {
  const parent = item.kind === 'card' && item.columnId ? get(item.columnId) : item
  const id = isAreaItem(parent) ? parent.areaId : undefined
  const area = id ? get(id) : undefined
  // Tombstones retain their origin: a queued detach must not jump during sync.
  return isArea(area) && area.boardId === item.boardId && area.id !== item.id ? area : undefined
}

/** Origin of a free card/sticker, independent of mounting, zoom or collapsed presentation. */
export function itemWorldPosition(item: AreaItem, get: (id: Id) => Obj | undefined): Vec {
  const area = itemArea(item, get)
  return { x: item.x + (area?.x ?? 0), y: item.y + (area?.y ?? 0) }
}

export function areaMembers(area: Card, items: readonly AreaItem[]): AreaItem[] {
  return items.filter(item => isAlive(item) && item.boardId === area.boardId && item.areaId === area.id && !(item.kind === 'card' && item.columnId))
}

/** Includes columns' cards; nested-board contents remain on their own board. */
export function areaFamily(area: Card, items: readonly AreaItem[], includeBuried = false): AreaItem[] {
  const direct = items.filter(item => !item.purged && (includeBuried || !item.deletedAt) && item.boardId === area.boardId && item.areaId === area.id)
  const columns = new Set(direct.filter(item => item.kind === 'card' && item.type === 'column').map(item => item.id))
  return [...direct, ...items.filter(item => item.kind === 'card' && columns.has(item.columnId ?? '') && !item.purged && (includeBuried || !item.deletedAt) && item.boardId === area.boardId)]
}

/** Stored w/h are minimum dimensions. Never feed computed bounds back into them. */
export function areaFrame(area: Card, members: readonly Rect[], collapsed = false): Rect {
  const requested = { x: area.x, y: area.y, w: Math.max(320, area.w || 800), h: Math.max(160, area.h || 480) }
  const bounds = union([requested, ...members.map(r => ({ x: r.x - AREA_PADDING, y: r.y - AREA_HEADER - AREA_PADDING, w: r.w + AREA_PADDING * 2, h: r.h + AREA_HEADER + AREA_PADDING * 2 }))])!
  return collapsed ? { ...bounds, h: AREA_HEADER } : bounds
}

/** A collapsed area's boundary wins over a collapsed column inside it. */
export function areaVisibleEndpoint(id: Id, get: (id: Id) => Obj | undefined, collapsed: (c: Card) => boolean): Id | null {
  const item = get(id)
  if (!isAreaItem(item) || !isAlive(item)) return null
  const area = itemArea(item, get)
  if (area && isAlive(area) && collapsed(area)) return area.id
  if (item.kind === 'card' && item.columnId) {
    const column = get(item.columnId)
    if (!isAreaItem(column) || column.kind !== 'card' || !isAlive(column) || column.boardId !== item.boardId) return null
    if (collapsed(column)) return column.id
  }
  return id
}

/** Sort parent creation ahead of references and parent removal after detaches. */
export function orderedAreaChanges<T extends { id: Id; patch: Partial<Obj> }>(changes: readonly T[], get: (id: Id) => Obj | undefined): T[] {
  const removes = (change: T) => !!change.patch.deletedAt || change.patch.purged === true
  const rank = (change: T) => {
    const current = get(change.id)
    const next = { ...current, ...change.patch } as Obj
    if (next.kind === 'board') return removes(change) ? 10 : 0
    if (isArea(next)) return removes(change) ? 9 : 1
    if (next.kind === 'card' && next.type === 'column') return removes(change) ? 8 : 2
    if (next.kind === 'card' || next.kind === 'sticker') return 3
    return 4
  }
  const sorted = [...changes].sort((a, b) => rank(a) - rank(b))
  const pending = new Map(sorted.map(change => [change.id, change]))
  const dependencies = new Map<Id, Set<Id>>(sorted.map(change => [change.id, new Set()]))
  const references = (object: Obj) => {
    if (object.kind === 'board') return [object.parentId]
    if (object.kind === 'card') return [object.boardId, object.areaId, object.columnId, ...(object.type === 'board' ? [(object as Card<'board'>).content.boardId] : [])]
    if (object.kind === 'sticker') return [object.boardId, object.areaId]
    if (object.kind === 'stroke' || object.kind === 'comment') return [object.boardId, object.cardId]
    return [object.boardId, object.from, object.to]
  }
  for (const change of sorted) {
    const current = get(change.id), next = { ...current, ...change.patch } as Obj
    for (const ref of references(next)) if (ref && ref !== change.id && pending.has(ref) && !removes(pending.get(ref)!)) dependencies.get(change.id)!.add(ref)
    if (current) for (const ref of references(current)) if (ref && pending.has(ref) && removes(pending.get(ref)!)) dependencies.get(ref)!.add(change.id)
  }
  const out: T[] = [], visiting = new Set<Id>(), done = new Set<Id>()
  const visit = (change: T) => {
    if (done.has(change.id) || visiting.has(change.id)) return
    visiting.add(change.id)
    for (const id of dependencies.get(change.id) ?? []) visit(pending.get(id)!)
    visiting.delete(change.id); done.add(change.id); out.push(change)
  }
  for (const change of sorted) visit(change)
  return out
}

/** Explicit layout command; ordinary edits never invoke it. Ink and stickers stay put. */
export function planAreaTidy(area: Card, members: readonly AreaItem[], height: (card: Card) => number): Record<Id, Vec> {
  const cards = areaMembers(area, members).filter((item): item is Card => item.kind === 'card' && item.type !== 'ink')
  const columns = cards.filter(c => c.type === 'column').sort((a,b)=>a.x-b.x || a.id.localeCompare(b.id))
  const supporting = cards.filter(c => c.type !== 'column').sort((a,b)=>a.y-b.y || a.x-b.x || a.id.localeCompare(b.id))
  const patches: Record<Id, Vec> = {}
  let x = AREA_PADDING, y = AREA_HEADER + AREA_PADDING
  for (const column of columns) { patches[column.id] = {x,y}; x += column.w + 64 }
  const width = Math.max(area.w, x - 64 + AREA_PADDING)
  y += columns.length ? Math.max(...columns.map(height)) + 32 : 0
  let rowHeight = 0; x = AREA_PADDING
  for (const card of supporting) {
    if (x > AREA_PADDING && x + card.w > width - AREA_PADDING) { x = AREA_PADDING; y += rowHeight + 24; rowHeight = 0 }
    patches[card.id] = {x,y}; x += card.w + 24; rowHeight = Math.max(rowHeight, height(card))
  }
  return patches
}

/** A bulk restore only brings back members buried by this very operation. */
export function areaBurialFamily(area: Card, items: readonly AreaItem[]): AreaItem[] {
  return area.deletedAt ? areaFamily(area, items, true).filter(item => !!item.deletedAt && (area.burialId ? item.burialId === area.burialId : !item.burialId && item.deletedAt === area.deletedAt)) : []
}
