// The document model. Everything that syncs is an `Obj`: a flat JSON object
// with an `id` and a `kind`. Edits are field patches (see patch.ts), so the
// server can merge them per field and the undo stack can invert them.

import type { CardColor } from '@doggynote/theme'
import type { Side } from './geometry.ts'

export type Id = string

export type CardType = 'note' | 'todo' | 'board' | 'image' | 'link' | 'column'

/** A ProseMirror document as JSON. Rendered without ProseMirror by richtext.ts. */
export type RichDoc = { type: 'doc'; content?: RichNode[] }
export type RichNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: RichNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export type TodoItem = { id: Id; text: string; done: boolean }

export type CardContent = {
  note: { doc: RichDoc }
  todo: { title: string; items: TodoItem[] }
  board: { boardId: Id }
  image: { assetId: Id; width: number; height: number; caption?: string }
  link: { url: string; title?: string; description?: string; image?: string; siteName?: string; status?: 'pending' | 'ok' | 'error' }
  column: { title: string }
}

type Base = {
  id: Id
  /** Soft delete (trash). Restorable. */
  deletedAt?: number | null
  /** Hard delete. Purged objects are kept as tombstones so deletes sync. */
  purged?: boolean
  createdAt: number
}

export type Card<T extends CardType = CardType> = Base & {
  kind: 'card'
  type: T
  boardId: Id
  x: number
  y: number
  w: number
  /** Last measured height. Used for culling and connectors before the card mounts. */
  h: number
  z: number
  color: CardColor
  /** Set when the card sits inside a column; x/y are then ignored. */
  columnId?: Id | null
  order?: number
  content: CardContent[T]
}

export type BoardIcon = 'paw' | 'bone' | 'ball' | 'collar' | 'kennel' | 'bowl' | 'star' | 'heart'

export type Board = Base & {
  kind: 'board'
  parentId: Id | null
  title: string
  icon: BoardIcon
  color: CardColor
}

export type Connection = Base & {
  kind: 'connection'
  boardId: Id
  from: Id
  to: Id
  /** Side each end is pinned to. Missing means "facing sides", recomputed as cards move. */
  fromSide?: Side | null
  toSide?: Side | null
  arrow: 'end' | 'none'
}

export type Obj = Card | Board | Connection

export const HOME_BOARD_ID = 'home'

export const DEFAULT_SIZE: Record<CardType, { w: number; h: number }> = {
  note: { w: 260, h: 60 },
  todo: { w: 260, h: 110 },
  board: { w: 120, h: 120 },
  image: { w: 260, h: 200 },
  link: { w: 260, h: 220 },
  column: { w: 280, h: 120 },
}

export const isAlive = (o: Obj | undefined): boolean => !!o && !o.purged && !o.deletedAt

export function newId(): Id {
  return crypto.randomUUID()
}
