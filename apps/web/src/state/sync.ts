import { createSignal } from 'solid-js'
import { isArea, isAreaItem, orderedAreaChanges, type Obj } from '@doggynote/core'
import { repairAreaRemovals, detachLockedCreates } from './areas.ts'
import * as doc from './doc.ts'
import * as idb from './idb.ts'
import { ApiError, api } from './api.ts'
import { accessRevision, canEditBoard, refreshAccess } from './access.ts'
import { loadRecovery, preserveActiveEdit, preserveDenied } from './recovery.ts'
import { cancelEdit, editingId } from './ui.ts'
import { SIZES, localBlob, markUploaded, onAssetQueued, pendingUploads, type AssetSize } from './assets.ts'

// Background sync: upload images, push queued patches, then pull everything
// newer than our cursor. Runs on every local change (debounced), on focus, when
// the network returns, and every 10 s while the tab is visible.

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out'
// Starts as 'syncing': until the first round finishes, "Synced" would be a lie.
export const [syncState, setSyncState] = createSignal<SyncState>('syncing')
export const [pendingCount, setPendingCount] = createSignal(0)
export const [lastError, setLastError] = createSignal<string | null>(null)
export const [lastSyncAt, setLastSyncAt] = createSignal<number | null>(null)
export const [pendingUploadsCount, setPendingUploadsCount] = createSignal(0)

const PUSH_CHUNK = 200
const POLL_MS = 10_000
// While the board's live room is connected it announces changes, so polling is only a backstop
// (other boards, access changes). Each poll costs a D1 access check.
const LIVE_POLL_MS = 60_000

let cursor = 0
let running: Promise<void> | null = null
let again = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
let onSignedOut: (() => void) | null = null
let syncedAccessRevision = ''
let roomLive = false

/** Set by realtime: a connected room pushes `changed`, so the poll can slow down. */
export function setRoomLive(live: boolean) { roomLive = live }

async function uploadAssets() {
  const uploads = await pendingUploads()
  setPendingUploadsCount(uploads.length)
  for (const id of uploads) {
    for (const size of Object.keys(SIZES) as AssetSize[]) {
      const blob = await localBlob(id, size)
      if (!blob) continue
      await api(`/api/assets/${id}/${size}`, { method: 'PUT', body: blob, headers: { 'content-type': blob.type } })
    }
    await markUploaded(id)
    setPendingUploadsCount((count) => Math.max(0, count - 1))
  }
}

async function push() {
  let conflictRetries = 0
  for (;;) {
    repairAreaRemovals()
    await doc.flush()
    const pending = orderedAreaChanges(doc.pendingOutbox(), doc.get).slice(0, PUSH_CHUNK)
    if (!pending.length) return
    try {
      await api('/api/sync', { method: 'POST', json: { changes: pending.map((p) => ({ id: p.id, patch: { ...p.patch, id: p.id } })) } })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && Array.isArray(error.details.deniedIds)) {
        await preserveDenied(error.details.deniedIds as string[], error.message)
        await refreshAccess()
        continue
      }
      if (error instanceof ApiError && error.status === 409 && Array.isArray(error.details.lockedCreateIds)) {
        if (++conflictRetries > 3) throw error
        await pull()
        detachLockedCreates(error.details.lockedCreateIds as string[])
        await doc.flush()
        continue
      }
      if (error instanceof ApiError && error.status === 409 && Array.isArray(error.details.areaConflictIds)) {
        if (++conflictRetries > 3) throw error
        await pull()
        await stageAreaTransfers(error.details.areaConflictIds as string[])
        repairAreaRemovals()
        await doc.flush()
        continue
      }
      if (error instanceof ApiError && error.status === 409) {
        await refreshAccess()
        again = true
      }
      throw error
    }
    doc.ackOutbox(pending)
    conflictRetries = 0
    setPendingCount(doc.outboxSize())
    if (pending.length < PUSH_CHUNK) return
  }
}

