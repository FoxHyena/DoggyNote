import { For, Show, createEffect } from 'solid-js'
import * as doc from '../state/doc.ts'
import { editingId } from '../state/ui.ts'
import { touch } from '../state/device.ts'
import { FORMAT, activeNoteEditor } from '../cards/NoteCard.tsx'
import { Icon } from './icons.tsx'

// Touch editing a note: formatting on top of the keyboard (--vv-bottom,
// state/viewport.ts) instead of floating over the card. Buttons act on
// pointerdown and keep focus, so the keyboard stays up. There's no Done: closing
// the keyboard or tapping the board finishes the edit (canvas/Canvas.tsx).

// On a phone the dock is narrower than every format: list structure first (the
// keyboard has no Tab), then the text styles, which scroll into view.
const DOCK_ORDER = ['bullets', 'numbers', 'task', 'outdent', 'indent', 'bold', 'italic', 'strike', 'heading'] as const

export function EditDock() {
  const card = () => {
    const id = editingId()
    return id ? doc.getCard(id) : undefined
  }
  // While typing on touch, the board's own controls step away (mobile.css, stickers.css).
  createEffect(() => {
    const root = document.documentElement
    if (touch() && card()) root.dataset.touchEditing = ''
    else delete root.dataset.touchEditing
  })
  // Keep focus (and the keyboard) in the editor.
  const keep = (e: PointerEvent) => e.preventDefault()
  return (
    <Show when={touch() && card()?.type === 'note'}>
      <div class="edit-dock" data-testid="edit-dock" data-nodrag onPointerDown={keep}>
        <div class="edit-dock-tools" role="toolbar" aria-label="Formatting">
          <For each={DOCK_ORDER.map((cmd) => FORMAT.find((f) => f.cmd === cmd)!)}>
            {(f) => (
              <button class={`fmt fmt-${f.cmd}`} aria-label={f.title.split(':')[0]} data-testid={`dock-fmt-${f.cmd}`} onPointerDown={(e) => { keep(e); activeNoteEditor()?.run(f.cmd) }}>
                {f.cmd === 'task' ? <Icon size={20} name="todo" /> : f.label}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
