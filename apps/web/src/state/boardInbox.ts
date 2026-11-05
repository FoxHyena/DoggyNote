import { createEffect, createMemo, createRoot, createSignal, onCleanup, untrack } from 'solid-js'
import type { BoardInboxItem, Vec } from '@doggynote/core'
import { api } from './api.ts'
import { boardId } from './ui.ts'
import { canReadBoard } from './access.ts'
import { user } from './session.ts'
import { syncNow } from './sync.ts'

export const [boardInboxItems, setBoardInboxItems] = createSignal<BoardInboxItem[]>([])
export const [boardInboxError, setBoardInboxError] = createSignal('')
export const [boardInboxLoading, setBoardInboxLoading] = createSignal(false)
export const [inboxTab, setInboxTab] = createSignal<'board' | 'private'>('private')
let request = 0

export async function refreshBoardInbox() {
  const id = boardId(), me = user()?.id, serial = ++request
  if (!me || !canReadBoard(id) || id.startsWith('toybox:')) { setBoardInboxItems([]); setBoardInboxError(''); setBoardInboxLoading(false); return }
  setBoardInboxLoading(true)
  try {
    const result = await api<{ items: BoardInboxItem[] }>(`/api/boards/${encodeURIComponent(id)}/inbox`)
    if (serial === request && boardId() === id && user()?.id === me) {
      // Keep mounted rows (and pointer capture) through unchanged live refreshes.
      setBoardInboxItems((current) => result.items.map((item) => {
        const previous = current.find((p) => p.id === item.id)
        return previous && JSON.stringify(previous) === JSON.stringify(item) ? previous : item
      }))
      setBoardInboxError('')
    }
  } catch (error) {
    if (serial === request) { setBoardInboxItems([]); setBoardInboxError(error instanceof Error ? error.message : 'Could not load the board Inbox') }
  } finally { if (serial === request) setBoardInboxLoading(false) }
}

export function startBoardInbox() {
  return createRoot((dispose) => {
    const key = createMemo(() => `${user()?.id}:${boardId()}:${canReadBoard(boardId())}`)
    createEffect(() => {
      key()
      untrack(() => { setBoardInboxItems([]); void refreshBoardInbox() })
    })
    const refresh = () => { if (document.visibilityState !== 'hidden') void refreshBoardInbox() }
    window.addEventListener('focus', refresh)
    window.addEventListener('doggynote:board-changed', refresh)
    const timer = setInterval(refresh, 15000)
    onCleanup(() => { ++request; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('doggynote:board-changed', refresh) })
    return dispose
  })
}

export async function placeBoardClip(item: BoardInboxItem, at: Vec) {
  const result = await api<{ cardId: string }>(`/api/boards/${encodeURIComponent(item.boardId)}/inbox/${item.id}/place`, { method: 'POST', json: at })
  await syncNow()
  await refreshBoardInbox()
  return result.cardId
}

export async function changeBoardClip(item: BoardInboxItem, action: 'discard' | 'restore') {
  await api(`/api/boards/${encodeURIComponent(item.boardId)}/inbox/${item.id}/${action}`, { method: 'POST', json: {} })
  await refreshBoardInbox()
}
