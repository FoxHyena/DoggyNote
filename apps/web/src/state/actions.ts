import {
  DEFAULT_SIZE,
  newId,
  orderBetween,
  snap,
  type Board,
  type Card,
  type CardContent,
  type CardType,
  type Change,
  type Connection,
  type Id,
  type Obj,
  type Side,
  type Vec,
} from '@doggynote/core'
import type { CardColor } from '@doggynote/theme'
import * as doc from './doc.ts'
import { snapToGrid } from './grid.ts'
import { beginEdit, boardId, clearSelection, editingId, endEdit, select, selection } from './ui.ts'

export const EMPTY_CONTENT: { [T in CardType]: () => CardContent[T] } = {
  note: () => ({ md: '' }),
  todo: () => ({ title: '', items: [{ id: newId(), text: '', done: false }] }),
  board: () => ({ boardId: '' }),
  image: () => ({ assetId: '', width: 1, height: 1 }),
  link: () => ({ url: '', status: 'pending' }),
  column: () => ({ title: '' }),
  file: () => ({ assetId: '', name: '', size: 0, mime: '' }),
}

/** Where a new card goes: a world point (card's top-centre lands there) or a column slot. */
export type Placement = { at: Vec } | { columnId: Id; order: number }

export function columnChildren(columnId: Id): Card[] {
  const col = doc.getCard(columnId)
  if (!col) return []
  return doc
    .cardsOn(col.boardId)
    .filter((c) => c.columnId === columnId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function appendOrder(columnId: Id): number {
  const kids = columnChildren(columnId)
  return orderBetween(kids[kids.length - 1]?.order, undefined)
}

/** New cards land on the grid when snapping is on. */
const onGrid = (n: number) => (snapToGrid() ? snap(n) : Math.round(n))

function baseCard<T extends CardType>(type: T, place: Placement, content: CardContent[T], extra: Partial<Card> = {}, onBoard?: Id): Card<T> {
  const b = onBoard ?? boardId()
  const size = DEFAULT_SIZE[type]
  const inColumn = 'columnId' in place
  return {
    id: newId(),
    kind: 'card',
    type,
    boardId: b,
    x: inColumn ? 0 : onGrid(place.at.x - size.w / 2),
    y: inColumn ? 0 : onGrid(place.at.y - 20),
    w: size.w,
    h: size.h,
    z: doc.maxZ(b) + 1,
    color: 'none',
    columnId: inColumn ? place.columnId : null,
    order: inColumn ? place.order : 0,
    content,
    createdAt: Date.now(),
    ...extra,
  } as Card<T>
}

/** Create a card of `type`, select it, and (for text cards) start editing. */
export function createCard(
  type: CardType,
  place: Placement,
  opts: { content?: unknown; edit?: boolean; extra?: Partial<Card>; boardId?: Id } = {},
): Id {
  endEdit()
  const tx: Change[] = []
  let content = (opts.content ?? EMPTY_CONTENT[type]()) as CardContent[CardType]
  if (type === 'board' && !opts.content) {
    const board: Board = {
      id: newId(),
      kind: 'board',
      parentId: boardId(),
      title: '',
      icon: 'paw',
      color: BOARD_COLORS[Math.floor(Math.random() * BOARD_COLORS.length)],
      createdAt: Date.now(),
    }
    tx.push(doc.createChange(board))
    content = { boardId: board.id }
  }
  const card = baseCard(type, place, content, opts.extra, opts.boardId)
  tx.push(doc.createChange(card))
  doc.commit(tx)
  // Created somewhere else (e.g. straight into the Toy box): don't select or edit it here.
  if (opts.boardId && opts.boardId !== boardId()) return card.id
  const editable = type === 'note' || type === 'todo' || type === 'column' || type === 'board' || type === 'link'
  if (opts.edit ?? editable) beginEdit(card.id, { isNew: true })
  else select([card.id])
  return card.id
}

const BOARD_COLORS: CardColor[] = ['gold', 'collar', 'ball', 'sky', 'lilac', 'peach']

export function createNoteWithText(text: string, place: Placement): Id {
  return createCard('note', place, { content: { md: text }, edit: false })
}

export function trashSelection() {
  const ids = [...selection()]
  if (!ids.length) return
  if (editingId()) endEdit()
  const now = Date.now()
  const patches: Record<Id, Partial<Obj>> = {}
  for (const id of ids) {
    const o = doc.get(id)
    if (!o) continue
    // Connections have no trash view; they're simply removed (undo brings them back).
    if (o.kind === 'connection') patches[id] = { purged: true }
    else if (o.kind === 'card') patches[id] = { deletedAt: now }
  }
  doc.update(patches)
  clearSelection()
}

export function restoreCard(id: Id) {
  doc.update({ [id]: { deletedAt: null } })
}

export function emptyTrash(cards: Card[]) {
  const patches: Record<Id, Partial<Obj>> = {}
  for (const c of cards) patches[c.id] = { purged: true }
  doc.update(patches)
}

export function setColor(ids: Iterable<Id>, color: CardColor) {
  const patches: Record<Id, Partial<Obj>> = {}
  for (const id of ids) {
    const o = doc.get(id)
    if (o?.kind === 'card') {
      patches[id] = { color }
      // A board card's colour is the board's colour.
      if (o.type === 'board') patches[(o as Card<'board'>).content.boardId] = { color }
    }
  }
  doc.update(patches)
}

/** Connect two cards. Sides pin each end to a side midpoint; leave them out for facing sides. */
export function connect(from: Id, to: Id, sides: { fromSide?: Side; toSide?: Side } = {}): Id | null {
  if (from === to) return null
  const existing = doc.connectionsOn(boardId()).find((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from))
  if (existing) {
    // Re-dragging the same pair just re-pins its ends.
    if (sides.fromSide || sides.toSide) {
      const same = existing.from === from
      doc.update({
        [existing.id]: same
          ? { fromSide: sides.fromSide ?? null, toSide: sides.toSide ?? null }
          : { fromSide: sides.toSide ?? null, toSide: sides.fromSide ?? null },
      })
    }
    return existing.id
  }
  const conn: Connection = {
    id: newId(),
    kind: 'connection',
    boardId: boardId(),
    from,
    to,
    fromSide: sides.fromSide ?? null,
    toSide: sides.toSide ?? null,
    arrow: 'end',
    createdAt: Date.now(),
  }
  doc.commit([doc.createChange(conn)])
  return conn.id
}

export function selectAll() {
  select(doc.cardsOn(boardId()).filter((c) => !c.columnId).map((c) => c.id))
}

/** Move a card to another board (e.g. out of the Toy box) at a point or into a column. One undo step. */
export function moveCardTo(id: Id, toBoard: Id, place: Placement) {
  const c = doc.getCard(id)
  if (!c) return
  const size = { w: c.w, h: c.h }
  const patch: Partial<Card> =
    'columnId' in place
      ? { boardId: toBoard, columnId: place.columnId, order: place.order }
      : { boardId: toBoard, columnId: null, x: onGrid(place.at.x - size.w / 2), y: onGrid(place.at.y - 20), z: doc.maxZ(toBoard) + 1 }
  // Connections can't span boards, so ones touching the moved card are removed.
  // All of it is one undo step.
  const patches: Record<Id, Partial<Obj>> = { [id]: patch }
  for (const conn of doc.connectionsOn(c.boardId)) if (conn.from === id || conn.to === id) patches[conn.id] = { purged: true }
  // Its comments go with it, so the new board's sharing (or Toy box privacy) covers them.
  for (const m of doc.commentsOn(id)) patches[m.id] = { boardId: toBoard }
  doc.update(patches)
}
