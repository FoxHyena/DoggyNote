import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import { safeHref, screenToWorld, type BoardInboxItem, type Vec } from '@doggynote/core'
import { assetUrl } from '../state/api.ts'
import { boardInboxItems, boardInboxError, boardInboxLoading, refreshBoardInbox, placeBoardClip, changeBoardClip } from '../state/boardInbox.ts'
import { canEditBoard } from '../state/access.ts'
import { boardId, camera, viewport } from '../state/ui.ts'
import { showToast } from '../state/toast.ts'
import { phone } from '../state/device.ts'
import { placementAt } from './Toolbar.tsx'
import './board-inbox.css'

export function BoardInbox() {
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  const canPlace = () => canEditBoard(boardId())
  async function action(item: BoardInboxItem, run: () => Promise<unknown>) {
    if (busy()) return
    setBusy(item.id); setError('')
    try { await run() } catch (e) { setError(e instanceof Error ? e.message : 'Could not update this clip') } finally { setBusy(null) }
  }
  const place = (item: BoardInboxItem, at?: Vec & { columnId?: string }) => action(item, () => {
    const v = viewport()
    return placeBoardClip(item, at ?? screenToWorld(camera(), { x: v.width / 2, y: v.height * (phone() ? 0.16 : 0.38) }))
  })
  let stopDrag: (() => void) | undefined
  onCleanup(() => stopDrag?.())
  function drag(e: PointerEvent, item: BoardInboxItem) {
    if (e.button !== 0 || e.pointerType === 'touch' || !canPlace() || busy() || (e.target as HTMLElement).closest('button,a')) return
    stopDrag?.()
    const start = { x: e.clientX, y: e.clientY }, target = e.currentTarget as HTMLElement
    let moved = false
    target.setPointerCapture(e.pointerId)
    const move = (event: PointerEvent) => { moved ||= Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6; target.classList.toggle('inbox-dragging', moved) }
    const cleanup = () => { target.classList.remove('inbox-dragging'); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cleanup); stopDrag = undefined }
    const up = (event: PointerEvent) => {
      cleanup()
      if (!moved || !canPlace() || boardId() !== item.boardId || !(document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest('[data-testid="canvas"]')) return
      const placement = placementAt(event.clientX, event.clientY)
      if (placement) void place(item, 'at' in placement ? placement.at : { x: 0, y: 0, columnId: placement.columnId })
    }
    stopDrag = cleanup
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', cleanup)
  }
  return <section class="board-inbox" aria-label="This board’s Inbox" data-testid="board-inbox">
    <p class="toybox-sub">Images saved to this board wait here. {canPlace() ? 'Place them when you’re ready.' : 'An editor can place them on the canvas.'}</p>
    <Show when={error() || boardInboxError()}><p class="form-error" role="alert">{error() || boardInboxError()}</p><button class="bar-btn" onClick={() => void refreshBoardInbox()}>Retry</button></Show>
    <Show when={!boardInboxLoading() || boardInboxItems().length} fallback={<p role="status">Loading images…</p>}>
      <Show when={boardInboxItems().length} fallback={<p class="trash-empty">No images waiting. Save an image with the Chrome extension to collect it here.</p>}>
        <ul class="trash-list board-inbox-list"><For each={boardInboxItems()}>{(item) => <li class="board-inbox-item" data-testid="board-inbox-item" onPointerDown={(e) => drag(e, item)}>
          <InboxImage item={item} />
          <a href={safeHref(item.source.pageUrl) ?? '#'} target="_blank" rel="noopener noreferrer" class="board-inbox-source" title={item.source.pageTitle}>From {new URL(item.source.pageUrl).hostname}</a>
          <div class="board-inbox-actions"><span>{item.createdBy}</span><button class="bar-btn" disabled={!canPlace() || !!busy()} onClick={() => void place(item)}>Place</button><button class="bar-btn" disabled={!canPlace() || !!busy()} onClick={() => void action(item, async () => {
            await changeBoardClip(item, 'discard')
            showToast('Image discarded', 5000, { label: 'Undo', run: () => { void action(item, () => changeBoardClip(item, 'restore')) } })
          })}>Discard</button></div>
        </li>}</For></ul>
      </Show>
    </Show>
  </section>
}

function InboxImage(props: { item: BoardInboxItem }) {
  const [src, setSrc] = createSignal('')
  createEffect(() => { let alive = true; void assetUrl(props.item.image.assetId, 'small').then((url) => { if (alive) setSrc(url) }); onCleanup(() => { alive = false }) })
  return <img src={src() || undefined} alt={props.item.source.pageTitle || 'Saved image'} draggable={false} loading="lazy" style={{ 'aspect-ratio': `${props.item.image.width} / ${props.item.image.height}` }} />
}
