import { createSignal } from 'solid-js'
import { api, ApiError } from './api.ts'
import { user } from './session.ts'
import * as doc from './doc.ts'

export type BoardPermission = { id: string; parentId: string | null; ownerId: string | null; legacy: boolean; canEdit: boolean; canManage: boolean }
export type AccessSnapshot = { revision: string; homeBoardId: string; legacyShared: boolean; boards: BoardPermission[] }
const fallbackHome = () => `home:${user()?.id ?? cachedUserId()}`
function cachedUserId() { try { return (JSON.parse(localStorage.getItem('doggynote.user') ?? '{}') as { id?: string }).id ?? '' } catch { return '' } }
export const [homeBoardId, setHomeBoardId] = createSignal(fallbackHome())
export const [accessRevision, setAccessRevision] = createSignal('')
export const [legacyShared, setLegacyShared] = createSignal(false)
export const [boardPermissions, setBoardPermissions] = createSignal<BoardPermission[]>([])
const [accessLoaded, setAccessLoaded] = createSignal(false)
function install(value: AccessSnapshot) {
  for (const board of value.boards) doc.localBoardCreations.delete(board.id)
  setHomeBoardId(value.homeBoardId); setAccessRevision(value.revision); setLegacyShared(value.legacyShared); setBoardPermissions(value.boards); setAccessLoaded(true)
}
export async function refreshAccess(): Promise<AccessSnapshot> {
  const key = `doggynote.access.${user()?.id ?? cachedUserId()}`
  try {
    const value = await api<AccessSnapshot>('/api/access')
    install(value)
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota or storage denied */ }
    return value
  } catch (e) {
    if (e instanceof ApiError) throw e
    try {
      const cached = localStorage.getItem(key)
      if (cached) { const value = JSON.parse(cached) as AccessSnapshot; install(value); return value }
    } catch { /* no offline snapshot */ }
    setHomeBoardId(fallbackHome())
    throw e
  }
}
export const canReadBoard = (id: string) => boardPermissions().some((b) => b.id === id) || locallyCreated(id)
function locallyCreated(id: string, seen = new Set<string>()): boolean {
  if (id === `toybox:${user()?.id}`) return true
  if (seen.has(id)) return false
  seen.add(id)
  const pending = doc.pendingOutbox().find((p) => p.id === id && p.patch.kind === 'board')
  if (!pending && !doc.localBoardCreations.has(id)) return false
  const local = doc.getBoard(id)
  const parentId = local ? local.parentId ?? null : (pending?.patch as { parentId?: string | null } | undefined)?.parentId ?? null
  if (parentId === null) return true
  if (typeof parentId !== 'string') return false
  const parent = boardPermissions().find((b) => b.id === parentId)
  return parent ? parent.canEdit : locallyCreated(parentId, seen)
}
export function canEditBoard(id: string): boolean {
  const permission = boardPermissions().find((b) => b.id === id)
  if (permission) return permission.canEdit
  if (locallyCreated(id)) return true
  // Before the offline permission cache loads, only the user's own reserved
  // personal boards are safe to enable.
  return !accessLoaded() && (id === fallbackHome() || id === `toybox:${user()?.id}`)
}
export function canManageBoard(id: string): boolean {
  const seen = new Set<string>()
  let ancestor: string | null = id
  while (ancestor && !seen.has(ancestor)) {
    if (ancestor.startsWith('toybox:')) return false
    seen.add(ancestor)
    ancestor = doc.getBoard(ancestor)?.parentId ?? null
  }
  return boardPermissions().find((b) => b.id === id)?.canManage ?? locallyCreated(id)
}
