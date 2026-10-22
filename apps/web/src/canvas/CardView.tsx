import { ErrorBoundary, For, Match, Show, Switch, createSelector, onCleanup, onMount, type JSX } from 'solid-js'
import { SIDES, type Card } from '@doggynote/core'
import { COPY, cardColor, cardColorVars } from '@doggynote/theme'
import { isPreviewCurrent, previewBadge, type Badge } from '../state/preview.ts'
import { isPositionLocked } from '../state/position.ts'

const PREVIEW_CHIP: Record<Badge, string> = { added: 'New', changed: 'Edited', moved: 'Moved', removed: 'Buried' }
import { camera, editingId, isSelected, nearHandle, selection } from '../state/ui.ts'
import { touch } from '../state/device.ts'
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
import { MovieCard } from '../cards/MovieCard.tsx'
import { SwatchCard } from '../cards/SwatchCard.tsx'
import { SketchCard } from '../cards/SketchCard.tsx'
import { InkCard } from '../cards/InkCard.tsx'
import { CardLabels } from '../ui/Labels.tsx'

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
  // With a mouse, only the handle on the edge the pointer is near shows (canvas/Canvas.tsx).
  const isNear = createSelector(nearHandle)
  const selected = () => isSelected(props.card.id)
  const free = () => !props.card.columnId
  const single = () => selected() && selection().size === 1
  // On touch, handles only exist on the one selected card, at a fingertip size
  // that stays constant on screen (only this card follows the zoom).
  const touchHandles = () => touch() && single() && !editing() && !props.readOnly && !props.lod

  const style = (): JSX.CSSProperties => {
    const c = props.card
    const s: JSX.CSSProperties = {
      '--c-bg': cardColorVars(c.color).bg,
      '--c-text': cardColorVars(c.color).text,
    }
    if (free()) {
      // left/top, not transform: a thousand per-card transforms make the
      // browser re-layerize every card on every pan frame (61 ms vs 9 ms).
      s.left = `${c.x}px`
      s.top = `${c.y}px`
      s.width = `${c.w}px`
      s['z-index'] = String(c.z ?? 0)
    }
    if (touchHandles()) s['--hs'] = String(Math.round(Math.min(c.w / 3 / 18, 1 / camera().zoom) * 100) / 100)
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
        colored: cardColor(props.card.color) !== 'none',
      }}
      tabIndex={-1}
      data-card-id={props.card.id}
      data-testid="card"
      data-type={props.card.type}
      data-preview={previewBadge(props.card.id)}
      data-preview-current={isPreviewCurrent(props.card.id) || undefined}
      style={style()}
    >
      <Show when={!props.lod && previewBadge(props.card.id)}>
        {(b) => <span class="preview-chip" data-testid="preview-chip">{PREVIEW_CHIP[b()]}</span>}
      </Show>
      {/* Cards are synced data from other people: one malformed card must not take the board down. */}
      <ErrorBoundary fallback={<p class="card-unreadable" data-testid="card-unreadable">This card can't be shown.</p>}>
      <Switch
        fallback={
          // A card type from a newer app. Fixed at its stored height, so this app
          // never overwrites the real height the newer one measured.
          <div class="unknown-card" data-testid="unknown-card" style={{ height: `${Math.max(60, props.card.h)}px` }}>
            {COPY.unknownCard}
          </div>
        }
      >
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
        <Match when={props.card.type === 'movie'}>
          <MovieCard {...(props2() as CardProps<'movie'>)} />
        </Match>
        <Match when={props.card.type === 'swatch'}>
          <SwatchCard {...(props2() as CardProps<'swatch'>)} />
        </Match>
        <Match when={props.card.type === 'sketch'}>
          <SketchCard {...(props2() as CardProps<'sketch'>)} />
        </Match>
        <Match when={props.card.type === 'ink'}>
          <InkCard {...(props2() as CardProps<'ink'>)} />
        </Match>
        <Match when={props.card.type === 'column'}>
          <ColumnCard {...(props2() as CardProps<'column'>)} />
        </Match>
      </Switch>
      <Show when={!props.lod && props.card.type !== 'column'}>
        <CardLabels card={props.card} />
      </Show>
      </ErrorBoundary>
      <Show when={isPositionLocked(props.card.id) && !props.readOnly && !props.lod}>
        <span class="position-lock-badge" data-testid="position-lock-badge" title={props.card.positionLocked === true ? 'Position locked — select to unlock' : 'Column layout locked — unlock the column or its locked member'} aria-label="Position locked"><svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.5" y="6" width="9" height="7" rx="1.5" /><path d="M3.5 6V3.5a2.5 2.5 0 0 1 5 0V6" /></svg></span>
      </Show>
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
      <Show when={!props.readOnly && single() && free() && !isPositionLocked(props.card.id) && props.card.type !== 'board' && !props.lod}>
        <div class="resize-handle" data-resize data-testid="resize-handle" title="Resize" />
      </Show>
      {/* Lines join cards; a mark drawn on the board isn't one. */}
      <Show when={!props.readOnly && !props.lod && props.card.type !== 'ink' && (!touch() || touchHandles())}>
        <For each={SIDES}>
          {(side) => <div class={`connect-handle ${side}`} classList={{ near: isNear(`${props.card.id}:${side}`) }} data-connect-handle={side} data-testid={`connect-handle-${side}`} title="Drag to connect" />}
        </For>
      </Show>
    </div>
  )
}
