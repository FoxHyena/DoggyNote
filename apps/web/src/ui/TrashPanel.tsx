import { For, Show, createMemo } from 'solid-js'
import { mdToText, noteMarkdown, type Card } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { emptyTrash, restoreCard } from '../state/actions.ts'
import { boardId, setTrashOpen, trashOpen } from '../state/ui.ts'
import { Icon, ToolIcons } from './icons.tsx'

export function describeCard(c: Card): string {
  switch (c.type) {
    case 'note':
      return mdToText(noteMarkdown(c as Card<'note'>)).split('\n')[0] || 'Empty note'
    case 'todo': {
      const t = (c as Card<'todo'>).content
      return t.title || t.items[0]?.text || 'To-do list'
    }
    case 'board':
      return doc.getBoard((c as Card<'board'>).content.boardId)?.title || 'Board'
    case 'image':
      return 'Image'
    case 'link': {
      const l = (c as Card<'link'>).content
      return l.title || l.url
    }
    case 'column':
      return (c as Card<'column'>).content.title || 'Column'
  }
}

export function TrashPanel() {
  // Re-read whenever the document index changes (a restore, a new burial).
  const items = createMemo(() => (doc.index(), trashOpen() ? doc.trashedOn(boardId()) : []))
  return (
    <Show when={trashOpen()}>
      <aside class="trash" data-testid="trash-panel" aria-label={COPY.trash}>
        <header class="trash-head">
          <h2>{COPY.trash}</h2>
          <button class="icon-btn" title="Close" onClick={() => setTrashOpen(false)}>
            <Icon>{ToolIcons.close()}</Icon>
          </button>
        </header>
        <Show when={items().length} fallback={<p class="trash-empty">No bones buried on this board.</p>}>
          <ul class="trash-list">
            <For each={items()}>
              {(c) => (
                <li class="trash-item" data-testid="trash-item">
                  <span class="trash-type">{c.type}</span>
                  <span class="trash-text">{describeCard(c)}</span>
                  <button class="bar-btn" data-testid="restore" title="Dig it back up" onClick={() => restoreCard(c.id)}>
                    <Icon size={16}>{ToolIcons.restore()}</Icon>
                    Restore
                  </button>
                </li>
              )}
            </For>
          </ul>
          <button class="danger-btn" data-testid="empty-trash" onClick={() => emptyTrash(items())}>
            Empty {COPY.trash.toLowerCase()}
          </button>
        </Show>
      </aside>
    </Show>
  )
}
