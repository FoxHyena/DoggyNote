import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { intersects, worldToScreen, type Card, type Rect } from '@doggynote/core'
import { theme as themeSignal } from '../theme.ts'
import * as doc from '../state/doc.ts'
import { boardId, camera, selection, viewport } from '../state/ui.ts'
import { columnChildren } from '../state/actions.ts'
import { assetUrl } from '../state/api.ts'
import { acquireUrl, releaseUrl } from '../state/assets.ts'
import { cardHeight } from './layout.ts'

// Zoomed out, a board can put a thousand cards on screen. As DOM that costs
// ~60 ms a frame (the browser re-layerizes every card); drawn into one canvas
// it's ~1 ms. Cards become simple shapes: colour, a few text bars, image
// thumbnails, a tile for boards. Hit-testing is geometric (see Canvas.tsx).

type Palette = Record<string, string>

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const get = (n: string) => cs.getPropertyValue(n).trim()
  const p: Palette = {
    card: get('--dn-card'),
    panel: get('--dn-panel'),
    border: get('--dn-border'),
    muted: get('--dn-text-muted'),
    selection: get('--dn-selection'),
  }
  for (const c of ['none', 'gold', 'collar', 'ball', 'sky', 'lilac', 'peach']) {
    p[`${c}-bg`] = get(`--dn-card-${c}-bg`)
    p[`${c}-text`] = get(`--dn-card-${c}-text`)
  }
  return p
}

// Overview thumbnails live in ONE atlas canvas (112×84 cells). Each image is
// loaded, copied into its cell, and released at once. 300 images
// cost ~11 MB instead of ~60 MB of decodes plus a GPU surface per canvas.
// The atlas is dropped when the overview unmounts (zooming back in).
const CELL_W = 112
const CELL_H = 84
const COLS = 16
type Slot = { sx: number; sy: number; sw: number; sh: number }
const slots = new Map<string, Slot | 'loading'>()
let atlas: HTMLCanvasElement | null = null
let nextCell = 0
const [thumbTick, setThumbTick] = createSignal(0)
export const [thumbsLoaded, setThumbsLoaded] = createSignal(0)

function atlasFor(cell: number): HTMLCanvasElement {
  const rowsNeeded = Math.floor(cell / COLS) + 1
  if (!atlas) {
    atlas = document.createElement('canvas')
    atlas.width = COLS * CELL_W
    atlas.height = Math.max(4, rowsNeeded) * CELL_H
  } else if (rowsNeeded * CELL_H > atlas.height) {
    const grown = document.createElement('canvas')
    grown.width = atlas.width
    grown.height = Math.max(rowsNeeded * CELL_H, atlas.height * 2)
    grown.getContext('2d')!.drawImage(atlas, 0, 0)
    atlas.width = atlas.height = 0
    atlas = grown
  }
  return atlas
}

function loadThumb(assetId: string) {
  void acquireUrl(assetId, 'thumb')
    .catch(() => assetUrl(assetId, 'thumb'))
    .then((src) => {
      // <img> rather than fetch(): it's the path that works everywhere, including
      // the desktop webview loading cross-origin from the server.
      const img = new Image()
      img.decoding = 'async'
      // CORS-clean, so the atlas isn't tainted (the server allows the desktop origin).
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (slots.get(assetId) === 'loading') {
          const scale = Math.min(CELL_W / img.naturalWidth, CELL_H / img.naturalHeight)
          const sw = Math.max(1, Math.round(img.naturalWidth * scale))
          const sh = Math.max(1, Math.round(img.naturalHeight * scale))
          const cell = nextCell++
          const a = atlasFor(cell)
          const sx = (cell % COLS) * CELL_W
          const sy = Math.floor(cell / COLS) * CELL_H
          a.getContext('2d')!.drawImage(img, sx, sy, sw, sh)
          slots.set(assetId, { sx, sy, sw, sh })
          setThumbsLoaded((n) => n + 1)
          setThumbTick((n) => n + 1)
        }
        // Copied into the atlas; let the decoded image go. Detach both handlers
        // first: clearing src fires "error", which would evict the thumbnail and
        // reload it forever.
        img.onload = img.onerror = null
        img.src = ''
        if (src.startsWith('blob:')) releaseUrl(src)
      }
      img.onerror = () => {
        slots.delete(assetId)
        if (src.startsWith('blob:')) releaseUrl(src)
      }
      img.src = src
    })
}

function thumb(assetId: string): Slot | null {
  const t = slots.get(assetId)
  if (t && t !== 'loading') return t
  if (!t) {
    slots.set(assetId, 'loading')
    loadThumb(assetId)
  }
  return null
}

