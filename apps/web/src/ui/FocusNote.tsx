import { Show, createEffect, createMemo, onCleanup, onMount } from 'solid-js'
import { noteMarkdown, parseMarkdown, type Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { boardId, editingId, endEdit, focusedNoteId, select, setFocusedNoteId } from '../state/ui.ts'
import { NoteEditor } from '../cards/NoteCard.tsx'
import { RichText } from '../editor/RichText.tsx'
import { SyncStatus } from './SyncStatus.tsx'
import './focus-note.css'

/** The existing edit session owns all saves, checkpoints, recovery and Undo. */
export function FocusNote() {
  return <Show when={focusedNoteId()} keyed>{(id) => <FocusSurface id={id} />}</Show>
}

function FocusSurface(props: { id: string }) {
  let dialog!: HTMLDialogElement
  const card = () => doc.getCard(props.id) as Card<'note'> | undefined
  const writable = () => !!card() && editingId() === props.id && doc.canEditNoteBody(card())
  const parsed = createMemo(() => writable() ? undefined : parseMarkdown(card() ? noteMarkdown(card()!) : ''))
  const close = () => {
    if (editingId() === props.id) endEdit()
    else setFocusedNoteId(null)
    select([props.id])
    // Restore a concrete canvas item, so Enter resumes editing that same note.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(props.id)}"]`)?.focus({ preventScroll: true }))
  }
  createEffect(() => {
    const c = card()
    if (!c || c.deletedAt || c.purged || c.boardId !== boardId()) setFocusedNoteId(null)
  })
  onMount(() => {
    dialog.showModal()
    onCleanup(() => dialog.close())
  })
  return <dialog ref={dialog} class="focus-note" role="dialog" aria-modal="true" aria-labelledby="focus-note-title" data-testid="focus-surface"
    onCancel={(e) => { e.preventDefault(); close() }}
    onKeyDown={(e) => {
      // Save details and other nested menus consume Escape first.
      if (e.defaultPrevented) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
      else if (e.key === 'Tab') {
        // WebKit's native modal Tab order follows the system keyboard setting
        // and can leave activeElement on body. Include the writing surface and
        // every visible control explicitly, with a predictable wrap in either direction.
        const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),a[href],[contenteditable="true"],[tabindex="0"]')].filter((el) => el.offsetParent !== null && !el.matches('.pm-buffer'))
        if (!items.length) return
        e.preventDefault()
        e.stopPropagation()
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length
        items[next]?.focus({ preventScroll: true })
      }
    }}>
    <header class="focus-note-header">
      <div class="focus-note-context"><h2 id="focus-note-title">{writable() ? 'Focused writing' : 'Focused reading'}</h2><p>{doc.getBoard(boardId())?.title ?? 'Board'}</p></div>
      <Show when={!doc.isReadOnly()}><SyncStatus /></Show>
      <button class="bar-btn focus-note-return" data-testid="focus-return" onClick={close}>Back to board <kbd>Esc</kbd></button>
    </header>
    <Show when={card()?.noteGroupId}><p class="focus-note-notice" data-testid="focus-synced-hint">{writable() ? 'Synced note · edits update linked notes' : 'Synced note · read-only body'}</p></Show>
    <Show when={!writable()}><p class="focus-note-notice">{card()?.noteGroupId ? 'Shared body is read-only with your current access.' : 'View only'}</p></Show>
    <div class="focus-note-document">
      <Show when={writable()} fallback={<div class="focus-note-reading" tabindex="0"><RichText doc={parsed()} /></div>}>
        <NoteEditor card={card()!} focused onExit={close} />
      </Show>
    </div>
  </dialog>
}
