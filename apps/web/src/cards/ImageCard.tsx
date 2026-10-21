import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { Card } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import { acquireUrl, releaseUrl, type AssetSize } from '../state/assets.ts'
import { camera, endEdit } from '../state/ui.ts'
import { exportScale, exporting } from '../state/export.ts'
import * as doc from '../state/doc.ts'
import type { CardProps } from '../canvas/CardView.tsx'

/** Captions are synced data from other people's devices: anything but text reads as none. */
const captionOf = (card: Card<'image'>) => (typeof card.content?.caption === 'string' ? card.content.caption : '')

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

  const caption = () => captionOf(props.card)
  const editing = () => props.editing && !props.readOnly && !props.lod && !exporting()

  return (
    <>
      <div class="image-card" style={{ 'aspect-ratio': `${props.card.content.width} / ${props.card.content.height}` }}>
        <img src={src()} alt={caption()} draggable={false} decoding="async" loading="lazy" data-size={size()} data-loaded={loaded()} data-testid="card-image" />
      </div>
      <Show when={editing()} fallback={<Show when={!props.lod && caption()}><p class="image-caption" data-testid="image-caption">{caption()}</p></Show>}>
        <CaptionEditor card={props.card} />
      </Show>
    </>
  )
}

/**
 * Typed right under the image, in the same box and type as the caption it
 * becomes. Keystrokes go through the card's edit session (state/ui.ts), so the
 * caption syncs per field and leaving edit mode is one undo step.
 */
function CaptionEditor(props: { card: Card<'image'> }) {
  let input!: HTMLTextAreaElement
  const grow = () => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }
  onMount(() => {
    grow()
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  })
  return (
    <div role="group" aria-label="Image caption" data-testid="image-caption-editor">
      <textarea
        ref={input}
        class="image-caption image-caption-input"
        data-testid="image-caption-input"
        aria-label="Caption"
        rows={1}
        maxLength={10_000}
        placeholder={COPY.captionPlaceholder}
        value={captionOf(props.card)}
        onInput={(e) => {
          grow()
          doc.transient(props.card.id, { content: { ...props.card.content, caption: e.currentTarget.value } } as Partial<Card>)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
            e.preventDefault()
            endEdit()
          }
        }}
      />
    </div>
  )
}
