import { assetUrl } from './api.ts'
import * as idb from './idb.ts'
import { requestPool } from './requestPool.ts'

const run = requestPool(2)
type StoredOutline = { type: string; data: ArrayBuffer }
type Entry = { refs: number; url?: string; result: Promise<string>; controller: AbortController }
const images = new Map<string, Entry>()
let worker: Worker | undefined, unavailable = false, nextId = 0
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>()

function outline(blob: Blob): Promise<Blob> {
  if (unavailable) return Promise.reject(new Error('Background image processing unavailable'))
  try {
    worker ??= new Worker(new URL('./stickerOutline.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    unavailable = true
    return Promise.reject(new Error('Background image processing unavailable'))
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(failed, 5000)
    function failed() {
      unavailable = true; worker?.terminate(); worker = undefined
      for (const job of pending.values()) job.reject(new Error('Background image processing failed'))
      pending.clear()
    }
    worker!.onerror = failed
    worker!.onmessage = ({ data }: MessageEvent<{ id: number; blob?: Blob }>) => {
      const job = pending.get(data.id)
      pending.delete(data.id)
      if (data.blob) job?.resolve(data.blob)
      else job?.reject(new Error('Static sticker outline unavailable'))
    }
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    })
    worker!.postMessage({ id, blob })
  })
}

/** Only mounted static images acquire a render. Share duplicates, persist the
 * encoded PNG per account, and release decoded-image URLs with the last view.
 * Anonymous share viewers use memory only. No API or persisted sticker changes. */
export function acquireStickerOutline(assetId: string, accountId: string | null) {
  const key = `sticker-outline:v1:${accountId ?? 'share'}:${assetId}`
  let entry = images.get(key)
  if (!entry) {
    const controller = new AbortController(), signal = controller.signal
    entry = { refs: 0, result: Promise.resolve(''), controller }
    const current = entry
    entry.result = run(async () => {
      const original = await assetUrl(assetId, 'thumb')
      try {
        const stored = accountId ? await idb.get<StoredOutline>('assets', key).catch(() => undefined) : undefined
        signal.throwIfAborted()
        let rendered: Blob
        if (stored) rendered = new Blob([stored.data], { type: stored.type })
        else {
          const response = await fetch(original, { signal, credentials: 'same-origin' })
          if (!response.ok) throw new Error('Sticker image unavailable')
          rendered = await outline(await response.blob())
          signal.throwIfAborted()
          if (accountId) {
            const data = await rendered.arrayBuffer()
            signal.throwIfAborted()
            await idb.put('assets', key, { type: rendered.type, data }).catch(() => {})
          }
        }
        signal.throwIfAborted()
        current.url = URL.createObjectURL(rendered)
        return current.url
      } catch {
        // Unsupported workers, storage limits, or bad artwork keep the original.
        return original
      }
    }, signal)
    images.set(key, entry)
  }
  entry.refs++
  const current = entry
  let released = false
  return {
    url: current.result,
    release() {
      if (released) return
      released = true
      if (--current.refs) return
      images.delete(key)
      current.controller.abort()
      if (current.url) URL.revokeObjectURL(current.url)
    },
  }
}
