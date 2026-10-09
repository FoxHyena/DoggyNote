import { For, Show, createMemo, onCleanup, onMount } from 'solid-js'
import { noteMarkdown, parseMarkdown, toggleTask, type Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { editIsNewCard, endEdit, onEndEdit } from '../state/ui.ts'
import { RichText } from '../editor/RichText.tsx'
import { takeEditCaret } from '../canvas/Canvas.tsx'
import type { CardProps } from '../canvas/CardView.tsx'
import type { FormatCommand, NoteEditor as Editor } from '../editor/codemirror.ts'

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
      <div class="note-body">
        <Show when={props.editing} fallback={<RichText doc={parsed()} onToggleTask={props.readOnly ? undefined : toggle} />}>
          <NoteEditor card={props.card} />
        </Show>
      </div>
    </Show>
  )
}

const FORMAT: { cmd: FormatCommand; label: string; title: string }[] = [
  { cmd: 'bold', label: 'B', title: 'Bold: **text** (⌘B)' },
  { cmd: 'italic', label: 'I', title: 'Italic: _text_ (⌘I)' },
  { cmd: 'strike', label: 'S', title: 'Strikethrough: ~~text~~ (⌘⇧X)' },
  { cmd: 'heading', label: 'H', title: 'Heading: ## ' },
  { cmd: 'bullets', label: '•', title: 'Bulleted list: - ' },
  { cmd: 'numbers', label: '1.', title: 'Numbered list: 1. ' },
  { cmd: 'task', label: '☐', title: 'Task: - [ ] ' },
]

function NoteEditor(props: { card: Card<'note'> }) {
  let mount!: HTMLDivElement
  let editor: Editor | null = null
  let disposed = false
  const id = props.card.id

  // Keys that arrive before ProseMirror has mounted land in this buffer as a
  // list of actions, replayed in order once the editor exists.
  let buffer!: HTMLTextAreaElement
  type Early = { text: string } | 'selectAll' | 'enter' | 'backspace' | 'exit'
  const early: Early[] = []

  const onBufferKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    const act: Early | null =
      mod && e.key.toLowerCase() === 'a' ? 'selectAll' : e.key === 'Enter' ? 'enter' : e.key === 'Backspace' ? 'backspace' : e.key === 'Escape' ? 'exit' : null
    if (!act) return
    e.preventDefault()
    early.push(act)
  }
  const onBufferInput = () => {
    if (buffer.value) early.push({ text: buffer.value })
    buffer.value = ''
  }

  onMount(async () => {
    const caret = takeEditCaret()
    buffer.focus()
    buffer.addEventListener('keydown', onBufferKey)
    buffer.addEventListener('input', onBufferInput)
    const { createEditor } = await import('../editor/codemirror.ts')
    if (disposed) return
    editor = createEditor(mount, noteMarkdown(props.card), {
      placeAt: caret ?? undefined,
      onChange: (md: string) => doc.transient(id, { content: { md } } as Partial<Card>),
      onExit: () => endEdit(),
    })
    buffer.remove()
    let exit = false
    for (const a of early) {
      if (a === 'exit') exit = true
      else if (a === 'selectAll') editor.selectAll()
      else if (a === 'enter') editor.typeText('\n')
      else if (a === 'backspace') editor.backspace()
      else editor.typeText(a.text)
    }
    if (exit) endEdit()
  })
  onCleanup(() => {
    disposed = true
    editor?.destroy()
  })

  return (
    <>
      <div class="format-bar" data-nodrag data-testid="format-bar">
        <For each={FORMAT}>
          {(f) => (
            <button
              class={`fmt fmt-${f.cmd}`}
              title={f.title}
              onPointerDown={(e) => {
                e.preventDefault()
                editor?.run(f.cmd)
              }}
            >
              {f.label}
            </button>
          )}
        </For>
      </div>
      <textarea ref={buffer} class="pm-buffer" aria-hidden="true" tabindex="-1" />
      <div ref={mount} class="note-editor" />
    </>
  )
}
