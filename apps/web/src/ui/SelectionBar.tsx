import './canvas-entry.css'
import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js'
import type { BoardIcon, Card } from '@doggynote/core'
import { CARD_COLORS, COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { setColor, trashSelection } from '../state/actions.ts'
import { beginEdit, camera, clearSelection, connectMode, editingId, openBoard, selectMore, selection, setConnectMode, setSelectMore, viewport } from '../state/ui.ts'
import { phone, touch } from '../state/device.ts'
import { showToast } from '../state/toast.ts'
import { draggingIds } from '../canvas/dnd.ts'
import { layoutTick, rectOf } from '../canvas/layout.ts'
import { union, worldToScreen } from '@doggynote/core'
import { BOARD_ICONS, BoardIconSvg, Icon, ToolIcons } from './icons.tsx'
import { canvasControlsSize } from './CanvasControls.tsx'
import { openThread } from './CommentsPanel.tsx'
import { TodoOptions } from './TodoOptions.tsx'
import { BarMenu } from './BarMenu.tsx'
import { duplicateSelection } from '../state/clipboard.ts'

// Floating bar for the current selection: colour, board icon, bury (trash).
// On touch it also offers what a mouse does with clicks and modifier keys
// (edit, connect, add to the selection). On phones it docks to the bottom.

export function SelectionBar() {
  const [barSize, setBarSize] = createSignal({ width: 400, height: 46 })
  const cards = createMemo(() => [...selection()].map((id) => doc.getCard(id)).filter((c): c is Card => !!c))
  const conns = createMemo(() => [...selection()].filter((id) => doc.get(id)?.kind === 'connection'))
  // Touch screens get a bar along the bottom: thumbs reach it, and it never covers the card.
  const docked = () => phone() || touch()
  // A click on a to-do list edits it straight away; its colour and list options
  // stay within reach above it (touch selects first, so it has the docked bar).
  const editingList = () => !docked() && doc.getCard(editingId() ?? '')?.type === 'todo'
  const show = () => (cards().length || conns().length) && !draggingIds().size && (!editingId() || editingList()) && !connectMode()
  const sole = () => (cards().length === 1 && selection().size === 1 ? cards()[0] : undefined)
  const editable = () => {
    const c = sole()
    return !!c && (c.type === 'note' || c.type === 'todo' || c.type === 'column') && doc.canWriteObject(c)
  }
  const canDuplicate = () => cards().length > 0 && cards().every((c) => doc.canWriteObject(c))
  const bury = () => {
    const n = selection().size
    trashSelection()
    if (touch()) showToast(`${COPY.buried} ${n} ${n === 1 ? 'card' : 'cards'}`, 5000, { label: 'Undo', run: () => doc.undo() })
  }
  const startConnect = () => {
    const c = sole()
    if (!c) return
    setConnectMode({ from: c.id })
  }
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
    const BAR = barSize().height
    let top = tl.y - BAR - 14
    if (top < 8) top = Math.min(br.y + 14, v.height - BAR - 8)
    const half = Math.min(barSize().width, v.width - 16) / 2
    const left = Math.min(Math.max((tl.x + br.x) / 2, half + 8), Math.max(half + 8, v.width - half - 8))
    const controls = canvasControlsSize()
    const controlsTop = v.height - 16 - controls.height
    if (left - half < 24 + controls.width && top + BAR > controlsTop - 8) top = controlsTop - BAR - 12
    return { left, top: Math.max(8, Math.min(top, v.height - BAR - 8)) }
  })

  return (
    <Show when={show()}>
      <div
        ref={(element) => { const observer = new ResizeObserver(() => setBarSize({ width: element.offsetWidth, height: element.offsetHeight })); observer.observe(element); onCleanup(() => observer.disconnect()) }}
        class="selection-bar"
        data-testid="selection-bar"
        onKeyDown={(e) => { if (!e.metaKey && !e.ctrlKey && ['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) { e.stopPropagation(); if (e.key === 'Backspace') e.preventDefault() } }}
        classList={{ docked: docked() }}
        style={docked() ? undefined : { left: `${pos().left}px`, top: `${pos().top}px` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div class="bar-group bar-style">
        <Show when={cards().length}>
          <div class="swatches" role="group" aria-label="Colour">
            <For each={CARD_COLORS}>
              {(c) => (
                <button
                  class="swatch"
                  aria-pressed={currentColor() === c}
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
          <button class="bar-btn" data-testid="open-board" onClick={() => openBoard(soleBoard()!.id)}>Open</button>
          <button class="bar-btn" data-testid="rename-board" disabled={!doc.canWriteObject(soleBoard())} onClick={() => beginEdit(cards()[0].id)}>Rename</button>
          <div class="bar-sep" />
          <div class="icon-picker" aria-label="Board icon">
            <For each={BOARD_ICONS}>
              {(i: BoardIcon) => (
                <button
                  class="icon-choice"
                  classList={{ on: soleBoard()!.icon === i }}
                  data-testid={`icon-${i}`}
                  title={i}
                  aria-label={`Board icon: ${i}`}
                  aria-pressed={soleBoard()!.icon === i}
                  disabled={!doc.canWriteObject(soleBoard())}
                  onClick={() => doc.update({ [soleBoard()!.id]: { icon: i } })}
                >
                  <BoardIconSvg icon={i} size={18} />
                </button>
              )}
            </For>
          </div>
        </Show>
        </div>
        <div class="bar-sep" />
        <div class="bar-group bar-actions">
        <Show when={touch() && editable()}>
          <button class="bar-btn" data-testid="edit-card" onClick={() => beginEdit(sole()!.id)}>
            <Icon size={18}>{ToolIcons.edit()}</Icon>
            Edit
          </button>
        </Show>
        <Show when={sole()?.type === 'todo' && doc.canWriteObject(sole())}>
          <TodoOptions card={sole() as Card<'todo'>} />
        </Show>
        <Show when={!editingList()}>
        <Show when={!phone() && canDuplicate()}>
          <button class="bar-btn" data-testid="duplicate" title="Duplicate (⌘D)" onClick={duplicateSelection}>
            <Icon size={18}>{ToolIcons.duplicate()}</Icon>
            Duplicate
          </button>
        </Show>
        <Show when={cards().length === 1 && cards()[0].type !== 'board'}>
          <button class="bar-btn" data-testid="comment-button" title="Comment on this card" onClick={() => openThread(cards()[0].id)}>
            <Icon size={18}>{ToolIcons.comment()}</Icon>
            Comment
          </button>
        </Show>
        <Show when={!phone()}>
        <Show when={touch() && sole()}>
          <button class="bar-btn" data-testid="connect-card" onClick={startConnect}>
            <Icon size={18}>{ToolIcons.line()}</Icon>
            Connect
          </button>
        </Show>
        <Show when={touch()}>
          <button class="bar-btn" data-testid="select-more" aria-pressed={selectMore()} classList={{ on: selectMore() }} onClick={() => setSelectMore(!selectMore())}>
            <Icon size={18}>{ToolIcons.multi()}</Icon>
            {selection().size > 1 ? `${selection().size} picked` : 'Select'}
          </button>
        </Show>
        </Show>
        {/* Phones: the less frequent actions share one sheet, so the bar fits a small screen. */}
        <Show when={phone()}>
          <BarMenu label={selection().size > 1 ? `${selection().size} picked` : 'More'} title="More for this card" testId="selection-more" menuTestId="selection-more-menu" icon={<Icon size={18}>{ToolIcons.more()}</Icon>}>
            {(close) => (
              <>
                <Show when={canDuplicate()}>
                  <button class="menu-item" role="menuitem" data-testid="duplicate" onClick={() => { close(); duplicateSelection() }}>
                    <Icon size={18}>{ToolIcons.duplicate()}</Icon>
                    Duplicate
                  </button>
                </Show>
                <Show when={sole()}>
                  <button class="menu-item" role="menuitem" data-testid="connect-card" onClick={() => { close(); startConnect() }}>
                    <Icon size={18}>{ToolIcons.line()}</Icon>
                    Connect to another card
                  </button>
                </Show>
                <button class="menu-item" role="menuitemcheckbox" aria-checked={selectMore()} data-testid="select-more" onClick={() => { close(); setSelectMore(!selectMore()) }}>
                  <Icon size={18}>{ToolIcons.multi()}</Icon>
                  {selectMore() ? 'Stop picking more' : 'Pick more cards'}
                </button>
              </>
            )}
          </BarMenu>
        </Show>
        <button class="bar-btn" data-testid="bury" title={`Move to ${COPY.trash} (Delete)`} onClick={bury}>
          <Icon size={18}>{ToolIcons.trash()}</Icon>
          Bury
        </button>
        </Show>
        <Show when={phone()}>
          <button class="icon-btn bar-done" data-testid="selection-done" aria-label="Done" title="Done" onClick={clearSelection}>
            <Icon size={18}>{ToolIcons.close()}</Icon>
          </button>
        </Show>
        </div>
      </div>
    </Show>
  )
}

/** Touch: what to do next while connecting cards, and a way out. */
export function ConnectBanner() {
  return (
    <Show when={touch() && connectMode()}>
      <div class="connect-banner" data-testid="connect-banner" role="status">
        <Icon size={18}>{ToolIcons.line()}</Icon>
        <span>{connectMode()!.from ? COPY.connectHint : 'Tap two cards to tie them together.'}</span>
        <button class="bar-btn" data-testid="connect-cancel" onClick={() => setConnectMode(null)}>Cancel</button>
      </div>
    </Show>
  )
}
