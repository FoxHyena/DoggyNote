import { For, Show, createSignal } from 'solid-js'
import { type Card, type Vec } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { moveCardTo } from '../state/actions.ts'
import { boardId, camera, viewport } from '../state/ui.ts'
import { toyboxCards, toyboxId } from '../state/toybox.ts'
import { addAnyFiles, addText } from '../canvas/paste.ts'
import { describeCard } from './TrashPanel.tsx'
import { placementAt } from './Toolbar.tsx'
import { Icon, ToolIcons } from './icons.tsx'
import { screenToWorld } from '@doggynote/core'

export const [toyboxOpen, setToyboxOpen] = createSignal(false)

/** Top-bar button: "Toy box · 3". */
export function ToyboxButton() {
  return (
    <button
      class="icon-btn"
      classList={{ on: toyboxOpen() }}
      data-testid="toybox-button"
      title={`${COPY.unsorted}: your private inbox (⌃⌥Space to capture from anywhere in the Mac app)`}
      onClick={() => setToyboxOpen(!toyboxOpen())}
    >
      <Icon>{ToolIcons.inbox()}</Icon>
      <span class="icon-btn-label">
        {COPY.unsorted}
        <Show when={toyboxCards().length}> · {toyboxCards().length}</Show>
      </span>
    </button>
  )
}

const centre = (): Vec => {
  const v = viewport()
  return screenToWorld(camera(), { x: v.width / 2, y: v.height / 2.6 })
}

export function ToyboxPanel() {
  const [draft, setDraft] = createSignal('')
  const [ghost, setGhost] = createSignal<{ card: Card; at: Vec } | null>(null)

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
    if (e.button !== 0) return
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
      if (!dragging) return
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
      <aside class="trash toybox" data-testid="toybox-panel" aria-label={COPY.unsorted} onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <header class="trash-head">
          <h2>{COPY.unsorted}</h2>
          <button class="icon-btn" title="Close" onClick={() => setToyboxOpen(false)}>
            <Icon>{ToolIcons.close()}</Icon>
          </button>
        </header>
        <p class="toybox-sub">Only you can see this. Drag things onto a board when you're ready.</p>
        <div class="toybox-add">
          <textarea
            data-testid="toybox-input"
            rows={2}
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
        </div>
        <Show when={toyboxCards().length} fallback={<p class="trash-empty">Nothing in your {COPY.unsorted.toLowerCase()} yet.</p>}>
          <ul class="trash-list">
            <For each={toyboxCards()}>
              {(c) => (
                <li class="trash-item toybox-item" data-testid="toybox-item" onPointerDown={(e) => startDrag(e, c)} title="Drag onto the board">
                  <span class="trash-type">{c.type}</span>
                  <span class="trash-text">{describeCard(c)}</span>
                  <button
                    class="bar-btn"
                    data-testid="toybox-place"
                    title="Put it in the middle of this board"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => moveCardTo(c.id, boardId(), { at: centre() })}
                  >
                    Place
                  </button>
                  <button
                    class="icon-btn"
                    title={`Move to ${COPY.trash}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => doc.update({ [c.id]: { deletedAt: Date.now() } })}
                  >
                    <Icon size={16}>{ToolIcons.trash()}</Icon>
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
