import { For, Index, Show, createSignal, onMount } from 'solid-js'
import { newId, type Card, type TodoItem } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { editIsNewCard, endEdit, onEndEdit } from '../state/ui.ts'
import { takeEditCaret } from '../canvas/Canvas.tsx'
import type { CardProps } from '../canvas/CardView.tsx'

type Content = Card<'todo'>['content']

onEndEdit((id) => {
  const c = doc.getCard(id) as Card<'todo'> | undefined
  if (c?.type !== 'todo') return
  const items = c.content.items.filter((i) => i.text.trim())
  if (editIsNewCard() && !items.length && !c.content.title.trim()) return doc.discardNew(id)
  // Drop blank rows left over from typing.
  if (items.length !== c.content.items.length) doc.transient(id, { content: { ...c.content, items } } as Partial<Card>)
})

const [cheer, setCheer] = createSignal<string | null>(null)

export function TodoCard(props: CardProps<'todo'>) {
  const id = props.card.id
  const content = () => props.card.content
  const setContent = (next: Content) => doc.transient(id, { content: next } as Partial<Card>)
  const done = () => content().items.filter((i) => i.done).length

  function toggle(item: TodoItem) {
    const items = content().items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i))
    const next = { ...content(), items }
    if (props.editing) setContent(next)
    else doc.update({ [id]: { content: next } as Partial<Card> })
    if (!item.done && items.length > 0 && items.every((i) => i.done)) {
      setCheer(id)
      setTimeout(() => setCheer((c) => (c === id ? null : c)), 1600)
    }
  }

  return (
    <Show when={!props.lod} fallback={<div class="lod-box" style={{ height: `${Math.max(24, props.card.h - 24)}px` }} />}>
      <div class="todo">
        <Show
          when={props.editing}
          fallback={
            <>
              <Show when={content().title}>
                <div class="todo-title">{content().title}</div>
              </Show>
              <ul class="todo-list">
                <For each={content().items}>
                  {(item) => (
                    <li class="todo-item" classList={{ done: item.done }}>
                      <input
                        type="checkbox"
                        class="todo-check"
                        data-nodrag
                        disabled={props.readOnly}
                        checked={item.done}
                        aria-label={item.text || 'task'}
                        onChange={() => toggle(item)}
                      />
                      <span class="todo-text">{item.text}</span>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={content().items.length > 1}>
                <div class="todo-progress">
                  {done()}/{content().items.length} done
                </div>
              </Show>
            </>
          }
        >
          <TodoEditor card={props.card} setContent={setContent} toggle={toggle} />
        </Show>
        <Show when={cheer() === id}>
          <div class="cheer" data-testid="cheer" aria-live="polite">
            <span class="cheer-paws" aria-hidden="true">🐾 🐾 🐾</span>
            {COPY.allDone}
          </div>
        </Show>
      </div>
    </Show>
  )
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = '0px'
  el.style.height = `${el.scrollHeight}px`
}

function TodoEditor(props: { card: Card<'todo'>; setContent: (c: Content) => void; toggle: (i: TodoItem) => void }) {
  let root!: HTMLDivElement
  const content = () => props.card.content

  const focusItem = (itemId: string, atEnd = true) =>
    queueMicrotask(() => {
      const el = root.querySelector<HTMLTextAreaElement>(`[data-item-id="${itemId}"]`)
      if (!el) return
      el.focus()
      if (atEnd) el.setSelectionRange(el.value.length, el.value.length)
    })

  onMount(() => {
    root.querySelectorAll('textarea').forEach((t) => autosize(t as HTMLTextAreaElement))
    const caret = takeEditCaret()
    const hit = caret && document.elementFromPoint(caret.x, caret.y)
    const target = hit && root.contains(hit) ? (hit.closest('textarea,input') as HTMLElement | null) : null
    if (target) return target.focus()
    const allBlank = content().items.every((i) => !i.text)
    const blank = content().items.find((i) => !i.text)
    // A brand-new list starts at its title; Enter moves to the first task.
    if (allBlank && !content().title) root.querySelector<HTMLInputElement>('.todo-title-input')?.focus()
    else if (blank) focusItem(blank.id)
    else focusItem(content().items[content().items.length - 1]?.id ?? '')
  })

  function setItem(itemId: string, text: string) {
    props.setContent({ ...content(), items: content().items.map((i) => (i.id === itemId ? { ...i, text } : i)) })
  }

  function insertAfter(itemId: string | null) {
    const item = { id: newId(), text: '', done: false }
    const items = [...content().items]
    const at = itemId ? items.findIndex((i) => i.id === itemId) + 1 : items.length
    items.splice(at, 0, item)
    props.setContent({ ...content(), items })
    focusItem(item.id)
  }

  function remove(itemId: string) {
    const items = content().items
    const idx = items.findIndex((i) => i.id === itemId)
    props.setContent({ ...content(), items: items.filter((i) => i.id !== itemId) })
    const prev = items[idx - 1]
    if (prev) focusItem(prev.id)
  }

  /** ⌥↑ / ⌥↓ moves a task. */
  function move(itemId: string, by: -1 | 1) {
    const items = [...content().items]
    const i = items.findIndex((x) => x.id === itemId)
    const j = i + by
    if (i < 0 || j < 0 || j >= items.length) return
    ;[items[i], items[j]] = [items[j], items[i]]
    props.setContent({ ...content(), items })
    focusItem(itemId)
  }

  function onKey(e: KeyboardEvent, item: TodoItem) {
    const el = e.currentTarget as HTMLTextAreaElement
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      move(item.id, e.key === 'ArrowUp' ? -1 : 1)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      insertAfter(item.id)
    } else if (e.key === 'Backspace' && el.value === '' && content().items.length > 1) {
      e.preventDefault()
      remove(item.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      endEdit()
    } else if (e.key === 'ArrowUp' && el.selectionStart === 0) {
      const items = content().items
      const prev = items[items.findIndex((i) => i.id === item.id) - 1]
      if (prev) {
        e.preventDefault()
        focusItem(prev.id)
      }
    } else if (e.key === 'ArrowDown' && el.selectionEnd === el.value.length) {
      const items = content().items
      const next = items[items.findIndex((i) => i.id === item.id) + 1]
      if (next) {
        e.preventDefault()
        focusItem(next.id)
      }
    }
  }

  return (
    <div ref={root} class="todo-editing">
      <input
        class="todo-title-input"
        data-testid="todo-title"
        placeholder="To-do list"
        value={content().title}
        onInput={(e) => props.setContent({ ...content(), title: e.currentTarget.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault()
            const first = content().items[0]
            if (first) focusItem(first.id)
            else insertAfter(null)
          } else if (e.key === 'Escape') endEdit()
        }}
      />
      <ul class="todo-list">
        {/* Index, not For: rows keep their textarea (and focus) while the item objects are replaced on each keystroke. */}
        <Index each={content().items}>
          {(item) => (
            <li class="todo-item" classList={{ done: item().done }}>
              <input type="checkbox" class="todo-check" checked={item().done} aria-label={item().text || 'task'} onChange={() => props.toggle(item())} />
              <textarea
                class="todo-input"
                data-item-id={item().id}
                data-testid="todo-item-input"
                rows={1}
                placeholder="Add a task…"
                title="Enter: new task · ⌥↑/⌥↓: move"
                value={item().text}
                onInput={(e) => {
                  autosize(e.currentTarget)
                  setItem(item().id, e.currentTarget.value)
                }}
                onKeyDown={(e) => onKey(e, item())}
              />
            </li>
          )}
        </Index>
      </ul>
      <button class="todo-add" data-testid="todo-add" onClick={() => insertAfter(null)}>
        + Add a task
      </button>
    </div>
  )
}