function clearThumbs() {
  slots.clear()
  nextCell = 0
  if (atlas) atlas.width = atlas.height = 0
  atlas = null
  setThumbsLoaded(0)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

export function LodLayer() {
  let el!: HTMLCanvasElement
  const [palette, setPalette] = createSignal<Palette>({})
  onMount(() => setPalette(readPalette()))
  // Theme changes swap the CSS variables; re-read them.
  createEffect(() => {
    themeSignal()
    queueMicrotask(() => setPalette(readPalette()))
  })

  let frame = 0
  const draw = () => {
    frame = 0
    const v = viewport()
    const cam = camera()
    const pal = palette()
    const dpr = window.devicePixelRatio || 1
    if (el.width !== Math.round(v.width * dpr) || el.height !== Math.round(v.height * dpr)) {
      el.width = Math.round(v.width * dpr)
      el.height = Math.round(v.height * dpr)
    }
    const ctx = el.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, v.width, v.height)
    const view: Rect = { x: cam.x, y: cam.y, w: v.width / cam.zoom, h: v.height / cam.zoom }
    const z = cam.zoom
    const sel = selection()
    const cards = doc
      .cardsOn(boardId())
      .filter((c) => !c.columnId)
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))

    const drawCard = (c: Card, x: number, y: number, w: number, h: number) => {
      const bg = c.color && c.color !== 'none' ? pal[`${c.color}-bg`] : pal.card
      if (c.type === 'board') {
        const b = doc.getBoard((c as Card<'board'>).content.boardId)
        const s = Math.min(w, h) * 0.55
        ctx.fillStyle = pal[`${b?.color ?? 'gold'}-bg`]
        roundRect(ctx, x + (w - s) / 2, y + h * 0.1, s, s, s * 0.22)
        ctx.fill()
        ctx.fillStyle = pal.muted
        ctx.fillRect(x + w * 0.2, y + h * 0.1 + s + h * 0.08, w * 0.6, Math.max(1, h * 0.06))
        return
      }
      if (c.type === 'image') {
        const t = thumb((c as Card<'image'>).content.assetId)
        if (t && atlas) ctx.drawImage(atlas, t.sx, t.sy, t.sw, t.sh, x, y, w, h)
        else {
          ctx.fillStyle = pal.border
          ctx.fillRect(x, y, w, h)
        }
        return
      }
      ctx.fillStyle = c.type === 'column' ? pal.panel : bg
      roundRect(ctx, x, y, w, h, 3 * z * 4)
      ctx.fill()
      if (c.type === 'column') {
        ctx.strokeStyle = pal.border
        ctx.lineWidth = 1
        ctx.stroke()
        // Header strip, then children stacked like the real column.
        if (c.color && c.color !== 'none') {
          ctx.fillStyle = bg
          ctx.fillRect(x, y, w, Math.min(h, 50 * z))
        }
        let cy = y + 58 * z
        for (const k of columnChildren(c.id)) {
          const kh = cardHeight(k) * z
          drawCard(k, x + 8 * z, cy, w - 16 * z, kh)
          cy += kh + 8 * z
        }
        return
      }
      // Text-ish cards: a few bars where the lines would be.
      ctx.fillStyle = c.color && c.color !== 'none' ? pal[`${c.color}-text`] : pal.muted
      ctx.globalAlpha = 0.35
      const pad = 14 * z
      const lineH = 16 * z
      const lines = Math.max(1, Math.min(6, Math.floor((h - pad * 2) / lineH)))
      for (let i = 0; i < lines; i++) {
        const lw = (w - pad * 2) * (i === lines - 1 && lines > 1 ? 0.6 : 1)
        ctx.fillRect(x + pad, y + pad + i * lineH, lw, Math.max(1, lineH * 0.5))
      }
      ctx.globalAlpha = 1
    }

    for (const c of cards) {
      const h = cardHeight(c)
      const r = { x: c.x, y: c.y, w: c.w, h }
      if (!intersects(view, r)) continue
      const p = worldToScreen(cam, { x: c.x, y: c.y })
      drawCard(c, p.x, p.y, c.w * z, h * z)
      if (sel.has(c.id)) {
        ctx.strokeStyle = pal.selection
        ctx.lineWidth = 2
        ctx.strokeRect(p.x - 3, p.y - 3, c.w * z + 6, h * z + 6)
      }
    }
  }

  createEffect(() => {
    // Track everything draw() reads, then draw once per frame at most.
    camera()
    viewport()
    palette()
    selection()
    thumbTick()
    for (const c of doc.cardsOn(boardId())) void (c.x, c.y, c.w, c.h, c.z, c.color, c.columnId, c.order)
    if (!frame) frame = requestAnimationFrame(draw)
  })
  onCleanup(() => {
    cancelAnimationFrame(frame)
    clearThumbs()
    // Release the canvas backing store right away.
    el.width = el.height = 0
  })

  return <canvas ref={el} class="lod-layer" data-testid="lod-layer" data-thumbs={thumbsLoaded()} aria-label="Board overview" />
}
