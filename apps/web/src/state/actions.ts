import {
  DEFAULT_SIZE,
  isArea, isAreaItem, itemArea, areaFamily, areaBurialFamily,
  DEFAULT_SKETCH,
  DEFAULT_SWATCH_HEX,
  newId,
  orderBetween,
  starterTable,
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
import { areaAt, areaPlacement } from './areas.ts'
import { worldPosition } from '../canvas/layout.ts'
import { isPositionLocked } from './position.ts'
import { COPY, type CardColor } from '@doggynote/theme'
import * as doc from './doc.ts'
import { prepareBuryMotion } from '../canvas/buryMotion.ts'
import { snapToGrid } from './grid.ts'
import { moveItemsToBoard } from './boardMoves.ts'
import { showToast } from './toast.ts'
import { beginEdit, boardId, clearSelection, editingId, endEdit, select, selection } from './ui.ts'

export const EMPTY_CONTENT: { [T in CardType]: () => CardContent[T] } = {
  chat: () => ({ title: 'Conversation', provider: 'claude' }),
  note: () => ({ md: '' }),
  todo: () => ({ title: '', items: [{ id: newId(), text: '', done: false }] }),
  board: () => ({ boardId: '' }),
  image: () => ({ assetId: '', width: 1, height: 1 }),
  link: () => ({ url: '', status: 'pending' }),
  column: () => ({ title: '' }),
  area: () => ({ title: '' }),
  file: () => ({ assetId: '', name: '', size: 0, mime: '' }),
  movie: () => ({ kind: 'movie', title: '' }),
  swatch: () => ({ hex: DEFAULT_SWATCH_HEX }),
  sketch: () => ({ ...DEFAULT_SKETCH }),
  ink: () => ({ width: 1, height: 1 }),
  table: () => ({ title: '' }),
}

/** Where a new card goes: a world point (card's top-centre lands there) or a column slot. */
export type Placement = { at: Vec; areaId?: Id } | { columnId: Id; order: number }

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
  const point = inColumn ? { x: 0, y: 0 } : { x: onGrid(place.at.x - size.w / 2), y: onGrid(place.at.y - 20) }
  const area = !inColumn && type !== 'area' && b === boardId() ? (place.areaId ? doc.getCard(place.areaId) : areaAt(place.at)) : undefined
  return {
    id: newId(),
    kind: 'card',
    type,
    boardId: b,
    ...areaPlacement(point, area),
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
  // A new table starts with named columns and empty rows, in the same step that creates it.
  const extra = type === 'table' && !opts.content && !opts.extra ? (starterTable(COPY.table.starterColumns) as Partial<Card>) : opts.extra
  const card = baseCard(type, place, content, extra, opts.boardId)
  tx.push(doc.createChange(card))
  doc.commit(tx)
  // Created somewhere else (e.g. straight into the Toy box): don't select or edit it here.
  if (opts.boardId && opts.boardId !== boardId()) return card.id
  const editable = type === 'area' || type === 'note' || type === 'todo' || type === 'column' || type === 'board' || type === 'link' || type === 'movie' || type === 'swatch' || type === 'sketch' || type === 'table'
  if (opts.edit ?? editable) beginEdit(card.id, { isNew: true })
  else select([card.id])
  return card.id
}

const BOARD_COLORS: CardColor[] = ['gold', 'collar', 'ball', 'sky', 'lilac', 'peach']

export function createNoteWithText(text: string, place: Placement): Id {
  return createCard('note', place, { content: { md: text }, edit: false })
}

/** Bury the selection. `now` stamps the burial (a cut remembers it to bring the cards back). */
export function trashSelection(now = Date.now(), buryAreas = false) {
  const ids = [...selection()]
  if (!ids.length) return
  if (editingId()) endEdit()
  const patches: Record<Id, Partial<Obj>> = {}
  const burialId = newId()
  for (const id of ids) {
    const o = doc.get(id)
    if (!o) continue
    if (isArea(o)) {
      if (isPositionLocked(id)) continue
      const family = areaFamily(o, Object.values(doc.objs).filter(isAreaItem), !buryAreas)
      if (buryAreas) for (const member of family) patches[member.id] = { deletedAt: now, burialId }
      else for (const member of family) if (member.areaId === id) patches[member.id] = { ...areaPlacement(worldPosition(member)), ...(ids.includes(member.id) ? { deletedAt: now, burialId } : {}) }
      patches[id] = { deletedAt: now, burialId }; continue
    }
    // Connections have no trash view; they're simply removed (undo brings them back).
    if (o.kind === 'connection') patches[id] = { purged: true }
    else if (o.kind === 'card' || o.kind === 'sticker') patches[id] = { deletedAt: now, burialId }
  }
  doc.update(patches)
  clearSelection()
}

/** Bury the selection and say so, with Undo. Every way of burying (bar, Delete key, sheet) goes through here. */
export function burySelection() {
  const sink = prepareBuryMotion(selection())
  let cards = 0, stickers = 0
  for (const id of selection()) {
    const kind = doc.get(id)?.kind
    if (kind === 'card') cards++
    else if (kind === 'sticker') stickers++
  }
  trashSelection()
  sink()
  const n = cards + stickers
  // Say what went: stickers alone are stickers, a mix is items.
  const noun = !stickers ? 'card' : !cards ? 'sticker' : 'item'
  if (n) showToast(`${COPY.buried} ${n} ${noun}${n === 1 ? '' : 's'}`, 5000, { label: 'Undo', run: () => doc.undo() })
}

export function restoreCard(id: Id) {
  const area = doc.get(id)
  const patches: Record<Id, Partial<Obj>> = { [id]: { deletedAt: null, burialId: null } }
  if (isAreaItem(area)) {
    const parent = itemArea(area, doc.get)
    if (parent?.deletedAt || parent?.purged) patches[id] = { ...patches[id], ...areaPlacement(worldPosition(area)) }
  }
  if (isArea(area)) for (const member of areaBurialFamily(area, Object.values(doc.objs).filter(isAreaItem))) patches[member.id] = { deletedAt: null, burialId: null }
  doc.update(patches)
}

export function emptyTrash(cards: Obj[]) {
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
  const purpose = doc.getCard(to)?.type === 'chat' && doc.getCard(from)?.type !== 'chat' ? 'context' as const : null
  const existing = doc.connectionsOn(boardId()).find((c) => (c.purpose ?? null) === purpose && (purpose ? c.from === from && c.to === to : (c.from === from && c.to === to) || (c.from === to && c.to === from)))
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
    purpose,
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
  select([...doc.cardsOn(boardId()), ...doc.stickersOn(boardId())].filter((c) => c.kind === 'sticker' || !c.columnId).map((c) => c.id))
}

/** Move a card to another board (e.g. out of the Toy box) at a point or into a column. One undo step. */
export function moveCardTo(id: Id, toBoard: Id, place: Placement) {
  const c = doc.getCard(id)
  if (!c) return
  const placement = 'columnId' in place ? place : { at: { x: onGrid(place.at.x - c.w / 2), y: onGrid(place.at.y - 20) } }
  const result = moveItemsToBoard([id], toBoard, { placement, allowInbox: true, notify: false })
  if (!result.ok) showToast(result.reason)
}
