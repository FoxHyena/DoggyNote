import { For, Show, createMemo } from 'solid-js'
import type { BoardIcon, Card } from '@doggynote/core'
import { CARD_COLORS, COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { setColor, trashSelection } from '../state/actions.ts'
import { camera, editingId, selection, viewport } from '../state/ui.ts'
import { draggingIds } from '../canvas/dnd.ts'
import { layoutTick, rectOf } from '../canvas/layout.ts'
import { union, worldToScreen } from '@doggynote/core'
import { BOARD_ICONS, BoardIconSvg, Icon, ToolIcons } from './icons.tsx'
import { openThread } from './CommentsPanel.tsx'

// Floating bar for the current selection: colour, board icon, bury (trash).

export function SelectionBar() {
  const cards = createMemo(() => [...selection()].map((id) => doc.getCard(id)).filter((c): c is Card => !!c))
  const conns = createMemo(() => [...selection()].filter((id) => doc.get(id)?.kind === 'connection'))
  const show = () => (cards().length || conns().length) && !draggingIds().size && !editingId()
  const soleBoard = () => {
    const c = cards()
    return c.length === 1 && c[0].type === 'board' ? doc.getBoard((c[0] as Card<'board'>).content.boardId) : undefined
  }
  const currentColor = () => {
    const c = cards()
    return c.length && c.every((x) => x.color === c[0].color) ? c[0].color : null
  }

  // Float just above the selection (below it if there's no room), never on top of it.
  const pos = createMemo(() => {
    layoutTick()
    const rects = cards()
      .map((c) => rectOf(c.id))
      .filter((r): r is NonNullable<typeof r> => !!r)
    const u = union(rects)
    const v = viewport()
    if (!u) return { left: v.width / 2, top: 12 }
    const cam = camera()
    const tl = worldToScreen(cam, { x: u.x, y: u.y })
    const br = worldToScreen(cam, { x: u.x + u.w, y: u.y + u.h })
    const BAR = 46
    let top = tl.y - BAR - 14
    if (top < 8) top = Math.min(br.y + 14, v.height - BAR - 8)
    const left = Math.min(Math.max((tl.x + br.x) / 2, 200), Math.max(200, v.width - 200))
    return { left, top: Math.max(8, top) }
  })

  return (
    <Show when={show()}>
      <div
        class="selection-bar"
        data-testid="selection-bar"
        style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Show when={cards().length}>
          <div class="swatches" role="radiogroup" aria-label="Colour">
            <For each={CARD_COLORS}>
              {(c) => (
                <button
                  class="swatch"
                  classList={{ on: currentColor() === c }}
                  style={{ background: `var(--dn-card-${c}-bg)` }}
                  data-testid={`swatch-${c}`}
                  title={c === 'none' ? 'No colour' : c}
                  aria-label={c === 'none' ? 'No colour' : c}
                  onClick={() => setColor(selection(), c)}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={soleBoard()}>
          <div class="bar-sep" />
          <div class="icon-picker" aria-label="Board icon">
            <For each={BOARD_ICONS}>
              {(i: BoardIcon) => (
                <button
                  class="icon-choice"
                  classList={{ on: soleBoard()!.icon === i }}
                  data-testid={`icon-${i}`}
                  title={i}
                  onClick={() => doc.update({ [soleBoard()!.id]: { icon: i } })}
                >
                  <BoardIconSvg icon={i} size={18} />
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="bar-sep" />
        <Show when={cards().length === 1 && cards()[0].type !== 'board'}>
          <button class="bar-btn" data-testid="comment-button" title="Comment on this card" onClick={() => openThread(cards()[0].id)}>
            <Icon size={18}>{ToolIcons.comment()}</Icon>
            Comment
          </button>
        </Show>
        <button class="bar-btn" data-testid="bury" title={`Move to ${COPY.trash} (Delete)`} onClick={trashSelection}>
          <Icon size={18}>{ToolIcons.trash()}</Icon>
          Bury
        </button>
      </div>
    </Show>
  )
}
