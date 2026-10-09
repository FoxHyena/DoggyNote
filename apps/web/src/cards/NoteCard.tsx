import { For, Show, onCleanup, onMount } from 'solid-js'
import { isDocEmpty, type Card, type RichDoc } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { editIsNewCard, endEdit, onEndEdit } from '../state/ui.ts'
import { RichText } from '../editor/RichText.tsx'
import { takeEditCaret } from '../canvas/Canvas.tsx'
import type { CardProps } from '../canvas/CardView.tsx'
import type { NoteEditor as Editor } from '../editor/prosemirror.ts'

// Brand-new notes left empty disappear instead of littering the board.
onEndEdit((id) => {
  const c = doc.getCard(id) as Card<'note'> | undefined
  if (c?.type === 'note' && editIsNewCard() && isDocEmpty(c.content.doc)) doc.discardNew(id)
})

export function NoteCard(props: CardProps<'note'>) {
  return (
    <Show when={!props.lod} fallback={<div class="lod-box" style={{ height: `${Math.max(24, props.card.h - 24)}px` }} />}>
      <div class="note-body">
        <Show when={props.editing} fallback={<RichText doc={props.card.content.doc} />}>
          <NoteEditor card={props.card} />
        </Show>
      </div>
    </Show>
  )
}

const FORMAT: { cmd: 'bold' | 'italic' | 'strike' | 'heading' | 'bullets' | 'numbers'; label: string; title: string }[] = [
  { cmd: 'bold', label: 'B', title: 'Bold (⌘B)' },
  { cmd: 'italic', label: 'I', title: 'Italic (⌘I)' },
  { cmd: 'strike', label: 'S', title: 'Strikethrough (⌘⇧X)' },
  { cmd: 'heading', label: 'H', title: 'Heading (# )' },
  { cmd: 'bullets', label: '•', title: 'Bulleted list (- )' },
  { cmd: 'numbers', label: '1.', title: 'Numbered list (1. )' },
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
    const { createEditor, backspace } = await import('../editor/prosemirror.ts')
    if (disposed) return
    editor = createEditor(mount, props.card.content.doc, {
      placeAt: caret ?? undefined,
      onChange: (d: RichDoc) => doc.transient(id, { content: { doc: d } } as Partial<Card>),
      onExit: () => endEdit(),
    })
    buffer.remove()
    let exit = false
    for (const a of early) {
      if (a === 'exit') exit = true
      else if (a === 'selectAll') editor.selectAll()
      else if (a === 'enter') editor.typeText('\n')
      else if (a === 'backspace') backspace(editor.view)
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
