import { StickerAnimation } from './StickerAnimation.tsx'
import { Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import type { StickerAsset } from '@doggynote/core'
import { assetUrl } from '../state/api.ts'
import { user } from '../state/session.ts'
import { acquireStickerOutline } from '../state/stickerOutline.ts'

// Small alpha masks are shared by tray and canvas images; bounded to 256 assets.
const masks = new Map<string, Uint8ClampedArray>()
const MASK = 64
export function stickerAlphaHit(assetId: string, x: number, y: number, allowance = 0, allowanceY = allowance): boolean {
  const mask = masks.get(assetId)
  if (x < -allowance || y < -allowanceY || x > 1 + allowance || y > 1 + allowanceY) return false
  if (!mask) return x >= .08 && x <= .92 && y >= .08 && y <= .92
  const radius = Math.min(8, Math.ceil(allowance * MASK)), radiusY = Math.min(8, Math.ceil(allowanceY * MASK))
  const px = Math.floor(x * (MASK - 1)), py = Math.floor(y * (MASK - 1))
  for (let dy = -radiusY; dy <= radiusY; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const ix = px + dx, iy = py + dy
    if (ix >= 0 && iy >= 0 && ix < MASK && iy < MASK && mask[(iy * MASK + ix) * 4 + 3] > 24) return true
  }
  return false
}

export function cacheStickerAlpha(assetId: string, img: HTMLImageElement) {
    if (!masks.has(assetId)) {
      try {
        const canvas = document.createElement('canvas'); canvas.width = MASK; canvas.height = MASK
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0, MASK, MASK)
        if (masks.size >= 256) masks.delete(masks.keys().next().value!)
        masks.set(assetId, ctx.getImageData(0, 0, MASK, MASK).data)
      } catch { /* Cross-origin/expired credentials leave a conservative inset hit region. */ }
    }
}
/** Art that arrives within this just appears. Slower art gets the blank, then fades in over it. */
const QUICK_MS = 120

export function StickerImage(props: { sticker: StickerAsset; class?: string; onReady?: () => void; animate?: boolean; priority?: boolean }) {
  const [url, setUrl] = createSignal<string>()
  const [playing, setPlaying] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  /** 'waiting' shows nothing yet; 'loading' shows the blank; 'arriving' fades the art in over it. */
  const [state, setState] = createSignal<'waiting' | 'loading' | 'arriving' | 'ready'>('waiting')
  // Synced rows arrive as fresh objects, so `content` changes identity on every
  // echo. Reload only when the artwork itself changes.
  const source = createMemo(() => ({ id: props.sticker.assetId, outlined: props.sticker.format === 'static', account: user()?.id ?? null }), undefined,
    { equals: (a, b) => a.id === b.id && a.outlined === b.outlined && a.account === b.account })
  /** The outline whose URL the image is showing. It is kept until a replacement shows or the image unmounts. */
  let held: { release(): void } | undefined, shown: string | undefined
  createEffect(on(source, ({ id, outlined, account }) => {
    // Even animated stickers' stills keep their original artwork.
    const render = outlined ? acquireStickerOutline(id, account) : undefined
    let disposed = false
    // Other artwork starts over. The same artwork keeps showing until its new URL is ready.
    if (id !== shown) {
      held?.release(); held = undefined
      setUrl(undefined); setState('waiting')
      const slow = setTimeout(() => { if (state() === 'waiting') setState('loading') }, QUICK_MS)
      onCleanup(() => clearTimeout(slow))
    }
    setFailed(false)
    void (render?.url ?? assetUrl(id, 'thumb')).then((url) => {
      if (disposed) return
      if (held !== render) held?.release()
      held = render; shown = id; setUrl(url)
    }).catch(() => { if (!disposed) setFailed(true) })
    onCleanup(() => { disposed = true; if (render !== held) render?.release() })
  }))
  onCleanup(() => held?.release())
  const loaded = (img: HTMLImageElement) => {
    setFailed(false)
    if (state() === 'waiting') setState('ready')
    else if (state() === 'loading') setState('arriving')
    cacheStickerAlpha(props.sticker.assetId, img)
    props.onReady?.()
  }
  return <span class="sticker-image" classList={{ playing: playing() }} data-state={failed() ? 'failed' : state()}>
    <Show when={!failed() && (state() === 'loading' || state() === 'arriving') && !playing()}><span class="sticker-blank" aria-hidden="true"><span class="sticker-blank-face"><span>{props.sticker.emoji || '🐾'}</span></span></span></Show>
    <Show when={!failed()} fallback={<span class="sticker-unavailable" role="img" aria-label="Sticker image unavailable">{props.sticker.emoji || '◇'}</span>}>
      <img class={props.class} src={url()} decoding="async" alt={`${props.sticker.emoji || 'Sticker'} · ${props.sticker.packName}`} draggable={false} crossOrigin="anonymous" onLoad={(e) => loaded(e.currentTarget)} onError={() => setFailed(true)} onAnimationEnd={() => { if (state() === 'arriving') setState('ready') }} />
    </Show><Show when={props.animate && props.sticker.format !== 'static'}><StickerAnimation sticker={props.sticker} enabled={!!props.animate} priority={props.priority} onReady={setPlaying} /></Show></span>
}
