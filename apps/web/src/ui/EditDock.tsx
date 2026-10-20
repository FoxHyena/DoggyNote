import { For, Show } from 'solid-js'
import * as doc from '../state/doc.ts'
import { clearSelection, editingId, endEdit } from '../state/ui.ts'
import { touch } from '../state/device.ts'
import { FORMAT, activeNoteEditor } from '../cards/NoteCard.tsx'
import { Icon, ToolIcons } from './icons.tsx'

// Touch editing: formatting and a clear way out, sitting on top of the
// keyboard (--vv-bottom, state/viewport.ts) instead of floating over the card.
// Buttons act on pointerdown and keep focus, so the keyboard stays up.

export function EditDock() {
  const card = () => {
    const id = editingId()
    return id ? doc.getCard(id) : undefined
  }
  // Keep focus (and the keyboard) in the editor. Done is exempt: WebKit drops the click after a prevented touch.
  const keep = (e: PointerEvent) => {
    if (!(e.target as Element).closest('.edit-done')) e.preventDefault()
  }
  return (
    <Show when={touch() && card()}>
      <div class="edit-dock" data-testid="edit-dock" data-nodrag onPointerDown={keep}>
        <Show when={card()!.type === 'note'}>
          <div class="edit-dock-tools" role="toolbar" aria-label="Formatting">
            <For each={FORMAT}>
              {(f) => (
                <button class={`fmt fmt-${f.cmd}`} aria-label={f.title.split(':')[0]} data-testid={`dock-fmt-${f.cmd}`} onPointerDown={(e) => { keep(e); activeNoteEditor()?.run(f.cmd) }}>
                  {f.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        {/* Done means done with this card: back to the board, dock and all. */}
        <button class="edit-done" data-testid="edit-done" onClick={() => { endEdit(); clearSelection() }}>
          <Icon size={18}>{ToolIcons.check()}</Icon>
          Done
        </button>
      </div>
    </Show>
  )
}
