import { createEffect, createMemo, createRoot, createSignal } from 'solid-js'
import { isAlive, readMark, unreadByBoard, unreadThreads, type Id, type Seen, type UnreadThread } from '@doggynote/core'
import { api } from './api.ts'
import { canReadBoard } from './access.ts'
import * as doc from './doc.ts'
import { user } from './session.ts'
import { threadCardId } from './comments.ts'

// Unread comments. The server keeps how far you've read each thread
// (apps/server/src/seen.ts); which comments are newer is worked out here from
// the comments this device already synced. Sync only hands a device what its
// person may read, so a private Inbox, a deleted comment or someone else's
// board can never show up as a dot or a count.

type Loaded = Seen & { userId: Id }
const [seen, setSeen] = createSignal<Loaded | null>(null)
/** Marks not yet on the server (offline, or the request failed). Sent with the next one. */
const pending: Record<Id, number> = {}

/** "1 unread comment", "3 unread comments". */
export const unreadLabel = (n: number) => `${n} unread comment${n === 1 ? '' : 's'}`

const state = createRoot(() =>
  createMemo(() => {
    const s = seen()
    const me = user()?.id
    const empty = { threads: [] as UnreadThread[], byCard: new Map<Id, number>(), byBoard: new Map<Id, number>() }
    if (!s || !me || s.userId !== me) return empty
    const threads = unreadThreads(doc.index().comments, s, me, (cardId) => {
      const card = doc.getCard(cardId)
      return isAlive(card) && canReadBoard(card!.boardId)
    })
    if (!threads.length) return empty
    return {
      threads,
      byCard: new Map(threads.map((t) => [t.cardId, t.count])),
      byBoard: unreadByBoard(threads, (id) => doc.getBoard(id)?.parentId),
    }
  }),
)

/** Threads with something new from someone else, newest first. */
export const unreadList = () => state().threads
/** Card ids of those threads: stable keys, so the list doesn't remount rows on every sync. */
export const unreadIds = () => state().threads.map((t) => t.cardId)
export const unreadThread = (cardId: Id) => state().threads.find((t) => t.cardId === cardId)
export const unreadTotal = () => state().threads.reduce((n, t) => n + t.count, 0)
/** Unread comments in a card's thread. */
export const unreadOn = (cardId: Id) => state().byCard.get(cardId) ?? 0
/** Unread comments on a board or any board inside it. */
export const unreadInside = (boardId: Id) => state().byBoard.get(boardId) ?? 0

async function send() {
  const threads = { ...pending }
  if (!Object.keys(threads).length) return
  try {
    await api('/api/seen', { method: 'POST', json: { threads } })
    for (const [id, at] of Object.entries(threads)) if (pending[id] === at) delete pending[id]
  } catch {
    // Kept in `pending`: the next mark or refresh tries again.
  }
}

function mark(marks: Record<Id, number>) {
  const s = seen()
  if (!s) return
  const next = { ...s.threads }
  let changed = false
  for (const [id, at] of Object.entries(marks)) {
    if (at <= (next[id] ?? 0)) continue
    next[id] = at
    pending[id] = Math.max(pending[id] ?? 0, at)
    changed = true
  }
  if (!changed) return
  setSeen({ ...s, threads: next })
  void send()
}

/** You've seen everything in this thread so far. */
export function markThreadSeen(cardId: Id) {
  const me = user()?.id
  if (me) mark({ [cardId]: readMark(doc.commentsOn(cardId), me) })
}

export function markAllSeen() {
  mark(Object.fromEntries(unreadList().map((t) => [t.cardId, t.at])))
}

/** Fetch your read marks, keeping any newer ones this device hasn't sent yet. */
export async function refreshSeen() {
  const me = user()?.id
  if (!me) return
  await send()
  try {
    const s = await api<Seen>('/api/seen')
    if (user()?.id !== me) return
    const local = seen()?.userId === me ? seen()!.threads : {}
    const threads = { ...s.threads }
    for (const [id, at] of Object.entries({ ...local, ...pending })) threads[id] = Math.max(threads[id] ?? 0, at)
    setSeen({ since: s.since, threads, userId: me })
  } catch {
    // Offline or an older server: no dots until it answers.
  }
}

const [visible, setVisible] = createSignal(document.visibilityState === 'visible')
let installed = false

/** Start tracking: read marks on load and whenever the app comes back, and an open thread counts as read. */
export function installUnread() {
  if (installed) return
  installed = true
  void refreshSeen()
  let last = Date.now()
  const back = () => {
    setVisible(document.visibilityState === 'visible')
    // Another device may have read things meanwhile. At most every 30 s.
    if (document.visibilityState === 'visible' && Date.now() - last > 30_000) {
      last = Date.now()
      void refreshSeen()
    }
  }
  document.addEventListener('visibilitychange', back)
  window.addEventListener('focus', back)
  createRoot(() => {
    // Also re-runs when a reply arrives while the thread is open: you're looking at it.
    createEffect(() => {
      const id = threadCardId()
      if (id && visible() && seen() && unreadOn(id)) markThreadSeen(id)
    })
    // Signing in as someone else starts over.
    createEffect(() => {
      const me = user()?.id
      if (!me || !seen() || seen()!.userId === me) return
      for (const id of Object.keys(pending)) delete pending[id]
      void refreshSeen()
    })
  })
}
