import './move-board.css'
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { HOME_BOARD_ID, type Board, type Id } from '@doggynote/core'
import { COPY, boardDisplayTitle, cardColorVars } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { canEditBoard } from '../state/access.ts'
import { inTemplate } from '../state/copies.ts'
import { moveSelectionTo } from '../state/actions.ts'
import { revealCard } from '../state/columns.ts'
import { boardId, openBoard, recentBoards, select } from '../state/ui.ts'
import { BoardIconSvg } from './icons.tsx'
import { Popover } from './Popover.tsx'

// "Move to board…": pick a board you can edit and the selected cards go there,
// ids and all (comments, labels and history come along). One undo step.

const isHome = (b: Board) => b.id === HOME_BOARD_ID || b.id.startsWith('home:')
export const moveBoardTitle = (b: Board | undefined) => (b && isHome(b) ? boardDisplayTitle(b, COPY.home) : boardDisplayTitle(b))

/** Boards the selection could move to: editable, live, not a template, never the current one. */
export function moveTargets(): Board[] {
  const here = boardId()
  const recent = recentBoards()
  const rank = (b: Board) => (b.id.startsWith('toybox:') ? -2 : isHome(b) ? -1 : recent.includes(b.id) ? recent.indexOf(b.id) : Infinity)
  return doc.index().boards
    .filter((b) => b.id !== here && !b.deletedAt && !b.purged && canEditBoard(b.id) && !inTemplate(b.id))
    .sort((a, b) => {
      const ra = rank(a), rb = rank(b)
      return ra === rb ? moveBoardTitle(a).localeCompare(moveBoardTitle(b)) : ra - rb
    })
}

/** Follow the moved cards: open their new board and bring them into view. */
export function goToMoved(target: Id, ids: Id[]) {
  openBoard(target)
  if (!ids.length) return
  revealCard(ids[0])
  select(ids)
}

export function MoveToBoardPopover(props: { anchor: () => HTMLElement; close: () => void }) {
  const [query, setQuery] = createSignal('')
  const [picked, setPicked] = createSignal(0)
  let list: HTMLUListElement | undefined
  const q = () => query().trim().toLowerCase()
  const parentTitle = (b: Board) => (b.parentId && !b.id.startsWith('toybox:') ? moveBoardTitle(doc.getBoard(b.parentId)) : '')
  const shown = createMemo(() => moveTargets().filter((b) => !q() || moveBoardTitle(b).toLowerCase().includes(q()) || parentTitle(b).toLowerCase().includes(q())).slice(0, 50))
  const active = () => Math.min(picked(), Math.max(0, shown().length - 1))
  createEffect(() => {
    const i = active()
    queueMicrotask(() => list?.querySelectorAll('[role="option"]')[i]?.scrollIntoView({ block: 'nearest' }))
  })
  const choose = (b: Board) => {
    props.close()
    moveSelectionTo(b.id, moveBoardTitle(b), (ids) => goToMoved(b.id, ids))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = shown().length
      if (n) setPicked((active() + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const b = shown()[active()]
      if (b) choose(b)
    }
  }
  return (
    <Popover anchor={props.anchor} label="Move to board" testid="move-board-popover" class="move-board-panel" align="start" close={props.close}>
      <div class="nav-menu-head sheet-only" aria-hidden="true"><strong>Move to board</strong></div>
      <input
        class="move-board-input"
        data-testid="move-board-input"
        data-autofocus
        role="combobox"
        aria-label="Find a board"
        aria-expanded={shown().length > 0}
        aria-controls="move-board-list"
        aria-autocomplete="list"
        aria-activedescendant={shown().length ? `move-board-${active()}` : undefined}
        placeholder="Find a board"
        autocomplete="off"
        value={query()}
        onInput={(e) => { setQuery(e.currentTarget.value); setPicked(0) }}
        onKeyDown={onKeyDown}
      />
      <Show when={shown().length} fallback={<p class="move-board-empty" role="status">{moveTargets().length ? 'No board by that name.' : 'No other boards you can edit.'}</p>}>
        <ul ref={list} id="move-board-list" class="move-board-list" role="listbox" aria-label="Boards you can edit">
          <For each={shown()}>
            {(b, i) => (
              <li
                id={`move-board-${i()}`}
                role="option"
                aria-selected={i() === active()}
                class="move-board-option"
                classList={{ active: i() === active() }}
                data-testid="move-board-option"
                data-board-id={b.id}
                onPointerMove={() => setPicked(i())}
                onClick={() => choose(b)}
              >
                <span class="move-board-tile" style={{ '--tile-bg': cardColorVars(b.color, 'gold').bg, '--tile-fg': cardColorVars(b.color, 'gold').text }} aria-hidden="true"><BoardIconSvg icon={b.icon} size={14} /></span>
                <span class="move-board-name">{moveBoardTitle(b)}</span>
                <Show when={parentTitle(b)}><span class="move-board-where">in {parentTitle(b)}</span></Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Popover>
  )
}
