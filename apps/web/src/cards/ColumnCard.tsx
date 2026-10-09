import { For, Show, createMemo } from 'solid-js'
import type { Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { endEdit } from '../state/ui.ts'
import { columnChildren } from '../state/actions.ts'
import { CardView, type CardProps } from '../canvas/CardView.tsx'
import { dropTarget } from '../canvas/dnd.ts'

export function ColumnCard(props: CardProps<'column'>) {
  const kids = createMemo(() => columnChildren(props.card.id))
  const drop = () => {
    const d = dropTarget()
    return d?.columnId === props.card.id ? d.index : -1
  }

  return (
    <div class="column" classList={{ 'drop-active': drop() >= 0 }}>
      <div class="column-head" data-edit-title>
        <Show
          when={props.editing}
          fallback={
            <div class="column-title" data-testid="column-title">
              {props.card.content.title || 'Column'}
            </div>
          }
        >
          <input
            ref={(el) => queueMicrotask(() => el.focus())}
            class="column-title-input"
            data-testid="column-title-input"
            placeholder="Column"
            value={props.card.content.title}
            onInput={(e) => doc.transient(props.card.id, { content: { title: e.currentTarget.value } } as Partial<Card>)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                endEdit()
              }
            }}
          />
        </Show>
        <div class="column-meta">
          {kids().length} card{kids().length === 1 ? '' : 's'}
        </div>
      </div>
      <div class="column-body" data-testid="column-body">
        <For each={kids()}>
          {(k, i) => (
            <>
              <Show when={drop() === i()}>
                <div class="drop-line" data-testid="drop-line" />
              </Show>
              <CardView card={k} lod={props.lod} readOnly={props.readOnly} inColumn />
            </>
          )}
        </For>
        <Show when={drop() === kids().length}>
          <div class="drop-line" data-testid="drop-line" />
        </Show>
        <Show when={!kids().length && drop() < 0}>
          <div class="column-empty">Drag cards here</div>
        </Show>
      </div>
    </div>
  )
}
