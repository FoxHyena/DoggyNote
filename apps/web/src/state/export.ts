import { createSignal } from 'solid-js'
import { union, type Id, type Rect } from '@doggynote/core'
import * as doc from './doc.ts'
import { API_BASE, apiRaw, hasBearer } from './api.ts'
import { isTauri } from './platform.ts'
import { boardId, clearSelection, endEdit, select, selection } from './ui.ts'
import { rectOf } from '../canvas/layout.ts'

// Export the board (or the selection) as a PNG. While `exporting` is on, the
// canvas mounts every card at full detail (no culling, no overview mode); the
// world is then rasterised with modern-screenshot (DOM → SVG → canvas), which
// is loaded only now.

export const [exporting, setExporting] = createSignal(false)
/** Output pixels per world pixel, so image cards load a sharp enough size. */
export const [exportScale, setExportScale] = createSignal(1)

export type ExportOptions = { scope: 'board' | 'selection'; scale: 1 | 2; background: 'theme' | 'transparent' }

const PAD = 32
/** Safari can't make a canvas over ~16.7 megapixels; stay under it everywhere. */
const MAX_PIXELS = 16_000_000

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

/** Free cards in scope (cards inside a column come with their column). */
function scopeIds(scope: ExportOptions['scope']): Id[] {
  const free = doc.cardsOn(boardId()).filter((c) => !c.columnId)
  if (scope === 'board') return free.map((c) => c.id)
  const sel = selection()
  return free.filter((c) => sel.has(c.id)).map((c) => c.id)
}

/** Waits (up to ~5 s) until every image shows its final size. */
async function imagesReady(world: HTMLElement) {
  for (let i = 0; i < 100; i++) {
    const imgs = [...world.querySelectorAll('img')]
    const ready = (img: HTMLImageElement) =>
      !!img.getAttribute('src') && (img.dataset.testid !== 'card-image' || img.dataset.loaded === img.dataset.size)
    if (imgs.every(ready)) return
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** Link-preview images from other sites go through our proxy, so their pixels can be read. */
async function viaProxy(url: string): Promise<string | false> {
  if (!/^https?:/.test(url)) return false
  const own = new URL(API_BASE || location.origin)
  if (new URL(url).origin === own.origin) return false
  try {
    const blob = await (await apiRaw(`/api/proxy-image?url=${encodeURIComponent(url)}`)).blob()
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
  } catch {
    return false
  }
}

export type Rendered = { blob: Blob; width: number; height: number; scale: number }

export async function renderPng(opts: ExportOptions): Promise<Rendered> {
  const ids = scopeIds(opts.scope)
  if (!ids.length) throw new Error(opts.scope === 'selection' ? 'Select some cards first.' : 'This board is empty.')
  const keep = new Set(ids)
  const prevSelection = [...selection()]
  endEdit()
  clearSelection()
  setExportScale(opts.scale)
  setExporting(true)
  try {
    await nextFrame()
    await nextFrame()
    const world = document.querySelector<HTMLElement>('[data-testid="world"]')
    if (!world) throw new Error('Nothing to export')
    await imagesReady(world)

    const rects = ids.map((id) => rectOf(id)).filter((r): r is Rect => !!r)
    const b = union(rects)!
    const box = { x: Math.floor(b.x - PAD), y: Math.floor(b.y - PAD), w: Math.ceil(b.w + PAD * 2), h: Math.ceil(b.h + PAD * 2) }
    const scale = Math.min(opts.scale, Math.sqrt(MAX_PIXELS / (box.w * box.h)))
    if (scale < 0.25) throw new Error('This is too big to export as one picture. Try exporting a selection.')

    const root = getComputedStyle(document.documentElement)
    const keepNode = (n: Node) => {
      if (!(n instanceof Element)) return true
      if (n.matches('.connect-handle, .resize-handle, .comment-badge, .grid-glow')) return false
      const card = n.getAttribute('data-card-id')
      if (card && n.classList.contains('free') && !keep.has(card)) return false
      const conn = n.getAttribute('data-connection-id')
      if (conn) {
        const c = doc.get(conn)
        if (!c || c.kind !== 'connection' || !keep.has(c.from) || !keep.has(c.to)) return false
      }
      return true
    }

    const { domToCanvas } = await import('modern-screenshot')
    const shot = await domToCanvas(world, {
      width: box.w,
      height: box.h,
      scale,
      style: { transform: `translate(${-box.x}px, ${-box.y}px)`, width: `${box.w}px`, height: `${box.h}px` },
      filter: keepNode,
      // The connector layer is a 1×1 SVG that overflows onto the board; a
      // clone gets clipped to that box, so size it to the export area.
      onCloneNode: (clone) => {
        const svg = (clone as Element).querySelector?.('svg.connections') as SVGSVGElement | null
        if (!svg) return
        svg.setAttribute('width', String(box.w))
        svg.setAttribute('height', String(box.h))
        svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`)
        // The clone carries every computed style inline (inset, block-size…), which
        // would pin it back to 1×1; replace them. Its paths keep their own styles.
        svg.setAttribute('style', `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;overflow:visible`)
      },
      fetchFn: viaProxy,
      // Same-origin session cookie (browser) or ?t= tokens already in the URLs (desktop).
      fetch: { requestInit: { credentials: hasBearer() ? 'omit' : 'same-origin', cache: 'force-cache' } },
    })
    // The background goes under the picture here rather than on the cloned world,
    // which is shifted, so it would leave the padding bare in WebKit.
    const out = document.createElement('canvas')
    out.width = shot.width
    out.height = shot.height
    const ctx = out.getContext('2d')!
    if (opts.background === 'theme') {
      ctx.fillStyle = root.getPropertyValue('--dn-bg').trim()
      ctx.fillRect(0, 0, out.width, out.height)
    }
    ctx.drawImage(shot, 0, 0)
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'))
    if (!blob) throw new Error('Export failed')
    return { blob, width: out.width, height: out.height, scale }
  } finally {
    setExporting(false)
    if (prevSelection.length) select(prevSelection)
  }
}

const fileName = () => `${(doc.getBoard(boardId())?.title || 'board').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'board'}.png`

/** Renders and saves: the native Save dialog in the Mac app, a download in the browser. */
export async function exportPng(opts: ExportOptions): Promise<Rendered> {
  const out = await renderPng(opts)
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_png', new Uint8Array(await out.blob.arrayBuffer()), { headers: { 'x-name': fileName() } })
  } else {
    const url = URL.createObjectURL(out.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName()
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return out
}
