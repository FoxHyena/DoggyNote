import { installCanvasPanel } from './canvasPanel.ts'
import './canvas-entry.css'
import { For, Show, createMemo } from 'solid-js'
import { cardLabel, type Card, type Sticker } from '@doggynote/core'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { emptyTrash, restoreCard } from '../state/actions.ts'
import { purgeComments, restoreComment } from '../state/comments.ts'
import { boardId, setTrashOpen, trashOpen } from '../state/ui.ts'
import { Icon } from './icons.tsx'

/** A short label; stickers name their emoji and pack, and a malformed (synced) one gets a generic label. */
export function describeCard(c: Card | Sticker): string {
  if (c.kind !== 'sticker') return cardLabel(c, (id) => boardDisplayTitle(doc.getBoard(id), 'Board'))
  try { return `${c.content.emoji || 'Sticker'} · ${c.content.packName}` } catch { return 'Sticker' }
}

export function TrashPanel() {
  let panel: HTMLElement | undefined
  installCanvasPanel(trashOpen, () => setTrashOpen(false), () => panel, () => document.querySelector('[data-testid="tool-trash"]'))
  // Re-read whenever the document index changes (a restore, a new burial).
  const items = createMemo(() => (doc.index(), trashOpen() ? doc.trashedOn(boardId()) : []))
  const comments = createMemo(() => (doc.index(), trashOpen() ? doc.trashedCommentsOn(boardId()) : []))
  return (
    <Show when={trashOpen()}>
      <aside ref={panel} class="trash" data-testid="trash-panel" aria-label={COPY.trash}>
        <header class="trash-head">
          <h2>{COPY.trash}</h2>
          <button class="icon-btn" title="Close" onClick={() => setTrashOpen(false)}>
            <Icon name="close" />
          </button>
        </header>
        <Show when={items().length || comments().length} fallback={<p class="trash-empty">{COPY.buriedEmpty}</p>}>
          <ul class="trash-list">
            <For each={items()}>
              {(c) => (
                <li class="trash-item" data-testid="trash-item">
                  <span class="trash-type">{c.kind === 'sticker' ? 'sticker' : c.type}</span>
                  <span class="trash-text">{describeCard(c)}</span>
                  <button class="bar-btn" data-testid="restore" title="Restore: dig it back up" onClick={() => restoreCard(c.id)}>
                    <Icon size={16} name="restore" />
                    Restore
                  </button>
                </li>
              )}
            </For>
            <For each={comments()}>
              {(m) => (
                <li class="trash-item" data-testid="trash-comment">
                  <span class="trash-type">comment</span>
                  <span class="trash-text">{m.text.split('\n')[0]}</span>
                  <button class="bar-btn" data-testid="restore-comment" title="Put it back in the thread" onClick={() => restoreComment(m.id)}>
                    <Icon size={16} name="restore" />
                    Restore
                  </button>
                </li>
              )}
            </For>
          </ul>
          <button
            class="danger-btn"
            data-testid="empty-trash"
            onClick={() => {
              if (items().length) emptyTrash(items())
              purgeComments(comments().map((m) => m.id))
            }}
          >
            <Icon name="trash" size={16} /> Empty {COPY.trash.toLowerCase()}
          </button>
        </Show>
      </aside>
    </Show>
  )
}
