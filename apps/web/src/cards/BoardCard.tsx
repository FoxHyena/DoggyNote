import { Show, createMemo, onMount } from 'solid-js'
import type { Card, Id } from '@doggynote/core'
import { boardDisplayTitle, cardColorVars } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { endEdit, onEndEdit } from '../state/ui.ts'
import { BoardIconSvg } from '../ui/icons.tsx'
import { unreadInside, unreadLabel } from '../state/unread.ts'
import type { CardProps } from '../canvas/CardView.tsx'

export const UNTITLED_BOARD = 'Untitled board'

onEndEdit((id) => {
  const c = doc.getCard(id) as Card<'board'> | undefined
  if (c?.type !== 'board') return
  const b = doc.getBoard(c.content.boardId)
  if (b && !b.title.trim()) doc.transient(b.id, { title: UNTITLED_BOARD })
})

/** "15 boards, 3 cards", counting only direct children like Milanote does. */
export function boardCounts(boardId: Id): string {
  let boards = 0
  let cards = 0
  for (const c of doc.cardsOn(boardId)) {
    if (c.type === 'board') boards++
    else cards++
  }
  const parts: string[] = []
  if (boards) parts.push(`${boards} board${boards === 1 ? '' : 's'}`)
  if (cards || !boards) parts.push(`${cards} card${cards === 1 ? '' : 's'}`)
  return parts.join(', ')
}

export function BoardCard(props: CardProps<'board'>) {
  const board = () => doc.getBoard(props.card.content.boardId)
  const counts = createMemo(() => boardCounts(props.card.content.boardId))
  let input!: HTMLInputElement

  onMount(() => {
    if (props.editing) input?.focus()
  })

  return (
    <div class="board-card" data-open-board={props.card.content.boardId} title={props.readOnly ? 'Open board' : 'Double-click to open · Enter to rename'}>
      <div class="board-tile" style={{ '--tile-bg': cardColorVars(board()?.color, 'gold').bg, '--tile-fg': cardColorVars(board()?.color, 'gold').text }}>
        <BoardIconSvg icon={board()?.icon ?? 'paw'} size={30} />
        <Show when={!props.lod && unreadInside(props.card.content.boardId)}>
          {(n) => <span class="unread-dot board-unread" data-testid="board-unread" role="img" aria-label={`${unreadLabel(n())} inside`} />}
        </Show>
      </div>
      <Show
        when={props.editing}
        fallback={
          <div class="board-title" data-testid="board-title">
            {boardDisplayTitle(board(), UNTITLED_BOARD)}
          </div>
        }
      >
        <input
          ref={(el) => {
            input = el
            // On mount, still inside the tap: iOS only raises the keyboard then.
            onMount(() => el.focus())
          }}
          class="board-title-input"
          data-testid="board-title-input"
          placeholder="Board name"
          value={boardDisplayTitle(board(), '')}
          onInput={(e) => doc.transient(props.card.content.boardId, { title: e.currentTarget.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              endEdit()
            }
          }}
        />
      </Show>
      <Show when={!props.lod}>
        <div class="board-meta">{counts()}</div>
      </Show>
    </div>
  )
}
