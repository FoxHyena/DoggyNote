import { StickerAnimation } from './StickerAnimation.tsx'
import { Show, createResource, createSignal } from 'solid-js'
import type { StickerAsset } from '@doggynote/core'
import { assetUrl } from '../state/api.ts'

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
export function StickerImage(props: { sticker: StickerAsset; class?: string; onReady?: () => void; animate?: boolean }) {
  const [url] = createResource(() => props.sticker.assetId, (id) => assetUrl(id, 'thumb'))
  const [playing, setPlaying] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const loaded = (img: HTMLImageElement) => {
    setFailed(false)
    cacheStickerAlpha(props.sticker.assetId, img)
    props.onReady?.()
  }
  return <span class="sticker-image" classList={{ playing: playing() }}><Show when={!failed()} fallback={<span class="sticker-unavailable" role="img" aria-label="Sticker image unavailable">{props.sticker.emoji || '◇'}</span>}>
    <img class={props.class} src={url()} alt={`${props.sticker.emoji || 'Sticker'} · ${props.sticker.packName}`} draggable={false} crossOrigin="anonymous" onLoad={(e) => loaded(e.currentTarget)} onError={() => setFailed(true)} />
  </Show><Show when={props.animate && props.sticker.format !== 'static'}><StickerAnimation sticker={props.sticker} enabled={!!props.animate} onReady={setPlaying} /></Show></span>
}
