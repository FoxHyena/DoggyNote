import { For, Match, Show, Switch, onCleanup, onMount, type JSX } from 'solid-js'
import { SIDES, type Card } from '@doggynote/core'
import { editingId, isSelected, selection } from '../state/ui.ts'
import { registerCardEl } from './layout.ts'
import * as doc from '../state/doc.ts'
import { isResolved } from '../state/comments.ts'
import { openThread } from '../ui/CommentsPanel.tsx'
import { Icon, ToolIcons } from '../ui/icons.tsx'
import { draggingIds, resizingId } from './dnd.ts'
import { NoteCard } from '../cards/NoteCard.tsx'
import { TodoCard } from '../cards/TodoCard.tsx'
import { BoardCard } from '../cards/BoardCard.tsx'
import { ImageCard } from '../cards/ImageCard.tsx'
import { LinkCard } from '../cards/LinkCard.tsx'
import { ColumnCard } from '../cards/ColumnCard.tsx'
import { FileCard } from '../cards/FileCard.tsx'

export type CardProps<T extends Card['type'] = Card['type']> = {
  card: Card<T>
  editing: boolean
  lod: boolean
  readOnly: boolean
}

export function CardView(props: { card: Card; lod: boolean; readOnly: boolean; inColumn?: boolean }) {
  let el!: HTMLDivElement
  onMount(() => onCleanup(registerCardEl(props.card.id, el)))

  const editing = () => editingId() === props.card.id
  const selected = () => isSelected(props.card.id)
  const free = () => !props.card.columnId
  const single = () => selected() && selection().size === 1

  const style = (): JSX.CSSProperties => {
    const c = props.card
    const s: JSX.CSSProperties = {
      '--c-bg': `var(--dn-card-${c.color ?? 'none'}-bg)`,
      '--c-text': `var(--dn-card-${c.color ?? 'none'}-text)`,
    }
    if (free()) {
      // left/top, not transform: a thousand per-card transforms make the
      // browser re-layerize every card on every pan frame (61 ms vs 9 ms).
      s.left = `${c.x}px`
      s.top = `${c.y}px`
      s.width = `${c.w}px`
      s['z-index'] = String(c.z ?? 0)
    }
    return s
  }

  const comments = () => (props.card.type === 'board' ? 0 : doc.commentsOn(props.card.id).length)

  const props2 = () => ({ card: props.card, editing: editing(), lod: props.lod, readOnly: props.readOnly })

  return (
    <div
      ref={el}
      class={`card card-${props.card.type}`}
      classList={{
        free: free(),
        'in-column': !free(),
        selected: selected(),
        editing: editing(),
        dragging: draggingIds().has(props.card.id),
        resizing: resizingId() === props.card.id,
        colored: props.card.color !== 'none' && !!props.card.color,
      }}
      data-card-id={props.card.id}
      data-testid="card"
      data-type={props.card.type}
      style={style()}
    >
      <Switch>
        <Match when={props.card.type === 'note'}>
          <NoteCard {...(props2() as CardProps<'note'>)} />
        </Match>
        <Match when={props.card.type === 'todo'}>
          <TodoCard {...(props2() as CardProps<'todo'>)} />
        </Match>
        <Match when={props.card.type === 'board'}>
          <BoardCard {...(props2() as CardProps<'board'>)} />
        </Match>
        <Match when={props.card.type === 'image'}>
          <ImageCard {...(props2() as CardProps<'image'>)} />
        </Match>
        <Match when={props.card.type === 'link'}>
          <LinkCard {...(props2() as CardProps<'link'>)} />
        </Match>
        <Match when={props.card.type === 'file'}>
          <FileCard {...(props2() as CardProps<'file'>)} />
        </Match>
        <Match when={props.card.type === 'column'}>
          <ColumnCard {...(props2() as CardProps<'column'>)} />
        </Match>
      </Switch>
      <Show when={comments() && !props.lod}>
        <button
          class="comment-badge"
          classList={{ resolved: isResolved(props.card.id) }}
          data-testid="comment-badge"
          title={isResolved(props.card.id) ? 'Resolved thread' : 'Comments'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            openThread(props.card.id)
          }}
        >
          <Icon size={13}>{ToolIcons.comment()}</Icon>
          {comments()}
        </button>
      </Show>
      <Show when={!props.readOnly && single() && free() && props.card.type !== 'board' && !props.lod}>
        <div class="resize-handle" data-resize data-testid="resize-handle" title="Resize" />
      </Show>
      <Show when={!props.readOnly && !props.lod}>
        <For each={SIDES}>
          {(side) => <div class={`connect-handle ${side}`} data-connect-handle={side} data-testid={`connect-handle-${side}`} title="Drag to connect" />}
        </For>
      </Show>
    </div>
  )
}
