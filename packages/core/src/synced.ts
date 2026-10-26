import * as Y from 'yjs'
import { decodeUpdate, encodeUpdate, noteDocument, noteState } from './collaboration.ts'
import type { Card, Obj } from './model.ts'

// Synced copies of a note. Every copy is its own card with its own Yjs
// document, but all of them start as a clone of one document and every change
// to one is merged into the others. Because they share one history, merging is
// a plain CRDT union: no text is ever doubled.
//
// A copy joins a group by carrying the group's `syncId` (the first card's id).
// Joining is explicit: a client sends `syncJoin: true` with the `syncId`.
// Without it, the server drops the `syncId`, so a copy made by an app that
// doesn't know about syncing (which copies every field) stays independent.

/** Most copies one note can have. Keeps a fan-out inside one D1 batch. */
export const SYNC_GROUP_LIMIT = 20

/** The Toy box prefix. Synced notes never live there (rule 10). */
const TOYBOX = 'toybox:'

export function syncIdOf(o: Partial<Obj> | undefined | null): string | null {
  const v = (o as { syncId?: unknown } | undefined)?.syncId
  return o?.kind === 'card' && (o as Card).type === 'note' && typeof v === 'string' && v ? v : null
}

/** A note that is on the board and in a sync group. */
export function isLiveSynced(o: Partial<Obj> | undefined | null): boolean {
  return !!syncIdOf(o) && !o!.deletedAt && !o!.purged && !(o as { hidden?: boolean }).hidden
}

/** Whether a note may get (or stay in) a synced copy: never in a Toy box. */
export function canSyncNote(o: Partial<Obj> | undefined | null): boolean {
  const c = o as Partial<Card> | undefined
  return !!c && c.kind === 'card' && c.type === 'note' && !c.deletedAt && !c.purged && typeof c.boardId === 'string' && !c.boardId.startsWith(TOYBOX) && !(c.id ?? '').startsWith(TOYBOX)
}

/** The other live copies of `card` among `cards`. */
export function syncedSiblings<T extends Partial<Obj>>(cards: Iterable<T>, card: Partial<Obj> | undefined): T[] {
  const id = syncIdOf(card)
  if (!id) return []
  const out: T[] = []
  for (const c of cards) if (c.id !== card!.id && syncIdOf(c) === id && isLiveSynced(c)) out.push(c)
  return out
}

/** One state holding every copy's edits, and its text. */
export function mergeNoteStates(states: Iterable<string | null | undefined>): { state: string; md: string } {
  const doc = noteDocument()
  try {
    for (const s of states) if (s) Y.applyUpdate(doc, decodeUpdate(s))
    return { state: noteState(doc), md: doc.getText('markdown').toString() }
  } finally { doc.destroy() }
}

/** Whether `state` already matches `merged`, so a write would change nothing. Deletions don't move
 * the state vector, so the text is compared too. */
export function holdsAll(state: string | null | undefined, merged: string): boolean {
  if (!state) return false
  const a = noteDocument(state), b = noteDocument(merged)
  try { return encodeUpdate(Y.encodeStateVector(a)) === encodeUpdate(Y.encodeStateVector(b)) && a.getText('markdown').toString() === b.getText('markdown').toString() } finally { a.destroy(); b.destroy() }
}
