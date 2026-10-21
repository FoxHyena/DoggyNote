import { Show, createEffect, createMemo, createSignal, lazy, onCleanup, onMount } from 'solid-js'
import type { Card } from '@doggynote/core'
import { acquireUrl, releaseUrl } from '../state/assets.ts'
import { assetUrl } from '../state/api.ts'
import * as doc from '../state/doc.ts'
import { boardId } from '../state/ui.ts'
import { annotationId, setAnnotationId } from './annotations.ts'
const StrokeEditor = lazy(() => import('./StrokeEditor.tsx').then((m) => ({ default: m.StrokeEditor })))
import { agentDialogKeys } from '../ui/agentDialog.ts'

function LoadingAnnotations(props: { failed: boolean; onClose: () => void }) {
  let close!: HTMLButtonElement
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null
    close.focus()
    onCleanup(() => { if (previous?.isConnected) previous.focus() })
  })
  return <div class="dialog-backdrop ink-backdrop" onPointerDown={(e) => e.stopPropagation()}>
    <section class="dialog" role="dialog" aria-modal="true" aria-label="Load image annotations" onKeyDown={(e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose(); return }
      agentDialogKeys(e)
    }} onKeyUp={(e) => e.stopPropagation()}>
      <p role={props.failed ? 'alert' : 'status'}>{props.failed ? 'The image could not load. Close and reopen to retry.' : 'Loading image…'}</p>
      <button ref={close} class="bar-btn" onClick={props.onClose}>Close</button>
    </section>
  </div>
}

export function ImageAnnotations() {
  const card = () => {
    const c = doc.getCard(annotationId())
    return c?.type === 'image' && !c.deletedAt && !c.purged && c.boardId === boardId() ? c as Card<'image'> : undefined
  }
  const [src, setSrc] = createSignal<string>()
  const [original, setOriginal] = createSignal<string>()
  const [failed, setFailed] = createSignal(false)
  // A complete sync row may replace the owner object while a gesture is
  // active. Only changing its identity/asset should reload the editor.
  const ownerId = createMemo(() => card()?.id)
  const imageAssetId = createMemo(() => card()?.content.assetId)
  // Leaving the board, trashing the image or losing access ends this mode.
  // Returning/restoring later must not silently reopen an old editor session.
  createEffect(() => { if (annotationId() && !card()) setAnnotationId(null) })
  createEffect(() => {
    const id = ownerId(), assetId = imageAssetId()
    setSrc(undefined); setOriginal(undefined); setFailed(false)
    if (!id) return
    if (!assetId) { setFailed(true); return }
    let disposed = false, held: string | undefined
    void acquireUrl(assetId, 'full').then((url) => { if (disposed) releaseUrl(url); else { held = url; setSrc(url) } }).catch(() => { if (!disposed) setFailed(true) })
    void assetUrl(assetId, 'full').then((url) => { if (!disposed) setOriginal(`${url}${url.includes('?') ? '&' : '?'}download=1`) }).catch(() => {})
    onCleanup(() => { disposed = true; if (held) releaseUrl(held) })
  })
  return <Show when={card()}>{(c) => <Show when={src()} fallback={<LoadingAnnotations failed={failed()} onClose={() => setAnnotationId(null)} />}>
    <StrokeEditor cardId={c().id} width={c().content.width} height={c().content.height} imageUrl={src()} originalUrl={original()} title="Annotate image" onDone={() => setAnnotationId(null)} />
  </Show>}</Show>
}
