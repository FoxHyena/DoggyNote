// Minimal promise wrapper over IndexedDB. Four stores:
//   objects  – every synced Obj, keyed by id
//   outbox   – pending patches not yet acknowledged by the server, keyed by id
//   assets   – image blobs, keyed "<assetId>/<size>"
//   meta     – small values (sync cursor, session info)

const DB_NAME = 'doggynote'
const VERSION = 1
export type StoreName = 'objects' | 'outbox' | 'assets' | 'meta'

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of ['objects', 'outbox', 'assets', 'meta']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}

export async function getAll<T>(store: StoreName): Promise<Map<string, T>> {
  const db = await open()
  const tx = db.transaction(store, 'readonly')
  const os = tx.objectStore(store)
  const out = new Map<string, T>()
  await new Promise<void>((resolve, reject) => {
    const req = os.openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c) return resolve()
      out.set(String(c.key), c.value as T)
      c.continue()
    }
    req.onerror = () => reject(req.error)
  })
  return out
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open()
  const req = db.transaction(store, 'readonly').objectStore(store).get(key)
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

/** Write and delete many keys in one transaction. `undefined` values delete. */
export async function putMany(store: StoreName, entries: Iterable<[string, unknown]>): Promise<void> {
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  const os = tx.objectStore(store)
  for (const [k, v] of entries) {
    if (v === undefined) os.delete(k)
    else os.put(v, k)
  }
  return done(tx)
}

export const put = (store: StoreName, key: string, value: unknown) => putMany(store, [[key, value]])
export const del = (store: StoreName, key: string) => putMany(store, [[key, undefined]])

export async function clearAll(): Promise<void> {
  const db = await open()
  const names: StoreName[] = ['objects', 'outbox', 'assets', 'meta']
  const tx = db.transaction(names, 'readwrite')
  for (const n of names) tx.objectStore(n).clear()
  return done(tx)
}