const writable = (object: Obj) => canEditBoard(object.kind === 'board' ? object.id : object.boardId)
type SyncPull = { objects: Obj[]; cursor: number; more: boolean; epoch: string; accessRevision: string; reset: boolean }

/** A large cross-board move cannot move a parent and all its references in one
 * 200-row push. Detach source references first, keeping the intended destination
 * fields durably queued. Repeating or restarting either phase is safe. */
async function stageAreaTransfers(ids: string[]) {
  const moving = new Map(ids.flatMap(id => {
    const area = doc.get(id)
    const pending = doc.pendingOutbox().find(change => change.id === id)
    return isArea(area) && !area.deletedAt && !area.purged && pending?.patch && 'boardId' in pending.patch ? [[id, area] as const] : []
  }))
  if (!moving.size) return
  const remote = new Map<string, Obj>()
  let since = 0
  for (;;) {
    const res = await api<SyncPull>(`/api/sync?since=${since}&accessRevision=${encodeURIComponent(accessRevision())}`)
    for (const object of res.objects) if (!(object as { hidden?: boolean }).hidden) remote.set(object.id, object)
    if (!res.more) break
    since = res.cursor
  }
  const detaches: { id: string; patch: Partial<Obj> }[] = []
  for (const [id, destination] of moving) {
    const source = remote.get(id)
    if (!isArea(source) || source.boardId === destination.boardId) continue
    for (const member of remote.values()) {
      if (!isAreaItem(member) || member.areaId !== id || member.boardId !== source.boardId || member.purged) continue
      const intended = doc.get(member.id)
      if (isAreaItem(intended) && intended.boardId === destination.boardId && intended.areaId === id) {
        doc.checkpoint(intended.id, { boardId: intended.boardId, areaId: id, x: intended.x, y: intended.y })
      }
      detaches.push({ id: member.id, patch: { areaId: null, x: source.x + member.x, y: source.y + member.y } })
    }
  }
  await doc.flush()
  for (let i = 0; i < detaches.length; i += PUSH_CHUNK) {
    // These are intermediate wire changes: ack only the final queued intent.
    await api('/api/sync', { method: 'POST', json: { changes: detaches.slice(i, i + PUSH_CHUNK) } })
  }
  await pull()
}

