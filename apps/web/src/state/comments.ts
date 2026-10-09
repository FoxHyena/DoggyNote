import { createSignal } from 'solid-js'
import { newId, type Comment, type Id } from '@doggynote/core'
import * as doc from './doc.ts'
import { user } from './session.ts'

// Comment threads on cards. Messages aren't undoable (they're conversation, not
// canvas edits), so they go through `silent`. The server re-stamps the author.

/** The card whose thread panel is open. */
export const [threadCardId, setThreadCardId] = createSignal<Id | null>(null)

export function addComment(cardId: Id, text: string) {
  const card = doc.getCard(cardId)
  const me = user()
  const t = text.trim()
  if (!card || !me || !t) return
  const c: Comment = {
    id: newId(),
    kind: 'comment',
    boardId: card.boardId,
    cardId,
    authorId: me.id,
    author: me.username,
    text: t,
    createdAt: Date.now(),
  }
  // A reply re-opens a resolved thread.
  const first = doc.commentsOn(cardId)[0]
  doc.silent({ [c.id]: c, ...(first?.resolvedAt ? { [first.id]: { resolvedAt: null } } : {}) })
}

export function editComment(id: Id, text: string) {
  const t = text.trim()
  if (t) doc.silent({ [id]: { text: t, editedAt: Date.now() } as Partial<Comment> })
}

export function deleteComment(id: Id) {
  doc.silent({ [id]: { deletedAt: Date.now() } })
}

export function setResolved(cardId: Id, resolved: boolean) {
  const first = doc.commentsOn(cardId)[0]
  if (first) doc.silent({ [first.id]: { resolvedAt: resolved ? Date.now() : null } as Partial<Comment> })
}

export const isResolved = (cardId: Id) => !!doc.commentsOn(cardId)[0]?.resolvedAt

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function relativeTime(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} day${s < 2 * 86400 ? '' : 's'} ago`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
