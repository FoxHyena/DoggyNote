import { createSignal } from 'solid-js'
import { sameOrder, settleItems, type Card, type Id } from '@doggynote/core'
import * as doc from './doc.ts'
import { editingId } from './ui.ts'

// Ticked tasks sink below the open ones a beat after the tick, so a misclick can
// be unticked in place and a run of quick ticks doesn't shuffle rows under the
// pointer. The timer lives here, not in the card, so it survives the card
// scrolling off-screen or the board zooming out.

const SETTLE_MS = 800
const timers = new Map<Id, ReturnType<typeof setTimeout>>()
// Tasks ticked during the current beat: a hidden-done list keeps them in view
// until they settle, so a tick never makes a row vanish under the pointer.
const [recent, setRecent] = createSignal(new Map<Id, Set<Id>>())
export const recentlyTicked = (cardId: Id, itemId: Id) => !!recent().get(cardId)?.has(itemId)
export function noteTick(cardId: Id, itemId: Id) {
  setRecent((m) => new Map(m).set(cardId, new Set(m.get(cardId)).add(itemId)))
}
const forget = (cardId: Id) => setRecent((m) => { const n = new Map(m); n.delete(cardId); return n })

export const sortsDone = (c: Card<'todo'>) => c.content.sortDone !== false

/** Settle `id` after a beat, restarting the wait on every call. */
export function scheduleSettle(id: Id) {
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => settleNow(id), SETTLE_MS))
}

/** A pointer is down on the list: wait until it has been still for a beat. */
export function postponeSettle(id: Id) {
  if (timers.has(id)) scheduleSettle(id)
}

export function settleNow(id: Id) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  forget(id)
  const c = doc.getCard(id) as Card<'todo'> | undefined
  // While editing, rows are bound to their slots; the list settles when editing ends.
  if (c?.type !== 'todo' || !sortsDone(c) || editingId() === id || c.deletedAt) return
  const items = settleItems(c.content.items)
  if (!sameOrder(items, c.content.items)) doc.amend(id, { content: { ...c.content, items } } as Partial<Card>)
}

// "done today" turns into "done yesterday" at midnight without a reload.
const [today, setToday] = createSignal(Date.now())
function tickAtMidnight() {
  const next = new Date()
  next.setHours(24, 0, 5, 0)
  setTimeout(() => { setToday(Date.now()); tickAtMidnight() }, next.getTime() - Date.now())
}
tickAtMidnight()
/** Now, refreshed at midnight: for day-based labels. */
export const clock = today
