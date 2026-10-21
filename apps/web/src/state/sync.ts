import { showToast } from './toast.ts'
import { createSignal } from 'solid-js'
import type { Obj } from '@doggynote/core'
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

let cursor = 0
let running: Promise<void> | null = null
let again = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
let onSignedOut: (() => void) | null = null
let syncedAccessRevision = ''

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
  for (;;) {
    const pending = doc.pendingOutbox().slice(0, PUSH_CHUNK)
    if (!pending.length) return
    try {
      await api('/api/sync', { method: 'POST', json: { changes: pending.map((p) => ({ id: p.id, patch: { ...p.patch, id: p.id } })) } })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && Array.isArray(error.details.deniedIds)) {
        await preserveDenied(error.details.deniedIds as string[], error.message)
        await refreshAccess()
        continue
      }
      if (error instanceof ApiError && error.status === 409 && Array.isArray(error.details.lockedIds) && Array.isArray(error.details.objects)) {
        doc.reconcileLockedPositions(error.details.lockedIds as string[], error.details.objects as Obj[], pending)
        showToast('A position was locked in another session. Its layout was kept; your content edits are still saved.')
        continue
      }
      if (error instanceof ApiError && error.status === 409) {
        await refreshAccess()
        again = true
      }
      throw error
    }
    doc.ackOutbox(pending)
    setPendingCount(doc.outboxSize())
    if (pending.length < PUSH_CHUNK) return
  }
}

const writable = (object: Obj) => canEditBoard(object.kind === 'board' ? object.id : object.boardId)
type SyncPull = { objects: Obj[]; cursor: number; more: boolean; epoch: string; accessRevision: string; reset: boolean }

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
    if (snapshot) snapshot.push(...res.objects.filter((object) => !(object as { hidden?: boolean }).hidden))
    else {
      // A move can race the read of accessRevision. Preserve text before a
      // privacy stub removes the object and queue, even without a reset yet.
      const hidden = res.objects.filter((object) => (object as { hidden?: boolean }).hidden).map((object) => object.id)
      if (hidden.length) {
        await preserveDenied(hidden, 'This item is no longer accessible. Your local edits are preserved for recovery.')
        const editing = editingId()
        if (editing && hidden.includes(editing)) {
          await preserveActiveEdit(editing, 'Access changed while you were editing. Your text is preserved here.')
          cancelEdit()
        }
      }
      doc.receiveRemote(res.objects)
    }
    cursor = res.cursor
    if (res.more) continue
    if (snapshot) {
      if (accessRevision() !== res.accessRevision) { snapshot = []; snapshotRevision = accessRevision(); cursor = 0; continue }
      const incoming = new Map(snapshot.map((row) => [row.id, row]))
      const pending = doc.pendingOutbox()
      const pendingById = new Map(pending.map((change) => [change.id, change.patch]))
      // A complete authorized snapshot may omit an object moved into someone
      // else's Inbox even while its old board remains editable. Only actual
      // unsent creations may legitimately be absent from the server snapshot.
      const localCreations = new Set(pending.filter((change) => change.patch.kind).map((change) => change.id))
      const missing = (id: string) => !incoming.has(id) && !localCreations.has(id)
      const bodyDenied = (id: string) => {
        const row = incoming.get(id), local = doc.getCard(id)
        if (row?.kind !== 'card' || row.type !== 'note') return false
        const patch = pendingById.get(id)
        // A pre-push snapshot still describes the old group. Keep an explicit
        // local link/unlink intent for server validation instead of mistaking
        // its body for an unauthorized edit to that old group.
        if (patch && 'noteGroupId' in patch && (patch.noteGroupId ?? null) !== (row.noteGroupId ?? null)) return false
        return row.noteBodyReadOnly || (local?.noteGroupId ?? null) !== (row.noteGroupId ?? null)
      }
      const denied = pending.filter((change) => {
        const object = doc.base(change.id)
        const bodyWrite = 'content' in change.patch || 'noteBodyEdit' in change.patch
        return object && (!writable(object) || missing(change.id) || (bodyWrite && bodyDenied(change.id)))
      }).map((change) => change.id)
      // Preserve before unmarking busy objects: a deferred row may replace the
      // local draft when cancelEdit releases the session.
      await preserveDenied(denied, 'Access or linked-note permissions changed. Download these edits to keep a copy.')
      const editing = editingId()
      const editingCard = doc.getCard(editing)
      const editingTarget = editingCard?.type === 'board' ? doc.getBoard((editingCard.content as { boardId: string }).boardId) : undefined
      if (editing && doc.base(editing) && (!writable(doc.base(editing)!) || missing(editing) || bodyDenied(editing) || (editingTarget && !writable(editingTarget)))) {
        await preserveActiveEdit(editing, 'Access was removed while you were editing. Your text is preserved here.')
        const card = doc.getCard(editing)
        if (card?.type === 'board') await preserveActiveEdit((card.content as { boardId: string }).boardId, 'Board access changed during renaming.')
        cancelEdit()
      }
      doc.reconcileSnapshot(snapshot, writable)
    }
    syncedAccessRevision = res.accessRevision
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

/** Concurrent calls coalesce. One automatic successful follow-up covers writes
 * queued during the final pull; continuous writers can leave a pending queue. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    let canDrainLateWrites = true
    do {
      again = false
      await runOnce()
      if (canDrainLateWrites && syncState() === 'idle' && doc.outboxSize() > 0) {
        // An explicitly requested pass can satisfy this one automatic budget.
        canDrainLateWrites = false
        again = true
      }
    } while (again)
  })().finally(() => (running = null))
  return running
}

function schedulePush() {
  setPendingCount(doc.outboxSize())
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void syncNow(), 600)
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
    if (document.visibilityState === 'visible') void syncNow()
  }, POLL_MS)
  return { first: syncNow(), fresh }
}
