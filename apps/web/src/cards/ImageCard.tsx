import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { acquireUrl, releaseUrl, type AssetSize } from '../state/assets.ts'
import { camera } from '../state/ui.ts'
import { exportScale, exporting } from '../state/export.ts'
import type { CardProps } from '../canvas/CardView.tsx'

// Picks the smallest stored size that still looks sharp at the current zoom,
// so a zoomed-out moodboard decodes 256px thumbnails, not originals.

export function ImageCard(props: CardProps<'image'>) {
  const size = createMemo<AssetSize>(() => {
    // An export renders at its own scale, whatever the camera is doing.
    const onScreen = exporting() ? props.card.w * exportScale() : props.card.w * camera().zoom * (window.devicePixelRatio || 1)
    if (props.lod || onScreen <= 256) return 'thumb'
    // Older images have no `small`; they step up to `medium`.
    if (onScreen <= 640 && props.card.content.sizes?.includes('small')) return 'small'
    return onScreen <= 1024 ? 'medium' : 'full'
  })
  const [src, setSrc] = createSignal<string>()
  /** The size `src` currently shows (it lags `size()` while the next one loads). */
  const [loaded, setLoaded] = createSignal<AssetSize>()

  createEffect(() => {
    const { assetId } = props.card.content
    const s = size()
    let url: string | null = null
    let cancelled = false
    void acquireUrl(assetId, s).then((u) => {
      if (cancelled) return releaseUrl(u)
      url = u
      setSrc(u)
      setLoaded(s)
    })
    onCleanup(() => {
      cancelled = true
      // Keep showing the old URL until the new one is ready; release it a moment later.
      if (url) setTimeout(() => releaseUrl(url!), 1000)
    })
  })

  return (
    <div class="image-card" style={{ 'aspect-ratio': `${props.card.content.width} / ${props.card.content.height}` }}>
      <img src={src()} alt={props.card.content.caption ?? ''} draggable={false} decoding="async" loading="lazy" data-size={size()} data-loaded={loaded()} data-testid="card-image" />
    </div>
  )
}
