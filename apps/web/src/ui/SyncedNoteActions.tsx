import { For, Show, createSignal } from 'solid-js'
import { boardDisplayTitle, COPY } from '@doggynote/theme'
import type { Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { canEditBoard } from '../state/access.ts'
import { copyNote, unlinkNote } from '../state/synced-notes.ts'
import { showToast } from '../state/toast.ts'
import { Popover } from './Popover.tsx'
import { Icon, IconButton, ToolIcons } from './icons.tsx'
import './synced-notes.css'

export function SyncedNoteActions(props: { card: Card }) {
  const [open, setOpen] = createSignal(false)
  let trigger!: HTMLButtonElement
  return <>
    <IconButton ref={(el) => (trigger = el)} testid="note-copies" icon={ToolIcons.copies} label="Note copies" title="Copy note: synced or independent" popup expanded={open()} onClick={() => setOpen(!open())} />
    <Show when={open()}><CopyMenu card={props.card} anchor={trigger} close={() => setOpen(false)} /></Show>
  </>
}

/** A dropdown, not a dialog: pick where, then synced or independent. */
function CopyMenu(props: { card: Card; anchor: HTMLElement; close: () => void }) {
  const [destination, setDestination] = createSignal(props.card.boardId)
  const [error, setError] = createSignal('')
  const boards = () => doc.index().boards.filter((b) => canEditBoard(b.id))
  const create = (synced: boolean) => {
    const id = copyNote(props.card.id, destination(), synced)
    if (!id) { setError('Your access changed. Choose an editable board and try again.'); return }
    props.close()
    showToast(synced ? 'Synced note added. Edits update linked notes.' : 'Independent copy added.', 5000, { label: 'Undo', run: () => doc.undo() })
  }
  return <Popover anchor={props.anchor} label="Note copies" testid="note-copies-menu" close={props.close}>
    <label class="popover-field">To<select aria-label="Destination board" value={destination()} onChange={(e) => setDestination(e.currentTarget.value)}><For each={boards()}>{(b) => <option value={b.id}>{b.id.startsWith('toybox:') ? COPY.unsorted : boardDisplayTitle(b)}{b.id === props.card.boardId ? ' (this board)' : ''}</option>}</For></select></label>
    <button class="popover-item" data-testid="create-synced-copy" disabled={!doc.canEditNoteBody(props.card)} onClick={() => create(true)}><Icon size={16}>{ToolIcons.copies()}</Icon><span>Synced copy<small>Edits to either update both</small></span></button>
    <button class="popover-item" data-testid="create-independent-copy" onClick={() => create(false)}><Icon size={16}>{ToolIcons.duplicate()}</Icon><span>Independent copy<small>Starts the same, then goes its own way</small></span></button>
    <Show when={props.card.noteGroupId}>
      <div class="popover-sep" />
      <button class="popover-item" data-testid="unlink-note" onClick={() => { unlinkNote(props.card.id); props.close(); showToast('Note unlinked. This text is now independent.', 5000, { label: 'Undo', run: () => doc.undo() }) }}><Icon size={16}>{ToolIcons.link()}</Icon><span>Unlink this copy<small>{props.card.noteBodyReadOnly ? 'Read-only here; unlink to write your own version' : 'Keeps its text; other copies stay linked'}</small></span></button>
    </Show>
    <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
  </Popover>
}
