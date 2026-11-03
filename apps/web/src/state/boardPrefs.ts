import { createEffect, createRoot, createSignal, on } from 'solid-js'
import { api, ApiError } from './api.ts'
import { user } from './session.ts'
import { boardId } from './ui.ts'
import { mergePrefs, type BoardPrefs, type PendingPrefs } from './boardLists.ts'

// Favourites and recently opened boards follow you between devices. Changes
// apply here first, are kept per account for offline use, and are sent to
// the server; anything unsent goes again with the next change or refresh.

type Stored = { prefs: BoardPrefs; pending: PendingPrefs }
const key = (userId: string) => `doggynote.boardPrefs.${userId}`
export const [boardPrefs, setBoardPrefs] = createSignal<BoardPrefs>({})
let pending: PendingPrefs = {}
let owner = ''

function save() {
  if (!owner) return
  try { localStorage.setItem(key(owner), JSON.stringify({ prefs: boardPrefs(), pending } satisfies Stored)) } catch { /* storage unavailable */ }
}
function load(userId: string) {
  owner = userId
  try {
    const stored = JSON.parse(localStorage.getItem(key(userId)) ?? 'null') as Stored | null
    setBoardPrefs(stored?.prefs ?? {}); pending = stored?.pending ?? {}
  } catch { setBoardPrefs({}); pending = {} }
}

let flushing: Promise<void> | null = null
/** One send at a time. Cleared after it settles (a finally inside would run before the assignment when nothing is waiting). */
function flush(): Promise<void> {
  flushing ??= sendPending().finally(() => { flushing = null })
  return flushing
}
/** Sends unsent changes, including ones made while sending. Stops at the first failure that may pass and keeps the rest. */
async function sendPending() {
  const tried = new Set<object>()
  for (;;) {
    const next = Object.entries(pending).find(([, c]) => !tried.has(c))
    if (!next) return
    const [id, change] = next, userId = owner
    tried.add(change)
    try {
      await api(`/api/board-preferences/${encodeURIComponent(id)}`, { method: 'POST', json: change })
    } catch (e) {
      // The server refused this one for good (not shared with you any more): stop retrying it.
      if (!(e instanceof ApiError) || ![400, 403, 404].includes(e.status)) return
    }
    if (owner !== userId) return
    if (pending[id] === change) { const { [id]: _sent, ...rest } = pending; pending = rest }
    save()
  }
}

/** Sends what's waiting, then takes the server's view (stars from your other devices). */
export async function refreshBoardPrefs() {
  if (!owner) return
  await flush()
  const userId = owner
  try {
    const { preferences } = await api<{ preferences: { boardId: string; favoriteAt: number | null; openedAt: number | null }[] }>('/api/board-preferences')
    if (owner !== userId) return
    const server = Object.fromEntries(preferences.map((p) => [p.boardId, { favoriteAt: p.favoriteAt, openedAt: p.openedAt }]))
    setBoardPrefs(mergePrefs(boardPrefs(), server, pending))
    save()
  } catch { /* offline: keep what this device knows */ }
}

function change(id: string, update: { favorite?: boolean; opened?: true }) {
  const now = Date.now(), current = boardPrefs()[id] ?? { favoriteAt: null, openedAt: null }
  setBoardPrefs({ ...boardPrefs(), [id]: {
    favoriteAt: update.favorite === undefined ? current.favoriteAt : update.favorite ? current.favoriteAt ?? now : null,
    openedAt: update.opened ? now : current.openedAt,
  } })
  pending = { ...pending, [id]: { ...pending[id], ...update } }
  save()
  void flush()
}

export const isFavourite = (id: string) => boardPrefs()[id]?.favoriteAt != null
export const setFavourite = (id: string, favorite: boolean) => change(id, { favorite })

// Another device's stars matter when you come back to this one. Not when a menu opens:
// a refresh landing mid-gesture would move the rows under your finger.
function refreshOnReturn() {
  if (document.visibilityState === 'visible') void refreshBoardPrefs()
}
window.addEventListener('focus', refreshOnReturn)
document.addEventListener('visibilitychange', refreshOnReturn)

createRoot(() => {
  createEffect(on(() => user()?.id, (id) => {
    if (!id) { owner = ''; setBoardPrefs({}); pending = {}; return }
    load(id)
    void refreshBoardPrefs()
  }))
  // Every board you land on counts, however you got there. The share viewer and your Inbox don't.
  createEffect(on([() => user()?.id, boardId], ([id, board]) => {
    if (id && owner === id && !location.pathname.startsWith('/s/') && !board.startsWith('toybox:')) change(board, { opened: true })
  }))
})
