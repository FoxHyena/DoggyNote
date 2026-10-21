import { isAlive, newId, type Board, type Card, type Id, type Obj } from './model.ts'

export type DuplicateOptions = {
  /** Copy the complete canonical tree, following parentId rather than shortcuts. */
  rootBoardId?: Id
  /** Alternatively, copy these cards and the members of selected columns. */
  selectionIds?: Iterable<Id>
  targetBoardId?: Id
  title?: string
  offset?: { x: number; y: number }
  /** Rendered positions for cards detached from an unselected column. */
  positions?: Record<Id, { x: number; y: number }>
  id?: () => Id
  now?: number
}

export type DuplicateResult = { objects: Obj[]; idMap: Map<Id, Id>; rootId?: Id; selectedIds: Id[] }

/**
 * Independent graph copy. The caller supplies a complete, authorized snapshot.
 * Comments deliberately stay on the source; copying them would invent authorship.
 * Shared immutable assets keep their credentials-checked IDs, never signed URLs.
 */
export function duplicateObjects(input: readonly Obj[], options: DuplicateOptions): DuplicateResult {
  const all = input.filter(isAlive)
  const byId = new Map(all.map((o) => [o.id, o]))
  const boards = all.filter((o): o is Board => o.kind === 'board')
  const cards = all.filter((o): o is Card => o.kind === 'card')
  const includedBoards = new Set<Id>()
  const includedCards = new Set<Id>()
  const chosen = new Set(options.selectionIds)
  const visit = (id: Id) => {
    if (includedBoards.has(id)) return
    const b = byId.get(id)
    if (b?.kind !== 'board') throw new Error('A board needed for this copy is unavailable.')
    includedBoards.add(id)
    for (const child of boards) if (child.parentId === id) visit(child.id)
  }
  if (options.rootBoardId) visit(options.rootBoardId)
  else {
    if (!options.targetBoardId) throw new Error('Choose a destination board.')
    for (const id of chosen) {
      const card = byId.get(id)
      if (card?.kind !== 'card') continue
      includedCards.add(id)
      if (card.type === 'column') for (const member of cards) if (member.columnId === id && member.boardId === card.boardId) includedCards.add(member.id)
    }
    // A board card is canonical only when its target really is a child of its board.
    // Shortcuts do not pull unrelated projects into a selection copy.
    for (const card of cards) if (includedCards.has(card.id) && card.type === 'board') {
      const target = (card as Card<'board'>).content.boardId
      const b = byId.get(target)
      if (b?.kind === 'board' && b.parentId === card.boardId) visit(target)
    }
  }
  for (const card of cards) if (includedBoards.has(card.boardId)) includedCards.add(card.id)

  const included = all.filter((o) => o.kind === 'board' ? includedBoards.has(o.id)
    : o.kind === 'card' ? includedCards.has(o.id)
    : o.kind === 'connection' ? includedCards.has(o.from) && includedCards.has(o.to)
    // Standalone editable strokes (loop 9) follow their owning copied card.
    : (o as { kind: string }).kind === 'stroke' && includedCards.has((o as unknown as { cardId: Id }).cardId))
  const idMap = new Map<Id, Id>()
  const used = new Set(input.map((o) => o.id))
  // Groups and checklist entries also carry identities. Reserve even tombstoned
  // source values so a later restore cannot reconnect an independent copy.
  for (const object of input) if (object.kind === 'card') {
    if (object.type === 'note' && typeof object.noteGroupId === 'string') used.add(object.noteGroupId)
    if (object.type === 'todo') {
      const items = (object as Card<'todo'>).content?.items
      if (Array.isArray(items)) for (const item of items) if (typeof item?.id === 'string') used.add(item.id)
    }
  }
  const fresh = () => {
    const id = (options.id ?? newId)()
    if (used.has(id)) throw new Error('A copy ID was reused. Please try again.')
    used.add(id)
    return id
  }
  for (const object of included) idMap.set(object.id, fresh())
  const remap = (id: Id) => idMap.get(id) ?? id
  // A group is independent of its source but remains linked within this graph.
  const groupCounts = new Map<Id, number>()
  for (const card of cards) if (includedCards.has(card.id) && card.type === 'note') {
    const group = (card as unknown as { noteGroupId?: Id }).noteGroupId
    if (group) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1)
  }
  const groupIds = new Map([...groupCounts].filter(([, n]) => n > 1).map(([id]) => [id, fresh()]))
  const now = options.now ?? Date.now()
  const offset = options.offset ?? { x: 32, y: 32 }
  const objects = included.map((source) => {
    const clone = structuredClone(source) as Obj & Record<string, unknown>
    clone.id = remap(source.id)
    clone.createdAt = now
    delete clone.deletedAt
    delete clone.purged
    for (const key of ['ownerId', 'owner_id', 'legacy', 'shareToken', 'publicLink', 'templateName', 'noteBodyReadOnly']) delete clone[key]
    if (clone.kind === 'board') {
      clone.parentId = source.id === options.rootBoardId ? null : clone.parentId && includedBoards.has(clone.parentId) ? remap(clone.parentId) : options.targetBoardId ?? null
      if (source.id === options.rootBoardId && options.title !== undefined) clone.title = options.title
    } else {
      clone.boardId = includedBoards.has(clone.boardId) ? remap(clone.boardId) : options.targetBoardId ?? clone.boardId
      if (clone.kind === 'card') {
        const inside = clone.columnId && includedCards.has(clone.columnId)
        clone.columnId = inside ? remap(clone.columnId!) : null
        if (!includedBoards.has((source as Card).boardId) && !inside) {
          const pos = options.positions?.[source.id] ?? clone
          clone.x = pos.x + offset.x
          clone.y = pos.y + offset.y
        }
        if (clone.type === 'board') (clone as Card<'board'>).content.boardId = remap((clone as Card<'board'>).content.boardId)
        if (clone.type === 'todo') for (const item of (clone as Card<'todo'>).content.items) item.id = fresh()
        if (clone.type === 'note' && typeof clone.noteGroupId === 'string') clone.noteGroupId = groupIds.get(clone.noteGroupId) ?? null
      } else if (clone.kind === 'connection') {
        clone.from = remap(clone.from)
        clone.to = remap(clone.to)
      } else if (typeof clone.cardId === 'string') clone.cardId = remap(clone.cardId)
    }
    return clone
  })
  // Existing sync chunks must never create a dependent before its parent.
  const depth = (board: Board): number => {
    let n = 0, current: Board | undefined = board
    const seen = new Set<Id>()
    while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); n++; current = byId.get(current.parentId) as Board | undefined }
    return n
  }
  const originals = new Map([...idMap].map(([old, id]) => [id, byId.get(old)!]))
  const rank = (o: Obj) => o.kind === 'board' ? depth(originals.get(o.id) as Board)
    : o.kind === 'card' ? o.type === 'column' ? 10000 : 10001 : 10002
  objects.sort((a, b) => rank(a) - rank(b))
  return { objects, idMap, rootId: options.rootBoardId ? idMap.get(options.rootBoardId) : undefined, selectedIds: [...includedCards].filter((id) => {
    const card = byId.get(id) as Card
    return !includedBoards.has(card.boardId) && (!card.columnId || !includedCards.has(card.columnId))
  }).map(remap) }
}
