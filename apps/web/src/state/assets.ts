import { newId, type Id } from '@doggynote/core'
import * as idb from './idb.ts'
import { assetUrl } from './api.ts'

// Images are resized in the browser before upload: Workers can't run sharp and
// Cloudflare Images costs money. Three sizes, re-encoded, which also strips
// EXIF (GPS etc.) from everything we store. Only GIF originals are kept as-is
// so animation survives at full size.

export const SIZES = { thumb: 256, medium: 1024, full: 4096 } as const
export type AssetSize = keyof typeof SIZES

const listeners = new Set<() => void>()
export const onAssetQueued = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn))

let webpOk: Promise<boolean> | null = null
function canEncodeWebp(): Promise<boolean> {
  webpOk ??= new OffscreenCanvas(1, 1)
    .convertToBlob({ type: 'image/webp' })
    .then((b) => b.type === 'image/webp')
    .catch(() => false)
  return webpOk
}

export type ImportedImage = { assetId: Id; width: number; height: number }

export async function importImage(file: Blob): Promise<ImportedImage> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  const mayHaveAlpha = !/jpe?g|heic|heif/i.test(file.type)
  const type = mayHaveAlpha ? ((await canEncodeWebp()) ? 'image/webp' : 'image/png') : 'image/jpeg'
  const assetId = newId()
  const entries: [string, StoredBlob][] = []
  for (const [size, max] of Object.entries(SIZES) as [AssetSize, number][]) {
    if (size === 'full' && file.type === 'image/gif') {
      entries.push([`${assetId}/${size}`, await toStored(file)])
      continue
    }
    const scale = Math.min(1, max / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    entries.push([`${assetId}/${size}`, await toStored(await canvas.convertToBlob({ type, quality: size === 'thumb' ? 0.8 : 0.88 }))])
  }
  bitmap.close()
  await idb.putMany('assets', entries)
  await idb.put('meta', `upload:${assetId}`, true)
  for (const l of listeners) l()
  return { assetId, width, height }
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
