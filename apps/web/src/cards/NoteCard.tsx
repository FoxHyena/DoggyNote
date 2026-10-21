import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { noteMarkdown, parseMarkdown, toggleTask, type Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { camera, currentEditSession, editIsNewCard, editingId, endEdit, focusNote, focusedNoteId, onEndEdit } from '../state/ui.ts'
import { RichText } from '../editor/RichText.tsx'
import { takeEditCaret } from '../canvas/Canvas.tsx'
import type { CardProps } from '../canvas/CardView.tsx'
import type { FormatCommand, NoteEditor as Editor } from '../editor/codemirror.ts'
import { exporting } from '../state/export.ts'
import type { EditorState } from '@codemirror/state'
import { touch } from '../state/device.ts'

// Brand-new notes left empty disappear instead of littering the board.
onEndEdit((id) => {
  const c = doc.getCard(id) as Card<'note'> | undefined
  if (c?.type === 'note' && editIsNewCard() && !noteMarkdown(c).trim()) doc.discardNew(id)
})

export function NoteCard(props: CardProps<'note'>) {
  const source = () => noteMarkdown(props.card)
  const parsed = createMemo(() => parseMarkdown(source()))
  // Ticking a task in the rendered note edits its markdown line (one undo step).
  const toggle = (line: number) => doc.update({ [props.card.id]: { content: { md: toggleTask(source(), line) } } as Partial<Card> })
  return (
    <Show when={!props.lod} fallback={<div class="lod-box" style={{ height: `${Math.max(24, props.card.h - 24)}px` }} />}>
      <Show when={props.card.noteGroupId}>
        <div class="synced-note-hint" data-testid="synced-note-hint" title={props.readOnly ? 'View-only synced note.' : props.card.noteBodyReadOnly ? 'Shared body is read-only with your current access. Unlink this instance to edit independently.' : 'Edits update linked notes. Layout and colour stay here.'}>
          {props.readOnly || props.card.noteBodyReadOnly ? 'Synced note · read-only body' : 'Synced note · edits update linked notes'}
        </div>
      </Show>
      <div class="note-body">
        <Show when={props.editing && focusedNoteId() !== props.card.id} fallback={<RichText doc={parsed()} onToggleTask={props.readOnly || !doc.canEditNoteBody(props.card) ? undefined : toggle} />}>
          <NoteEditor card={props.card} />
        </Show>
        <Show when={!exporting() && !props.editing && props.readOnly}>
          <button class="note-focus-trigger bar-btn" data-nodrag data-testid="focus-note" title="Open note in a larger surface" onPointerDown={(e) => e.stopPropagation()} onClick={() => focusNote(props.card.id)}>Focus</button>
        </Show>
      </div>
    </Show>
  )
}

/** The note being edited, for formatting controls outside the card (the touch edit dock). */
export const [activeNoteEditor, setActiveNoteEditor] = createSignal<Editor | null>(null)

export const FORMAT: { cmd: FormatCommand; label: string; title: string }[] = [
  { cmd: 'bold', label: 'B', title: 'Bold: **text** (⌘B)' },
  { cmd: 'italic', label: 'I', title: 'Italic: _text_ (⌘I)' },
  { cmd: 'strike', label: 'S', title: 'Strikethrough: ~~text~~ (⌘⇧X)' },
  { cmd: 'heading', label: 'H', title: 'Heading: ## ' },
  { cmd: 'bullets', label: '•', title: 'Bulleted list: - ' },
  { cmd: 'numbers', label: '1.', title: 'Numbered list: 1. ' },
  { cmd: 'task', label: '☐', title: 'Task: - [ ] ' },
  { cmd: 'outdent', label: '⇤', title: 'Outdent: move a list item out (⇧Tab)' },
  { cmd: 'indent', label: '⇥', title: 'Indent: nest a list item (Tab)' },
]

// Keep only local editor presentation. History crosses the surface transition
// within one edit session, but cannot undo into an earlier board transaction.
type Position = { anchor: number; head: number; scroll: number; session: number; state?: EditorState }
const positions = new Map<string, Position>()

export function NoteEditor(props: { card: Card<'note'>; focused?: boolean; onExit?: () => void }) {
  let mount!: HTMLDivElement
  let buffer!: HTMLTextAreaElement
  let editor: Editor | null = null
  let disposed = false
  const [loadProblem, setLoadProblem] = createSignal(false)
  const id = props.card.id
  const session = currentEditSession()
  let remembered = positions.get(id)
  let earlyInteraction = false
  const exit = () => props.onExit ? props.onExit() : endEdit()
  // The initial textarea uses the same Markdown and checkpoints every input.
  // Even a close during lazy loading must retain the last character.
  const saveBuffer = () => { earlyInteraction = true; doc.transient(id, { content: { md: buffer.value } } as Partial<Card>) }
  // Tab before the editor loads keeps focus in the note and nests the list item once it has.
  const earlyIndents: ('indent' | 'outdent')[] = []

  onMount(async () => {
    const tap = props.focused ? null : takeEditCaret()
    const box0 = mount.getBoundingClientRect()
    const z0 = props.focused ? 1 : camera().zoom
    const rel = tap && { x: (tap.x - box0.left) / z0, y: (tap.y - box0.top) / z0 }
    buffer.value = noteMarkdown(props.card)
    buffer.setSelectionRange(remembered?.anchor ?? buffer.value.length, remembered?.head ?? buffer.value.length)
    buffer.focus({ preventScroll: true })
    let module: typeof import('../editor/codemirror.ts')
    try { module = await import('../editor/codemirror.ts') } catch {
      if (!disposed) setLoadProblem(true)
      return
    }
    if (disposed) return
    const { createEditor } = module
    // The other surface's cleanup may run after this component was created.
    // Read its handoff after the import microtask, before choosing the caret.
    remembered = positions.get(id)
    const selection = !earlyInteraction && remembered ? { anchor: remembered.anchor, head: remembered.head } : { anchor: buffer.selectionStart, head: buffer.selectionEnd }
    const box = mount.getBoundingClientRect()
    const z = props.focused ? 1 : camera().zoom
    editor = createEditor(mount, noteMarkdown(props.card), {
      placeAt: rel ? { x: box.left + rel.x * z, y: box.top + rel.y * z } : undefined,
      state: !earlyInteraction && remembered?.session === session ? remembered.state : undefined,
      selection: rel ? undefined : selection,
      onChange: (md: string) => doc.transient(id, { content: { md } } as Partial<Card>),
      onExit: exit,
    })
    setActiveNoteEditor(editor)
    buffer.remove()
    for (const cmd of earlyIndents) editor.run(cmd)
    if (props.focused && remembered) editor.view.scrollDOM.scrollTop = remembered.scroll
  })
  onCleanup(() => {
    disposed = true
    if (editor) {
      const { anchor, head } = editor.view.state.selection.main
      positions.delete(id)
      positions.set(id, { anchor, head, scroll: props.focused ? editor.view.scrollDOM.scrollTop : remembered?.scroll ?? 0, session, state: editingId() === id && doc.canEditNoteBody(doc.getCard(id)) ? editor.view.state : undefined })
      if (positions.size > 30) positions.delete(positions.keys().next().value!)
    }
    if (!editor) positions.set(id, { anchor: buffer.selectionStart, head: buffer.selectionEnd, scroll: remembered?.scroll ?? 0, session })
    if (positions.size > 30) positions.delete(positions.keys().next().value!)
    if (activeNoteEditor() === editor) setActiveNoteEditor(null)
    editor?.destroy()
  })

  return (
    <>
      <Show when={!touch() || props.focused}>
      <div class="format-bar" data-nodrag data-testid="format-bar">
        <For each={FORMAT}>
          {(f) => (
            <button
              class={`fmt fmt-${f.cmd}`}
              data-testid={`fmt-${f.cmd}`}
              title={f.title}
              disabled={loadProblem()}
              aria-label={f.title.split(':')[0]}
              onClick={(e) => { if (e.detail === 0) editor?.run(f.cmd) }}
              onPointerDown={(e) => {
                e.preventDefault()
                editor?.run(f.cmd)
              }}
            >
              {f.label}
            </button>
          )}
        </For>
        <Show when={!props.focused}><button class="bar-btn" data-testid="focus-note" title="Open note in a larger surface" onPointerDown={(e) => e.preventDefault()} onClick={() => focusNote(id)}>Focus</button></Show>
      </div>
      </Show>
      <Show when={loadProblem()}><p class="note-editor-failure" role="status">Formatting is unavailable. You can keep writing Markdown; changes still save.</p></Show>
      <textarea ref={buffer} class={loadProblem() ? 'pm-fallback' : 'pm-buffer'} aria-label={loadProblem() ? 'Note Markdown' : 'Note loading'} onInput={saveBuffer} onKeyDown={(e) => { earlyInteraction = true; if (e.key === 'Escape') { e.preventDefault(); exit() } else if (e.key === 'Tab' && !loadProblem()) { e.preventDefault(); earlyIndents.push(e.shiftKey ? 'outdent' : 'indent') } }} />
      <div ref={mount} class="note-editor" />
    </>
  )
}
