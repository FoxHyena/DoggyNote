import { isAlive, type Card, type Id } from './model.ts'

/** Includes the column's border; also used by the DOM header and overview. */
export const COLUMN_HEADER = 58

export const isColumnCollapsed = (card: Card | undefined) => card?.type === 'column' && card.collapsed === true

/** Only live direct members count. Nested board contents belong to their own board. */
export function columnMembers(column: Card, cards: readonly Card[]): Card[] {
  return cards.filter((c) => isAlive(c) && c.boardId === column.boardId && c.columnId === column.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}

/** A hidden endpoint projects onto its column without changing the connection record. */
export function visibleEndpoint(id: Id, getCard: (id: Id) => Card | undefined, collapsed = isColumnCollapsed): Id | null {
  const card = getCard(id)
  if (!isAlive(card)) return null
  if (!card!.columnId) return id
  const column = getCard(card!.columnId)
  if (!isAlive(column) || column!.boardId !== card!.boardId) return null
  return collapsed(column) ? column!.id : id
}
