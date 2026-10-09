import { createSignal } from 'solid-js'
import type { Obj } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from './doc.ts'
import * as idb from './idb.ts'
import { ApiError, api } from './api.ts'
import { SIZES, localBlob, markUploaded, onAssetQueued, pendingUploads, type AssetSize } from './assets.ts'

// Background sync: upload images, push queued patches, then pull everything
// newer than our cursor. Runs on every local change (debounced), on focus, when
// the network returns, and every 10 s while the tab is visible.

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out'
export const [syncState, setSyncState] = createSignal<SyncState>('idle')
export const [pendingCount, setPendingCount] = createSignal(0)
export const [lastError, setLastError] = createSignal<string | null>(null)

const PUSH_CHUNK = 200
const POLL_MS = 10_000

let cursor = 0
let running: Promise<void> | null = null
let again = false
let pushTimer: ReturnType<typeof setTimeout> | null = null
let onSignedOut: (() => void) | null = null
let wasReset = false

async function uploadAssets() {
  for (const id of await pendingUploads()) {
    for (const size of Object.keys(SIZES) as AssetSize[]) {
      const blob = await localBlob(id, size)
      if (!blob) continue
      await api(`/api/assets/${id}/${size}`, { method: 'PUT', body: blob, headers: { 'content-type': blob.type } })
    }
    await markUploaded(id)
  }
}

async function push() {
  for (;;) {
    const pending = doc.pendingOutbox().slice(0, PUSH_CHUNK)
    if (!pending.length) return
    await api('/api/sync', { method: 'POST', json: { changes: pending.map((p) => ({ id: p.id, patch: { ...p.patch, id: p.id } })) } })
    doc.ackOutbox(pending)
    setPendingCount(doc.outboxSize())
    if (pending.length < PUSH_CHUNK) return
  }
}

async function pull() {
  for (;;) {
    const res = await api<{ objects: Obj[]; cursor: number; more: boolean; epoch: string }>(`/api/sync?since=${cursor}`)
    const known = await idb.get<string>('meta', 'epoch')
    if (known !== res.epoch) {
      // No stored epoch but a cursor means a device that synced before epochs
      // existed: just as unsafe to trust.
      const stale = known !== undefined || cursor > 0
      if (stale) {
        // A different (rebuilt or replaced) database: our copy and cursor describe
        // something else. Start over from the server's state.
        await doc.resetLocal()
        cursor = 0
        wasReset = true
      }
      await idb.put('meta', 'epoch', res.epoch)
      if (stale) continue
    }
    doc.receiveRemote(res.objects)
    cursor = res.cursor
    await idb.put('meta', 'cursor', cursor)
    if (!res.more) return
  }
}

async function runOnce() {
  setSyncState('syncing')
  try {
    await doc.flush()
    await uploadAssets()
    await push()
    await pull()
    if (wasReset) {
      wasReset = false
      doc.ensureHome(COPY.home)
    }
    setLastError(null)
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
  pushTimer = setTimeout(() => void syncNow(), 600)
}

/** Start background sync. `first` settles after the first round; `fresh` means this device never synced. */
export async function startSync(opts: { onSignedOut: () => void }): Promise<{ first: Promise<void>; fresh: boolean }> {
  onSignedOut = opts.onSignedOut
  cursor = (await idb.get<number>('meta', 'cursor')) ?? 0
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
