import { installCanvasPanel } from './canvasPanel.ts'
import './canvas-entry.css'
import { For, Show, createSignal } from 'solid-js'
import { type Card, type Vec } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { moveCardTo } from '../state/actions.ts'
import { canEditBoard } from '../state/access.ts'
import { boardId, camera, viewport } from '../state/ui.ts'
import { toyboxCards, toyboxId } from '../state/toybox.ts'
import { addAnyFiles, addText } from '../canvas/paste.ts'
import { describeCard } from './TrashPanel.tsx'
import { placementAt } from './Toolbar.tsx'
import { Icon } from './icons.tsx'
import { phone, touch } from '../state/device.ts'
import { showToast } from '../state/toast.ts'
import { screenToWorld } from '@doggynote/core'

export const [toyboxOpen, setToyboxOpen] = createSignal(false)

/** Top-bar button: "Inbox · 3". */
export function ToyboxButton() {
  return (
    <button
      class="icon-btn"
      classList={{ on: toyboxOpen() }}
      data-testid="toybox-button"
      aria-expanded={toyboxOpen()}
      data-tooltip={`Your private ${COPY.unsorted}`}
      onClick={() => setToyboxOpen(!toyboxOpen())}
    >
      <Icon name="inbox" />
      <span class="icon-btn-label">
        {COPY.unsorted}
        <Show when={toyboxCards().length}><span class="count-inline"> · {toyboxCards().length}</span></Show>
      </span>
      <Show when={toyboxCards().length}><span class="count-badge" aria-hidden="true">{toyboxCards().length}</span></Show>
    </button>
  )
}

const centre = (): Vec => {
  const v = viewport()
  // On a phone the Inbox sheet covers the lower part: place where it can be seen.
  return screenToWorld(camera(), { x: v.width / 2, y: phone() ? v.height * 0.16 : v.height / 2.6 })
}

export function ToyboxPanel() {
  let panel: HTMLElement | undefined
  installCanvasPanel(toyboxOpen, () => setToyboxOpen(false), () => panel, () => document.querySelector('[data-testid="toybox-button"]'))
  const [draft, setDraft] = createSignal('')
  let photo!: HTMLInputElement
  const [ghost, setGhost] = createSignal<{ card: Card; at: Vec } | null>(null)
  const canPlace = () => canEditBoard(boardId())

  const add = () => {
    const tb = toyboxId()
    if (!tb || !draft().trim()) return
    addText(draft(), { x: 0, y: 0 }, tb)
    setDraft('')
  }

  const onPaste = (e: ClipboardEvent) => {
    const tb = toyboxId()
    const dt = e.clipboardData
    if (!tb || !dt) return
    if (dt.files.length) {
      e.preventDefault()
      addAnyFiles([...dt.files], { x: 0, y: 0 }, tb)
    }
  }

  const onDrop = (e: DragEvent) => {
    const tb = toyboxId()
    const dt = e.dataTransfer
    if (!tb || !dt) return
    e.preventDefault()
    if (addAnyFiles([...dt.files], { x: 0, y: 0 }, tb)) return
    const text = dt.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#')) || dt.getData('text/plain')
    if (text) addText(text, { x: 0, y: 0 }, tb)
  }

  /** Drag an item out of the panel onto the board (or into a column). */
  function startDrag(e: PointerEvent, card: Card) {
    // Touch scrolls the list; items go onto the board with Place.
    if (e.button !== 0 || !canPlace() || e.pointerType === 'touch') return
    const start = { x: e.clientX, y: e.clientY }
    let dragging = false
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) dragging = true
      if (dragging) setGhost({ card, at: { x: ev.clientX, y: ev.clientY } })
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setGhost(null)
      if (!dragging || !canPlace()) return
      // Dropped back on the panel: nothing to do.
      if ((document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.toybox')) return
      const place = placementAt(ev.clientX, ev.clientY)
      if (!place || ('columnId' in place && card.type === 'column')) return
      moveCardTo(card.id, boardId(), place)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <Show when={toyboxOpen()}>
      <aside ref={panel} class="trash toybox" data-testid="toybox-panel" aria-label={COPY.unsorted} onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <header class="trash-head">
          <h2>{COPY.unsorted}</h2>
          <button class="icon-btn" title="Close" onClick={() => setToyboxOpen(false)}>
            <Icon name="close" />
          </button>
        </header>
        <p class="toybox-sub">Only you can see this. {touch() ? 'Place things onto a board when you\'re ready.' : 'Drag things onto a board when you\'re ready.'}</p>
        <Show when={!canPlace()}><p class="toybox-sub" id="toybox-move-hint">You need editing access to place items on this board. You can still add to your {COPY.unsorted}.</p></Show>
        <div class="toybox-add">
          <textarea
            data-testid="toybox-input"
            rows={2}
            enterkeyhint="send"
            placeholder="Jot something down, or paste a link or image…"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                add()
              }
            }}
          />
          <div class="toybox-add-actions">
            <button class="icon-btn" data-testid="toybox-photo" aria-label="Add a photo" title="Add a photo" onClick={() => photo.click()}>
              <Icon name="image" />
            </button>
            <button class="primary-btn" data-testid="toybox-add" disabled={!draft().trim()} onClick={add}>Add</button>
          </div>
          <input
            ref={photo}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const tb = toyboxId()
              const files = [...(e.currentTarget.files ?? [])]
              e.currentTarget.value = ''
              if (tb && files.length) addAnyFiles(files, { x: 0, y: 0 }, tb)
            }}
          />
        </div>
        <Show when={toyboxCards().length} fallback={<p class="trash-empty">{COPY.inboxEmpty}</p>}>
          <ul class="trash-list">
            <For each={toyboxCards()}>
              {(c) => (
                <li class="trash-item toybox-item" data-testid="toybox-item" onPointerDown={(e) => startDrag(e, c)} title={canPlace() ? 'Drag onto the board' : 'You need editing access to place items on this board'} style={{ cursor: canPlace() ? 'grab' : 'default' }}>
                  <span class="trash-type">{c.type}</span>
                  <span class="trash-text">{describeCard(c)}</span>
                  <button
                    class="bar-btn"
                    data-testid="toybox-place"
                    disabled={!canPlace()}
                    aria-describedby={!canPlace() ? 'toybox-move-hint' : undefined}
                    title={canPlace() ? 'Put it in the middle of this board' : 'You need editing access to this board'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      moveCardTo(c.id, boardId(), { at: centre() })
                      if (touch()) showToast('Placed on this board', 4000, { label: 'Undo', run: () => doc.undo() })
                    }}
                  >
                    Place
                  </button>
                  <button
                    class="icon-btn"
                    data-testid="toybox-bury"
                    title={`Move to ${COPY.trash}`}
                    aria-label={`Move to ${COPY.trash}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      doc.update({ [c.id]: { deletedAt: Date.now() } })
                      showToast(`${COPY.buried} 1 card`, 5000, { label: 'Undo', run: () => doc.undo() })
                    }}
                  >
                    <Icon size={16} name="bury" />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={ghost()}>
          <div class="tool-ghost" style={{ left: `${ghost()!.at.x}px`, top: `${ghost()!.at.y}px` }}>
            {describeCard(ghost()!.card)}
          </div>
        </Show>
      </aside>
    </Show>
  )
}
