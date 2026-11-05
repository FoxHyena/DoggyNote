import type { Capture } from './protocol.ts'
import type { AssetSize } from '@doggynote/browser-images'

export type Draft = { capture: Capture; renditions?: { size: AssetSize; blob: Blob }[] }
let database: Promise<IDBDatabase> | undefined
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('doggynote-clipper', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(request.error) }
  })
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction('drafts', mode), request = action(tx.objectStore('drafts'))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Could not preserve your capture. Free some disk space and try again.'))
  })
}
export const getDraft = () => transaction<Draft | undefined>('readonly', (store) => store.get('current'))
export const putDraft = (draft: Draft) => transaction('readwrite', (store) => store.put(draft, 'current'))
export const clearDraft = () => transaction('readwrite', (store) => store.clear())
/** Compare and write in one transaction, so a concurrent disconnect cannot resurrect a draft. */
export async function updateDraftIfCurrent(draft: Draft, expectedId = draft.capture.id) {
  const previous = await transaction<Draft | undefined>('readwrite', (store) => {
    const request = store.get('current')
    request.onsuccess = () => { if (request.result?.capture.id === expectedId) store.put(draft, 'current') }
    return request
  })
  return previous?.capture.id === expectedId
}
