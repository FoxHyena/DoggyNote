import './canvas-entry.css'
import { For, Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { ALIGNMENTS, type Alignment, type BoardIcon, type Card } from '@doggynote/core'
import { CARD_COLORS, COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { columnCollapsed, setColumnCollapsed } from '../state/columns.ts'
import { setColor, trashSelection } from '../state/actions.ts'
import { alignSelection, isPositionLocked, lockSelection, selectedAlignmentUnits, unlockSelectionLayouts } from '../state/position.ts'
import { beginEdit, camera, clearSelection, connectMode, editingId, openBoard, selectMore, selection, setConnectMode, setSelectMore, viewport } from '../state/ui.ts'
import { phone, touch } from '../state/device.ts'
import { showToast } from '../state/toast.ts'
import { draggingIds } from '../canvas/dnd.ts'
import { layoutTick, rectOf } from '../canvas/layout.ts'
import { union, worldToScreen } from '@doggynote/core'
import { BOARD_ICONS, BoardIconSvg, Icon, IconButton, ToolIcons } from './icons.tsx'
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
  // While typing in a to-do list, its colour and list options stay within reach
  // above it (touch has the docked bar instead).
  const editingList = () => !docked() && doc.getCard(editingId() ?? '')?.type === 'todo'
  const show = () => (cards().length || conns().length) && !draggingIds().size && (!editingId() || editingList()) && !connectMode()
  const sole = () => (cards().length === 1 && selection().size === 1 ? cards()[0] : undefined)
  const selectedColumn = () => {
    const c = sole()
    const col = c?.type === 'column' ? c : c?.columnId ? doc.getCard(c.columnId) : undefined
    return col?.type === 'column' && col.boardId === c?.boardId ? col : undefined
  }
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
  const writable = () => cards().every((c) => doc.canWriteObject(c))
  const allLocked = () => cards().every((c) => c.positionLocked === true)
  // Alignment needs two movable things; otherwise the icons would only take up room.
  const canAlign = () => writable() && selectedAlignmentUnits().length >= 2 && !selectedAlignmentUnits().every((c) => isPositionLocked(c.id))
  const soleBoard = () => {
    const c = cards()
    return c.length === 1 && c[0].type === 'board' ? doc.getBoard((c[0] as Card<'board'>).content.boardId) : undefined
  }
  const currentColor = () => {
    const c = cards()
    return c.length && c.every((x) => x.color === c[0].color) ? c[0].color : null
  }

  // Float just above the selection, or below it if there's no room.
  const pos = createMemo(() => {
    layoutTick()
    const rects = cards()
      .map((c) => rectOf(c.id))
      .filter((r): r is NonNullable<typeof r> => !!r)
    const u = union(rects)
    const v = viewport()
    if (!u) return { left: v.width / 2, top: 12 }
    const cam = camera()
    // A member's toolbar must leave its column's header (and its collapse toggle) reachable.
    const parentTops = cards().flatMap((c) => {
      const parent = c.columnId ? doc.getCard(c.columnId) : undefined
      const r = parent?.type === 'column' && parent.boardId === c.boardId ? rectOf(parent.id) : null
      return r ? [r.y] : []
    })
    const tl = worldToScreen(cam, { x: u.x, y: Math.min(u.y, ...parentTops) })
    const br = worldToScreen(cam, { x: u.x + u.w, y: u.y + u.h })
    const BAR = barSize().height
    const half = Math.min(barSize().width, v.width - 16) / 2
    const left = Math.min(Math.max((tl.x + br.x) / 2, half + 8), Math.max(half + 8, v.width - half - 8))
    const controls = canvasControlsSize()
    const controlsTop = v.height - 16 - controls.height
    const clearOfControls = (top: number) => left - half >= 24 + controls.width || top + BAR <= controlsTop - 8
    const above = tl.y - BAR - 14
    const below = br.y + 14
    if (above >= 8) return { left, top: above }
    if (below + BAR <= v.height - 8 && clearOfControls(below)) return { left, top: below }
    // No room on either side. If the selection runs off the bottom of the window, sit
    // at the bottom: its header and controls stay clear and its resize corner is off
    // screen anyway. Otherwise sit at the top, clear of its footer and resize corner.
    if (br.y > v.height) {
      const bottom = v.height - BAR - 8
      return { left, top: clearOfControls(bottom) ? bottom : controlsTop - BAR - 12 }
    }
    return { left, top: 8 }
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
        <Show when={cards().length && !editingList()}>
          <Show when={selectedColumn()}>
            <button class="bar-btn" data-testid="selection-column-toggle" aria-expanded={!columnCollapsed(selectedColumn())} onClick={() => setColumnCollapsed(selectedColumn()!.id, !columnCollapsed(selectedColumn()))}>
              {columnCollapsed(selectedColumn()) ? 'Expand column' : 'Collapse column'}
            </button>
          </Show>
          <Show when={writable()}>
          <div class="bar-group bar-position">
            <IconButton testid="position-lock" icon={allLocked() ? ToolIcons.lock : ToolIcons.unlock} label={allLocked() ? 'Unlock position' : 'Lock position'} title={allLocked() ? 'Unlock position' : 'Lock position: protect layout while keeping content editable'} pressed={allLocked()} onClick={() => lockSelection(!allLocked())} />
            <Show when={cards().some((c) => c.positionLocked === true) && !cards().every((c) => c.positionLocked === true)}>
              <button class="bar-btn" onClick={() => lockSelection(false)}>Unlock selected</button>
            </Show>
            <Show when={cards().some((c) => isPositionLocked(c.id) && c.positionLocked !== true)}>
              <button class="bar-btn" data-testid="unlock-column-layout" data-tip="Unlock the position locks in this column" onClick={unlockSelectionLayouts}>Unlock column layout</button>
            </Show>
            <Show when={canAlign()}>
              <div class="bar-align" role="group" aria-label="Align selection" data-testid="align-selection">
                <For each={ALIGNMENTS}>{(a) => <IconButton testid={`align-${a.value}`} icon={ALIGN_ICONS[a.value]} label={a.label} onClick={() => alignSelection(a.value)} />}</For>
              </div>
            </Show>
            <Show when={cards().some((c) => isPositionLocked(c.id))}>
              <span class="position-lock-status" role="status">{cards().filter((c) => isPositionLocked(c.id)).length} locked{cards().some((c) => isPositionLocked(c.id) && c.positionLocked !== true) ? ' (column layout)' : ''}</span>
            </Show>
          </div>
          </Show>
        </Show>
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
                  data-tip={c === 'none' ? 'No colour' : c[0]!.toUpperCase() + c.slice(1)}
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
                  data-tip={i}
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
        <Show when={canDuplicate()}>
          <IconButton testid="duplicate-selection" icon={ToolIcons.duplicate} label="Duplicate" title="Duplicate (⌘D)" onClick={() => duplicateSelection()} />
        </Show>
        <Show when={cards().length === 1 && cards()[0].type !== 'board'}>
          <IconButton testid="comment-button" icon={ToolIcons.comment} label="Comment" title="Comment on this card" onClick={() => openThread(cards()[0].id)} />
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
        <IconButton testid="bury" icon={ToolIcons.trash} label="Bury" title={`Bury: move to ${COPY.trash} (Delete)`} onClick={bury} />
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

const ALIGN_ICONS: Record<Alignment, () => JSX.Element> = {
  left: ToolIcons.alignLeft, 'center-x': ToolIcons.alignCenterH, right: ToolIcons.alignRight,
  top: ToolIcons.alignTop, 'center-y': ToolIcons.alignMiddleV, bottom: ToolIcons.alignBottom,
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