async function pull() {
  let snapshot: Obj[] | null = null
  let snapshotRevision: string | null = null
  for (;;) {
    const revision: string = snapshotRevision ?? syncedAccessRevision
    const res: SyncPull = await api<SyncPull>(`/api/sync?since=${cursor}&accessRevision=${encodeURIComponent(revision)}`)
    const known = await idb.get<string>('meta', 'epoch')
    if (known !== res.epoch) {
      const stale = known !== undefined || cursor > 0
      if (stale) {
        await preserveDenied(doc.pendingOutbox().map((change) => change.id), 'The server database changed. These local edits were preserved for recovery.')
        // Keep recovery records while replacing stale objects and the old queue.
        cursor = 0
        syncedAccessRevision = ''
        snapshot = null
        snapshotRevision = null
      }
      await idb.put('meta', 'epoch', res.epoch)
      if (stale) continue
    }
    if ((!snapshot && res.reset) || (snapshotRevision && snapshotRevision !== res.accessRevision)) {
      snapshot = []
      snapshotRevision = res.accessRevision
      cursor = 0
      if (accessRevision() !== res.accessRevision) await refreshAccess()
      continue
    }
    const queued = new Map(doc.pendingOutbox().map((change) => [change.id, change.patch]))
    const removed = res.objects.filter((object) => {
      if ((object as { hidden?: boolean }).hidden) return true
      const pending = queued.get(object.id)
      const restoring = pending?.noteRestore || (pending && 'deletedAt' in pending && pending.deletedAt === null) || (pending?.purged === false && !pending.noteUpdate)
      // Our own delete or purge (Empty Buried bones) must still reach the server,
      // or a deleted comment keeps its words there.
      const removing = pending?.purged === true || (typeof pending?.deletedAt === 'number' && pending.deletedAt > 0)
      return (object.deletedAt || object.purged) && !restoring && !removing
    }).map((object) => object.id)
    // A moved/private or removed row can arrive before a queued write is tried.
    // Preserve inactive drafts too, before receiveRemote drops the local copy.
    await preserveDenied(removed, 'This object was removed or moved out of your access. Your unsent edits are preserved here.')
    const active = editingId()
    if (active && removed.includes(active)) {
      await preserveActiveEdit(active, 'This note was removed while you were editing. Your text is preserved here.')
      cancelEdit()
    }
    if (snapshot) snapshot.push(...res.objects.filter((object) => !(object as { hidden?: boolean }).hidden))
    else doc.receiveRemote(res.objects)
    cursor = res.cursor
    if (res.more) continue
    if (snapshot) {
      if (accessRevision() !== res.accessRevision) { snapshot = []; snapshotRevision = accessRevision(); cursor = 0; continue }
      const editing = editingId()
      const editingCard = doc.getCard(editing)
      const editingTarget = editingCard?.type === 'board' ? doc.getBoard((editingCard.content as { boardId: string }).boardId) : undefined
      if (editing && doc.base(editing) && (!writable(doc.base(editing)!) || (editingTarget && !writable(editingTarget)))) {
        await preserveActiveEdit(editing, 'Access was removed while you were editing. Your text is preserved here.')
        const card = doc.getCard(editing)
        if (card?.type === 'board') await preserveActiveEdit((card.content as { boardId: string }).boardId, 'Board access changed during renaming.')
        cancelEdit()
      }
      const denied = doc.pendingOutbox().filter((change) => {
        const object = doc.base(change.id)
        return object && !writable(object)
      }).map((change) => change.id)
      await preserveDenied(denied, 'Your access to this board changed. Download these edits to keep a copy.')
      doc.reconcileSnapshot(snapshot, writable)
    }
    syncedAccessRevision = res.accessRevision
    await doc.settleNoteCompositions()
    await doc.flush()
    await idb.putMany('meta', [['cursor', cursor], ['syncedAccessRevision', syncedAccessRevision]])
    return
  }
}

async function runOnce() {
  setSyncState('syncing')
  try {
    await doc.flush()
    await refreshAccess()
    // Reconcile permissions before replaying offline writes.
    await pull()
    await uploadAssets()
    await push()
    await pull()
    setLastError(null)
    setLastSyncAt(Date.now())
    setSyncState('idle')
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setSyncState('signed-out')
      onSignedOut?.()
    } else if (e instanceof ApiError) {
      setLastError(e.message)
      setSyncState('error')
    } else {
      setSyncState('offline')
    }
  } finally {
    setPendingCount(doc.outboxSize())
  }
}

/** Sync now. Concurrent calls coalesce into one follow-up run. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      await runOnce()
    } while (again)
  })().finally(() => (running = null))
  return running
}

function schedulePush() {
  setPendingCount(doc.outboxSize())
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void syncNow(), 100)
}

/** Start background sync. `first` settles after the first round; `fresh` means this device never synced. */
export async function startSync(opts: { onSignedOut: () => void }): Promise<{ first: Promise<void>; fresh: boolean }> {
  onSignedOut = opts.onSignedOut
  cursor = (await idb.get<number>('meta', 'cursor')) ?? 0
  syncedAccessRevision = (await idb.get<string>('meta', 'syncedAccessRevision')) ?? ''
  await loadRecovery()
  const fresh = cursor === 0
  doc.onOutbox(schedulePush)
  onAssetQueued(schedulePush)
  window.addEventListener('online', () => void syncNow())
  window.addEventListener('focus', () => void syncNow())
  setInterval(() => {
    if (document.visibilityState !== 'visible') return
    if (roomLive && Date.now() - (lastSyncAt() ?? 0) < LIVE_POLL_MS - POLL_MS / 2) return
    void syncNow()
  }, POLL_MS)
  return { first: syncNow(), fresh }
}
