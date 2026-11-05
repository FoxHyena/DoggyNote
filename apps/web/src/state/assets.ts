import { newId, type Id } from '@doggynote/core'
import * as idb from './idb.ts'
import { assetUrl } from './api.ts'

import { SIZES, processImage, type AssetSize } from '@doggynote/browser-images'
export { SIZES, type AssetSize }

const listeners = new Set<() => void>()
export const onAssetQueued = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn))
export type ImportedImage = { assetId: Id; width: number; height: number; sizes: AssetSize[] }

export async function importImage(file: Blob): Promise<ImportedImage> {
  const { width, height, renditions } = await processImage(file)
  const assetId = newId()
  const entries: [string, StoredBlob][] = []
  for (const { size, blob } of renditions) entries.push([`${assetId}/${size}`, await toStored(blob)])
  await idb.putMany('assets', entries)
  await idb.put('meta', `upload:${assetId}`, true)
  for (const l of listeners) l()
  return { assetId, width, height, sizes: Object.keys(SIZES) as AssetSize[] }
}

export async function pendingUploads(): Promise<Id[]> {
  const meta = await idb.getAll<unknown>('meta')
  return [...meta.keys()].filter((k) => k.startsWith('upload:')).map((k) => k.slice(7))
}

// Stored as bytes + type, not Blob: WebKit can't put Blobs in IndexedDB in
// private/ephemeral sessions.
type StoredBlob = { type: string; data: ArrayBuffer }
const toStored = async (b: Blob): Promise<StoredBlob> => ({ type: b.type, data: await b.arrayBuffer() })

export async function localBlob(assetId: Id, size: AssetSize): Promise<Blob | undefined> {
  const s = await idb.get<StoredBlob>('assets', `${assetId}/${size}`)
  return s ? new Blob([s.data], { type: s.type }) : undefined
}
export const markUploaded = (assetId: Id) => idb.del('meta', `upload:${assetId}`)

/** The largest stored rendition as a PNG, the one image type every clipboard takes. GIFs come out still. */
export async function pngOf(assetId: Id, sizes?: readonly AssetSize[]): Promise<Blob> {
  const size = (['full', 'medium', 'small', 'thumb'] as const).find((s) => !sizes || sizes.includes(s)) ?? 'full'
  let blob = await localBlob(assetId, size).catch(() => undefined)
  if (!blob) {
    const res = await fetch(await assetUrl(assetId, size), { credentials: 'same-origin' })
    if (!res.ok) throw new Error('Image unavailable')
    blob = await res.blob()
  }
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/png' })
}

// Object URLs for local blobs, ref-counted so unmounted cards release memory.
const urls = new Map<string, { url: string; refs: number }>()

/** Resolve an image URL: the local blob if we have one, else the server. Call `release` on unmount. */
export async function acquireUrl(assetId: Id, size: AssetSize): Promise<string> {
  const key = `${assetId}/${size}`
  const hit = urls.get(key)
  if (hit) {
    hit.refs++
    return hit.url
  }
  let blob: Blob | undefined
  try {
    blob = await localBlob(assetId, size)
  } catch {
    blob = undefined
  }
  if (!blob) return assetUrl(assetId, size)
  const again = urls.get(key)
  if (again) {
    again.refs++
    return again.url
  }
  const url = URL.createObjectURL(blob)
  urls.set(key, { url, refs: 1 })
  return url
}

export function releaseUrl(url: string) {
  for (const [key, v] of urls) {
    if (v.url !== url) continue
    if (--v.refs <= 0) {
      URL.revokeObjectURL(v.url)
      urls.delete(key)
    }
    return
  }
}
