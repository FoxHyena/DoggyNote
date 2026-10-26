import { createMemo, createRoot } from 'solid-js'
import { type Board, type Card, type Id } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from './doc.ts'
import { user } from './session.ts'

// Your Inbox: a personal board, "toybox:<your user id>". The server
// keeps it (and everything on it) private to you; see apps/server/src/sync.ts.

export const toyboxId = (): Id | null => {
  const u = user()
  return u ? `toybox:${u.id}` : null
}

export const isToybox = (boardId: Id | null | undefined) => !!boardId?.startsWith('toybox:')

/** Create your Inbox board on first use (after the first sync, so devices don't race). */
export function ensureToybox() {
  const id = toyboxId()
  if (!id || doc.getBoard(id)) return
  doc.silent({
    [id]: { id, kind: 'board', parentId: null, title: COPY.unsorted, icon: 'ball', color: 'gold', createdAt: Date.now() } as Board,
  })
}

/** Inbox cards, newest first. */
export const toyboxCards = createRoot(() =>
  createMemo<Card[]>(() => {
    const id = toyboxId()
    return id ? [...doc.cardsOn(id)].filter((c) => !c.columnId && !c.areaId).sort((a, b) => b.createdAt - a.createdAt) : []
  }),
)
