import { Portal } from 'solid-js/web'
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { acquireUrl, releaseUrl, type AssetSize } from '../state/assets.ts'
import { beginEdit, camera, endEdit } from '../state/ui.ts'
import { IMAGE_CAPTION_MAX, IMAGE_SOURCE_MAX, imageCaption, imageSourceHost, imageSourceUrl } from '@doggynote/core'
import { exportScale, exporting } from '../state/export.ts'
import type { CardProps } from '../canvas/CardView.tsx'
import * as doc from '../state/doc.ts'
import { InkLayer } from '../drawing/InkLayer.tsx'
import { openAnnotations } from '../drawing/annotations.ts'

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

  const caption = () => imageCaption(props.card)
  const source = () => imageSourceUrl(props.card.imageSourceUrl)
  const [expanded, setExpanded] = createSignal(false)
  const [overflow, setOverflow] = createSignal(false)
  let captionEl: HTMLParagraphElement | undefined
  createEffect(() => {
    caption(); expanded(); props.card.w; exporting()
    queueMicrotask(() => setOverflow(!!captionEl && captionEl.scrollHeight > captionEl.clientHeight + 1))
  })

  return (
    <>
    <div class="image-card" data-testid="image-viewport" style={{ position: 'relative', 'aspect-ratio': `${props.card.content.width} / ${props.card.content.height}` }} onDblClick={(e) => { if (!props.readOnly) { e.preventDefault(); e.stopPropagation(); openAnnotations(props.card.id) } }}>
      <img src={src()} alt={caption() || 'Image reference'} draggable={false} decoding="async" loading="lazy" data-size={size()} data-loaded={loaded()} data-testid="card-image" />
      <Show when={!props.readOnly && !props.lod && !props.editing && !exporting() && !caption() && !source()}>
        <button class="image-add-metadata" data-nodrag aria-label="Add image caption and source" onClick={() => beginEdit(props.card.id)}>Add caption</button>
      </Show>
      <InkLayer strokes={doc.strokesOn(props.card.id)} width={props.card.content.width} height={props.card.content.height} />
    </div>
    <Show when={!props.lod && (caption() || source())}>
        <div class="image-metadata" data-testid="image-metadata" data-expanded={expanded() || exporting()}>
          <Show when={caption()}><p ref={(el) => {
            captionEl = el
            const observer = new ResizeObserver(() => setOverflow(el.scrollHeight > el.clientHeight + 1))
            observer.observe(el)
            onCleanup(() => observer.disconnect())
          }} class="image-caption" data-testid="image-caption">{caption()}</p></Show>
          <Show when={!exporting() && (overflow() || expanded())}>
            <button class="image-text-button" data-nodrag aria-expanded={expanded()} onClick={() => setExpanded(!expanded())}>{expanded() ? 'Show less' : 'Read full caption'}</button>
          </Show>
          <Show when={source()}>
            <a class="image-source" data-testid="image-source" data-nodrag href={source()!} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title={source()!}>Source · {imageSourceHost(source())} ↗</a>
          </Show>
          <Show when={!props.readOnly && !props.lod && !exporting()}>
            <button class="image-text-button image-edit" data-nodrag aria-label="Edit image caption and source" onClick={() => beginEdit(props.card.id)}>Edit</button>
          </Show>
        </div>
    </Show>
    <Show when={props.editing && !props.readOnly && !exporting()}>
      <ImageMetadataEditor {...props} />
    </Show>
    </>
  )
}

/** Mounted only for the active image; valid edits use the existing durable edit session. */
function ImageMetadataEditor(props: CardProps<'image'>) {
  const [sourceDraft, setSourceDraft] = createSignal(imageSourceUrl(props.card.imageSourceUrl) ?? '')
  const invalid = () => !!sourceDraft().trim() && !imageSourceUrl(sourceDraft())
  let captionInput!: HTMLTextAreaElement
  const previousFocus = document.activeElement as HTMLElement | null
  onMount(() => captionInput.focus())
  onCleanup(() => queueMicrotask(() => { if (previousFocus?.isConnected) previousFocus.focus() }))
  function sourceInput(raw: string) {
    setSourceDraft(raw)
    const value = imageSourceUrl(raw)
    if (!raw.trim() || value) doc.transient(props.card.id, { imageSourceUrl: value ?? '' })
  }
  return <Portal><div class="dialog-backdrop image-metadata-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) endEdit() }}>
  <section class="image-metadata image-metadata-editor" role="dialog" aria-modal="true" aria-label="Image caption and source" data-nodrag onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
    e.stopPropagation()
    if (e.key === 'Tab') {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>('textarea,input,button')]
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus() }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus() }
    }
    if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) { e.preventDefault(); endEdit() }
  }}>
    <h2>Image caption &amp; source</h2>
    <label>Caption<textarea ref={captionInput} data-testid="image-caption-input" rows={3} maxLength={IMAGE_CAPTION_MAX} placeholder="What makes this image useful?" value={imageCaption(props.card)} onInput={(e) => doc.transient(props.card.id, { imageCaption: e.currentTarget.value })} /></label>
    <label>Source URL <span class="image-optional">(optional)</span><input type="url" data-testid="image-source-input" maxLength={IMAGE_SOURCE_MAX} placeholder="https://example.com/original" value={sourceDraft()} aria-invalid={invalid()} aria-describedby={`image-source-help-${props.card.id}`} onInput={(e) => sourceInput(e.currentTarget.value)} /></label>
    <p id={`image-source-help-${props.card.id}`} class="image-source-help" role={invalid() ? 'alert' : undefined}>{invalid() ? 'Use a full http:// or https:// URL without passwords. Invalid changes are not saved.' : 'Link to the original webpage or image. Changes save as you type.'}</p>
    <button class="bar-btn" data-testid="image-metadata-done" onClick={endEdit}>Done</button>
  </section></div></Portal>
}
