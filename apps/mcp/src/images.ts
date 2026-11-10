import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import sharp from 'sharp'

/** Same renditions and limits as the app's own uploads (`@doggynote/browser-images`). */
export const SIZES = { thumb: 256, small: 640, medium: 1024, full: 4096 } as const
export type AssetSize = keyof typeof SIZES
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_PIXELS = 80_000_000
/** One proposal holds at most 200 objects; keep a margin. */
export const MAX_IMAGES = 150
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff'])

export type Skipped = { path: string; reason: string }

/** Expands folders into their image files (sorted by name, numbers in order). Hidden files are ignored. */
export async function collectImages(paths: string[], recursive: boolean): Promise<{ files: string[]; skipped: Skipped[] }> {
  const files: string[] = [], skipped: Skipped[] = []
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  async function visit(path: string, top: boolean) {
    const info = await stat(path).catch(() => null)
    if (!info) { skipped.push({ path, reason: 'not found' }); return }
    if (info.isDirectory()) {
      if (!top && !recursive) return
      const entries = (await readdir(path)).filter((name) => !name.startsWith('.')).sort(byName)
      for (const name of entries) await visit(join(path, name), false)
    } else if (info.isFile()) {
      if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) files.push(path)
      else if (top) skipped.push({ path, reason: 'not a supported image (jpg, png, webp, gif, avif, tiff)' })
    }
  }
  for (const path of paths) await visit(resolve(path), true)
  return { files: [...new Set(files)], skipped }
}

export type Rendition = { size: AssetSize; type: string; bytes: Buffer }
export type Processed = { width: number; height: number; renditions: Rendition[] }

/** Decodes one image and makes the four renditions the app expects. EXIF rotation is applied. */
export async function processImage(input: Buffer, name: string): Promise<Processed> {
  const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata()
  if (!meta.width || !meta.height) throw new Error('could not read the image size')
  const turned = (meta.orientation ?? 1) >= 5
  const width = turned ? meta.height : meta.width, height = turned ? meta.width : meta.height
  if (width * height > MAX_PIXELS) throw new Error('image is too large to process')
  const jpeg = meta.format === 'jpeg'
  const renditions: Rendition[] = []
  for (const [size, max] of Object.entries(SIZES) as [AssetSize, number][]) {
    // Animated GIFs keep their original bytes at full size, as in the app.
    if (size === 'full' && meta.format === 'gif') {
      if (input.byteLength > MAX_IMAGE_BYTES) throw new Error('GIF is over the 15 MB limit')
      renditions.push({ size, type: 'image/gif', bytes: input }); continue
    }
    const quality = size === 'thumb' ? 80 : 88
    const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
    const bytes = await (jpeg ? pipeline.jpeg({ quality, mozjpeg: true }) : pipeline.webp({ quality })).toBuffer()
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`${basename(name)} is over the 15 MB limit at ${size} size`)
    renditions.push({ size, type: jpeg ? 'image/jpeg' : 'image/webp', bytes })
  }
  return { width, height, renditions }
}

/** A stable UUID-shaped id from a secret and some content, so a retry reuses the same upload. */
export async function stableUuid(secret: string, content: string | Uint8Array): Promise<string> {
  const salt = new TextEncoder().encode(`${secret}:`)
  const body = typeof content === 'string' ? new TextEncoder().encode(content) : content
  const joined = new Uint8Array(salt.length + body.length)
  joined.set(salt); joined.set(body, salt.length)
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', joined)).slice(0, 16)
  d[6] = (d[6] & 0x0f) | 0x40; d[8] = (d[8] & 0x3f) | 0x80
  const hex = [...d].map((v) => v.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Lays images out left to right in rows of `columns`; each row is as tall as its tallest card.
 * `extra` is room under each image (a caption), which the app adds when it measures the card. */
export function gridLayout(sizes: { width: number; height: number }[], opts: { x: number; y: number; columns: number; cardWidth: number; gap: number; extra?: number }) {
  const out: { x: number; y: number; w: number; h: number }[] = []
  let y = opts.y
  for (let row = 0; row * opts.columns < sizes.length; row++) {
    const items = sizes.slice(row * opts.columns, (row + 1) * opts.columns)
    let tallest = 0
    items.forEach((s, i) => {
      const h = Math.max(1, Math.round(opts.cardWidth * s.height / s.width))
      tallest = Math.max(tallest, h + (opts.extra ?? 0))
      out.push({ x: opts.x + i * (opts.cardWidth + opts.gap), y, w: opts.cardWidth, h })
    })
    y += tallest + opts.gap
  }
  return out
}

/** Where to start a new grid: under everything already on the board, lined up with its left edge. */
export function placeBelow(objects: { kind?: string; x?: number; y?: number; h?: number; columnId?: string | null; areaId?: string | null }[]): { x: number; y: number } {
  const cards = objects.filter((o) => o.kind === 'card' && !o.columnId && !o.areaId && Number.isFinite(o.x) && Number.isFinite(o.y))
  if (!cards.length) return { x: 0, y: 0 }
  return { x: Math.min(...cards.map((o) => o.x!)), y: Math.max(...cards.map((o) => o.y! + (o.h ?? 0))) + 80 }
}

/** "IMG_0042.jpeg" → "IMG_0042" */
export const captionFor = (path: string) => basename(path, extname(path)).slice(0, 200)
