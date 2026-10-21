import { createSignal } from 'solid-js'
import * as idb from './idb.ts'
import * as doc from './doc.ts'
import type { Obj } from '@doggynote/core'
import { isTauri } from './platform.ts'
import { showToast } from './toast.ts'

type Recovery = { id: string; patch: Partial<Obj>; object?: Obj; reason: string; savedAt: number }
export const [recoverableChanges, setRecoverableChanges] = createSignal<Recovery[]>([])

export async function loadRecovery() {
  const values = await idb.getAll<Recovery>('meta')
  setRecoverableChanges([...values].filter(([key]) => key.startsWith('recovery:')).map(([, value]) => value))
}

/** Keep denied edits durable before removing them from the outgoing queue. */
export async function preserveDenied(ids: string[], reason: string) {
  const denied = new Set(ids)
  const pending = doc.pendingOutbox().filter((change) => denied.has(change.id))
  if (!pending.length) return
  const rows = await Promise.all(pending.map(async (change): Promise<Recovery> => {
    const current = doc.get(change.id)
    const object = current?.kind ? JSON.parse(JSON.stringify(current)) as Obj : undefined
    const previous = await idb.get<Recovery>('meta', `recovery:${change.id}`)
    return { ...change, patch: { ...previous?.patch, ...change.patch } as Partial<Obj>, object: object ?? previous?.object, reason, savedAt: Date.now() }
  }))
  await idb.putMany('meta', rows.map((row) => [`recovery:${row.id}`, row]))
  doc.ackOutbox(pending)
  ids.forEach((id) => doc.localBoardCreations.delete(id))
  await doc.flush()
  await loadRecovery()
}

export async function downloadRecovery() {
  const json = JSON.stringify(recoverableChanges(), null, 2)
  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('save_recovery', { json })
    } catch { showToast('Could not export your recovery copy. Try again while DoggyNote is open.') }
    return
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = 'doggynote-unsynced-changes.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function preserveActiveEdit(id: string, reason: string) {
  const object = doc.get(id)
  if (!object) return
  const copy = JSON.parse(JSON.stringify(object)) as Obj
  const row: Recovery = { id, patch: copy, object: copy, reason, savedAt: Date.now() }
  await idb.putMany('meta', [[`recovery:${id}`, row]])
  await loadRecovery()
}
