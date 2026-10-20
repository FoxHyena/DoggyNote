// The document model. Everything that syncs is an `Obj`: a flat JSON object
// with an `id` and a `kind`. Edits are field patches (see patch.ts), so the
// server can merge them per field and the undo stack can invert them.

import type { CardColor } from '@doggynote/theme'
import type { Side } from './geometry.ts'

export type Id = string

/** Every card type this build can draw. Anything else came from a newer app (see cardtext.ts). */
export const CARD_TYPES = ['note', 'todo', 'board', 'image', 'link', 'column', 'file', 'movie'] as const
export type CardType = (typeof CARD_TYPES)[number]
export const isKnownCardType = (t: unknown): t is CardType => (CARD_TYPES as readonly unknown[]).includes(t)

/** A ProseMirror document as JSON. Rendered without ProseMirror by richtext.ts. */
export type RichDoc = { type: 'doc'; content?: RichNode[] }
export type RichNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: RichNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/** `doneAt` is when the task was ticked (epoch ms); missing on tasks ticked before it existed. */
export type TodoItem = { id: Id; text: string; done: boolean; doneAt?: number | null }

export type CardContent = {
  /** Markdown source. `doc` is the pre-markdown format, migrated on load (see noteMarkdown). */
  note: { md: string; doc?: RichDoc }
  /**
   * `sortDone` (default on) sinks ticked tasks below the open ones; `hideDone`
   * folds done tasks into a "3 done" row.
   */
  todo: { title: string; items: TodoItem[]; sortDone?: boolean; hideDone?: boolean }
  board: { boardId: Id }
  /** `sizes` lists stored renditions; images from before the 640 px tier have none (thumb/medium/full). */
  image: { assetId: Id; width: number; height: number; caption?: string; sizes?: ('thumb' | 'small' | 'medium' | 'full')[] }
  link: { url: string; title?: string; description?: string; image?: string; siteName?: string; status?: 'pending' | 'ok' | 'error' }
  column: { title: string }
  /**
   * An uploaded file, stored in R2 as "<assetId>/file". PDFs also get a
   * first-page preview stored as the image rendition "<assetId>/thumb".
   */
  file: { assetId: Id; name: string; size: number; mime: string; status?: 'uploading' | 'ok' | 'error'; error?: string; thumb?: { width: number; height: number } }
  movie: MovieContent
}

/**
 * A film or show from TMDB. A card with no `tmdbId` is still being searched for;
 * `status: 'pending'` (a pasted link, an agent's card) means it still needs
 * resolving. The poster is an image asset ("<assetId>/thumb" and "/small").
 */
export type MovieContent = {
  tmdbId?: number
  kind: 'movie' | 'tv'
  title: string
  year?: number
  imdbId?: string
  assetId?: Id
  watched?: boolean
  watchedAt?: number | null
  /** Show the extras (runtime, genres, overview, where to watch). */
  details?: boolean
  status?: 'pending' | 'ok' | 'error'
  info?: MovieInfo
}

export type MovieInfo = {
  /** Minutes (films). */
  runtime?: number
  seasons?: number
  episodes?: number
  genres?: string[]
  overview?: string
  /** Where to watch, from JustWatch via TMDB, for one region. */
  providers?: { region: string; link?: string; stream?: string[]; rent?: string[]; buy?: string[] }
  fetchedAt: number
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

/**
 * One message in the thread on a card. Each message is its own object, so two
 * people replying at once can't overwrite each other. The server stamps
 * `authorId`/`author` from the session; only the author can edit or delete.
 * The thread's resolved state lives on its first message.
 */
export type Comment = Base & {
  kind: 'comment'
  /** Follows the card when it moves boards, so shares and Toy box privacy cover it. */
  boardId: Id
  cardId: Id
  authorId: Id
  author: string
  text: string
  editedAt?: number | null
  resolvedAt?: number | null
}

export type Obj = Card | Board | Connection | Comment

export const HOME_BOARD_ID = 'home'

export const DEFAULT_SIZE: Record<CardType, { w: number; h: number }> = {
  note: { w: 260, h: 60 },
  todo: { w: 260, h: 110 },
  board: { w: 120, h: 120 },
  image: { w: 260, h: 200 },
  link: { w: 260, h: 220 },
  column: { w: 280, h: 120 },
  file: { w: 260, h: 72 },
  movie: { w: 300, h: 162 },
}

export const isAlive = (o: Obj | undefined): boolean => !!o && !o.purged && !o.deletedAt

export function newId(): Id {
  return crypto.randomUUID()
}
