import './canvas-entry.css'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { ALIGNMENTS, DEFAULT_SWATCH_HEX, type Alignment, type BoardIcon, type Card } from '@doggynote/core'
import { CARD_COLORS, COPY, cardColor, isPresetColor, normalizeHex, type CardColor } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { columnCollapsed, setColumnCollapsed } from '../state/columns.ts'
import { burySelection, setColor } from '../state/actions.ts'
import { alignSelection, isPositionLocked, lockSelection, selectedAlignmentUnits, unlockSelectionLayouts } from '../state/position.ts'
import { beginEdit, camera, cardContextOpen, clearSelection, connectMode, editingId, openBoard, selectMore, selection, setConnectMode, setSelectMore, viewport } from '../state/ui.ts'
import { phone, touch } from '../state/device.ts'
import { draggingIds } from '../canvas/dnd.ts'
import { layoutTick, rectOf } from '../canvas/layout.ts'
import { union, worldToScreen } from '@doggynote/core'
import { BOARD_ICONS, BoardIconSvg, Icon, IconButton, type IconName } from './icons.tsx'
import { canvasControlsSize } from './CanvasControls.tsx'
import { openThread } from './CommentsPanel.tsx'
import { TodoOptions, TodoMenuItems } from './TodoOptions.tsx'
import { BarMenu } from './BarMenu.tsx'
import { duplicateSelection } from '../state/clipboard.ts'
import { Popover } from './Popover.tsx'
import { LabelsButton } from './Labels.tsx'
import { cardObstacles, placeFloating } from './floatingPlacement.ts'

// Floating bar for the current selection: colour, board icon, bury (trash).
// On touch it also offers what a mouse does with clicks and modifier keys
// (edit, connect, add to the selection). On phones it docks to the bottom.

export function SelectionBar() {
  const [panel, setPanel] = createSignal<'colour' | 'icon' | null>(null)
  let colourTrigger!: HTMLButtonElement, moreTrigger!: HTMLButtonElement, panelAnchor!: HTMLElement
  const openPanel = (kind: 'colour' | 'icon') => { panelAnchor = kind === 'colour' ? colourTrigger : moreTrigger; setPanel(kind) }
  const [barSize, setBarSize] = createSignal({ width: 400, height: 46 })
  const cards = createMemo(() => [...selection()].map((id) => doc.getCard(id)).filter((c): c is Card => !!c))
  const conns = createMemo(() => [...selection()].filter((id) => doc.get(id)?.kind === 'connection'))
  // Touch screens get a bar along the bottom: thumbs reach it, and it never covers the card.
  const docked = () => phone() || touch()
  // While typing in a to-do list, its colour and list options stay within reach
  // above it (touch has the docked bar instead).
  const editingList = () => !docked() && doc.getCard(editingId() ?? '')?.type === 'todo'
  const show = () => !cardContextOpen() && (cards().length || conns().length) && !draggingIds().size && (!editingId() || editingList()) && !connectMode()
  createEffect(() => { if (!show() || !phone()) setPanel(null) })
  const sole = () => (cards().length === 1 && selection().size === 1 ? cards()[0] : undefined)
  const selectedColumn = () => {
    const c = sole()
    const col = c?.type === 'column' ? c : c?.columnId ? doc.getCard(c.columnId) : undefined
    return col?.type === 'column' && col.boardId === c?.boardId ? col : undefined
  }
  const editable = () => {
    const c = sole()
    return !!c && (c.type === 'note' || c.type === 'todo' || c.type === 'column' || c.type === 'image' || c.type === 'swatch' || c.type === 'link' || c.type === 'movie') && doc.canWriteObject(c)
  }
  // Labels go on the cards of one board; a column is a container, so it has none.
  const canLabel = () => cards().length > 0 && cards().every((c) => c.type !== 'column' && c.boardId === cards()[0].boardId && doc.canWriteObject(c))
  const canDuplicate = () => cards().length > 0 && cards().every((c) => doc.canWriteObject(c))
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
  /** The selection's shared colour (synced data, so checked), or null when they differ. */
  const currentColor = (): CardColor | null => {
    const c = cards().map((x) => cardColor(x.type === 'board' ? doc.getBoard((x as Card<'board'>).content.boardId)?.color : x.color))
    return c.length && c.every((x) => x === c[0]) ? c[0] : null
  }
  const customColor = () => {
    const c = currentColor()
    return c && !isPresetColor(c) ? c : null
  }
  const pickCustom = (value: string) => {
    const hex = normalizeHex(value)
    if (hex) setColor(selection(), hex)
  }
  const lockLabel = () => (allLocked() ? 'Unlock position' : 'Lock position')
  const lockButton = () => (
    <BarAction testid="position-lock" icon={allLocked() ? 'lock' : 'unlock'} label={lockLabel()} text={allLocked() ? 'Unlock' : 'Lock'} title={allLocked() ? 'Unlock position' : 'Lock position: protect layout while keeping content editable'} pressed={allLocked()} labelled={docked()} onClick={() => lockSelection(!allLocked())} />
  )
  const partlyLocked = () => cards().some((c) => c.positionLocked === true) && !cards().every((c) => c.positionLocked === true)
  const columnLocked = () => cards().some((c) => isPositionLocked(c.id) && c.positionLocked !== true)
  // Docked, the lock is one of the labelled actions; the position row only holds what's left.
  const positionRow = () => !docked() || partlyLocked() || columnLocked() || canAlign()

  // Float just above the selection, or below it if there's no room.
  const pos = createMemo(() => {
    if (docked()) return { left: 0, top: 0 }
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
    const size = { width: Math.min(barSize().width, v.width - 16), height: barSize().height }
    const x = (tl.x + br.x - size.width) / 2
    const controls = canvasControlsSize()
    const at = placeFloating(size, { x: 8, y: 8, w: v.width - 16, h: v.height - 16 }, [
      { x, y: tl.y - size.height - 14 },
      { x, y: br.y + 14 },
      { x: br.x + 14, y: tl.y },
      { x: tl.x - size.width - 14, y: tl.y },
    ], [...cardObstacles(cards().map((c) => c.id)), { x: 16, y: v.height - 16 - controls.height, w: controls.width, h: controls.height }])
    return { left: at.x + size.width / 2, top: at.y }
  })

  const colours = () => (
    <div class="swatches" role="group" aria-label="Colour">
      <For each={CARD_COLORS}>
        {(c) => (
          <button
            class="swatch"
            aria-pressed={currentColor() === c}
            classList={{ on: currentColor() === c, 'swatch-none': c === 'none' }}
            style={{ '--sw': `var(--dn-card-${c}-bg)` }}
            data-testid={`swatch-${c}`}
            data-tip={COPY.colorNames[c]}
            aria-label={COPY.colorNames[c]}
            onClick={() => setColor(selection(), c)}
          />
        )}
      </For>
      {/* Any other colour: the system picker. One change, one undo step. */}
      <label class="swatch swatch-custom" classList={{ on: !!customColor() }} style={customColor() ? { '--sw': customColor()! } : undefined} data-tip={customColor() ? `Custom colour ${customColor()}` : 'Custom colour'} data-testid="swatch-custom">
        <Show when={!customColor()}>
          <Icon size={16} name="plus" />
        </Show>
        <input
          type="color"
          data-testid="swatch-custom-input"
          aria-label="Custom colour"
          value={(customColor() ?? DEFAULT_SWATCH_HEX).toLowerCase()}
          onChange={(e) => pickCustom(e.currentTarget.value)}
        />
      </label>
    </div>
  )
  const boardIcons = () => (
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
  )

  return (
    <Show when={show()}>
      <div
        ref={(element) => { const observer = new ResizeObserver(() => setBarSize({ width: element.offsetWidth, height: element.offsetHeight })); observer.observe(element); onCleanup(() => observer.disconnect()) }}
        class="selection-bar"
        data-testid="selection-bar"
        role="toolbar"
        aria-label="Card actions"
        onKeyDown={(e) => { if (!e.metaKey && !e.ctrlKey && ['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) { e.stopPropagation(); if (e.key === 'Backspace') e.preventDefault() } }}
        classList={{ docked: docked() }}
        style={docked() ? undefined : { left: `${pos().left}px`, top: `${pos().top}px` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Show when={phone()} fallback={<>
        <Show when={cards().length && !editingList()}>
          <Show when={selectedColumn()}>
            <button class="bar-btn" data-testid="selection-column-toggle" aria-expanded={!columnCollapsed(selectedColumn())} onClick={() => setColumnCollapsed(selectedColumn()!.id, !columnCollapsed(selectedColumn()))}>
              {columnCollapsed(selectedColumn()) ? 'Expand column' : 'Collapse column'}
            </button>
          </Show>
          <Show when={writable() && positionRow()}>
          <div class="bar-group bar-position">
            <Show when={!docked()}>{lockButton()}</Show>
            <Show when={partlyLocked()}>
              <button class="bar-btn" onClick={() => lockSelection(false)}>Unlock selected</button>
            </Show>
            <Show when={columnLocked()}>
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
        {/* A colour card is its colour: the card tints are for everything else. */}
        <Show when={cards().some((c) => c.type !== 'swatch')}>
          {colours()}
        </Show>
        <Show when={soleBoard()}>
          <button class="bar-btn" data-testid="open-board" onClick={() => openBoard(soleBoard()!.id)}>Open</button>
          <button class="bar-btn" data-testid="rename-board" disabled={!doc.canWriteObject(soleBoard())} onClick={() => beginEdit(cards()[0].id)}>Rename</button>
          <div class="bar-sep" />
          {boardIcons()}
        </Show>
        </div>
        <div class="bar-sep" />
        <div class="bar-group bar-actions">
        <Show when={touch() && editable()}>
          <button class="bar-btn" data-testid="edit-card" onClick={() => beginEdit(sole()!.id)}>
            <Icon size={18} name="edit" />
            Edit
          </button>
        </Show>
        <Show when={sole()?.type === 'todo' && doc.canWriteObject(sole())}>
          <TodoOptions card={sole() as Card<'todo'>} />
        </Show>
        <Show when={!editingList()}>
        <Show when={docked() && writable() && cards().length}>{lockButton()}</Show>
        <Show when={canLabel()}>
          <LabelsButton cards={cards()} labelled={docked()} />
        </Show>
        <Show when={canDuplicate()}>
          <BarAction testid="duplicate-selection" icon="duplicate" label="Duplicate" title="Duplicate (⌘D)" labelled={docked()} onClick={() => duplicateSelection()} />
        </Show>
        <Show when={cards().length === 1 && cards()[0].type !== 'board'}>
          <BarAction testid="comment-button" icon="comment" label="Comment" title="Comment on this card" labelled={docked()} onClick={() => openThread(cards()[0].id)} />
        </Show>
        <Show when={touch() && sole()}>
          <button class="bar-btn" data-testid="connect-card" onClick={startConnect}>
            <Icon size={18} name="line" />
            Connect
          </button>
        </Show>
        <Show when={touch()}>
          <button class="bar-btn" data-testid="select-more" aria-pressed={selectMore()} classList={{ on: selectMore() }} onClick={() => setSelectMore(!selectMore())}>
            <Icon size={18} name="multi" />
            {selection().size > 1 ? `${selection().size} picked` : 'Select'}
          </button>
        </Show>
        <BarAction testid="bury" icon="bury" label={COPY.bury} title={`${COPY.bury}: move to ${COPY.trash} (Delete)`} labelled={docked()} onClick={burySelection} />
        </Show>

        </div>
        </>}>
          <div class="selection-phone-head">
            <span role="status">{`${selection().size} ${conns().length ? 'item' : 'card'}${selection().size === 1 ? '' : 's'} picked`}<Show when={cards().some((c) => isPositionLocked(c.id))}> · {cards().filter((c) => isPositionLocked(c.id)).length} locked</Show></span>
            <button class="bar-btn" data-testid="selection-done" onClick={clearSelection}>Done<Icon name="close" size={18} /></button>
          </div>
          <div class="selection-phone-actions">
            <Show when={soleBoard()} fallback={<Show when={editable()}><button class="bar-btn selection-primary" data-testid="edit-card" onClick={() => beginEdit(sole()!.id)}><Icon name="edit" size={20} /><span>Edit</span></button></Show>}>
              <button class="bar-btn selection-primary" data-testid="open-board" onClick={() => openBoard(soleBoard()!.id)}><Icon name="open" size={20} /><span>Open</span></button>
            </Show>
            <Show when={cards().some((c) => c.type !== 'swatch')}>
              <button ref={colourTrigger} class="bar-btn" data-testid="selection-colour" aria-haspopup="dialog" aria-expanded={panel() === 'colour'} onClick={() => openPanel('colour')}><Icon name="droplet" size={20} /><span>Colour</span></button>
            </Show>
            <Show when={canLabel()}><LabelsButton cards={cards()} labelled /></Show>
            <BarAction testid="bury" icon="bury" label={COPY.bury} labelled onClick={burySelection} />
            <BarMenu triggerRef={(el) => { moreTrigger = el }} label="More" title="More card actions" testId="selection-more" menuTestId="selection-more-menu" icon={<Icon name="more" size={20} />}>
              {(close) => <>
                <Show when={soleBoard()}>
                  <button class="menu-item" role="menuitem" data-testid="rename-board" disabled={!doc.canWriteObject(soleBoard())} onClick={() => { close(); beginEdit(sole()!.id) }}><Icon name="edit" />Rename</button>
                  <button class="menu-item" role="menuitem" data-testid="selection-icon" disabled={!doc.canWriteObject(soleBoard())} onClick={() => { close(); openPanel('icon') }}><Icon name="board" />Board icon</button>
                </Show>
                <Show when={writable() && cards().length}>
                  <button class="menu-item" role="menuitemcheckbox" aria-checked={allLocked()} aria-label={lockLabel()} data-testid="position-lock" onClick={() => lockSelection(!allLocked())}><Icon name={allLocked() ? 'lock' : 'unlock'} />{allLocked() ? 'Unlock position' : 'Lock position'}</button>
                </Show>
                <Show when={columnLocked()}><button class="menu-item" role="menuitem" data-testid="unlock-column-layout" onClick={() => { close(); unlockSelectionLayouts() }}>Unlock column layout</button></Show>
                <Show when={canAlign()}><div class="selection-sheet-align" role="group" aria-label="Align selection" data-testid="align-selection"><For each={ALIGNMENTS}>{(a) => <IconButton testid={`align-${a.value}`} icon={ALIGN_ICONS[a.value]} label={a.label} onClick={() => { close(); alignSelection(a.value) }} />}</For></div></Show>
                <Show when={selectedColumn()}><button class="menu-item" role="menuitem" data-testid="selection-column-toggle" onClick={() => { close(); setColumnCollapsed(selectedColumn()!.id, !columnCollapsed(selectedColumn())) }}>{columnCollapsed(selectedColumn()) ? 'Expand column' : 'Collapse column'}</button></Show>
                <Show when={sole()?.type === 'todo' && writable()}><TodoMenuItems card={sole() as Card<'todo'>} close={close} /></Show>
                <Show when={canDuplicate()}><button class="menu-item" role="menuitem" data-testid="duplicate-selection" onClick={() => { close(); duplicateSelection() }}><Icon name="duplicate" />Duplicate</button></Show>
                <Show when={sole() && sole()!.type !== 'board'}><button class="menu-item" role="menuitem" data-testid="comment-button" onClick={() => { close(); openThread(sole()!.id) }}><Icon name="comment" />Comment</button></Show>
                <Show when={sole()}><button class="menu-item" role="menuitem" data-testid="connect-card" onClick={() => { close(); startConnect() }}><Icon name="line" />Connect to another card</button></Show>
                <button class="menu-item" role="menuitemcheckbox" aria-checked={selectMore()} data-testid="select-more" onClick={() => { close(); setSelectMore(!selectMore()) }}><Icon name="multi" />{selectMore() ? 'Stop picking more' : 'Pick more cards'}</button>
              </>}
            </BarMenu>
          </div>
          <Show when={panel()}>
            <Popover anchor={() => panelAnchor} label={panel() === 'colour' ? 'Card colour' : 'Board icon'} testid="selection-style-sheet" class="menu selection-style-sheet" close={() => setPanel(null)}>
              <div class="selection-sheet-head"><strong>{panel() === 'colour' ? 'Colour' : 'Board icon'}</strong><button class="bar-btn" data-testid="selection-style-done" onClick={() => setPanel(null)}>Done</button></div>
              <Show when={panel() === 'colour'} fallback={boardIcons()}>{colours()}</Show>
            </Popover>
          </Show>
        </Show>
      </div>
    </Show>
  )
}

/** An icon button, or on the docked bar an icon over its label (glass has no hover tips). */
function BarAction(props: { testid: string; icon: IconName; label: string; text?: string; title?: string; pressed?: boolean; labelled: boolean; onClick: () => void }) {
  return (
    <Show when={props.labelled} fallback={<IconButton testid={props.testid} icon={props.icon} label={props.label} title={props.title} pressed={props.pressed} onClick={props.onClick} />}>
      <button class="bar-btn" classList={{ on: !!props.pressed }} data-testid={props.testid} aria-label={props.label} aria-pressed={props.pressed} onClick={() => props.onClick()}>
        <Icon size={18} name={props.icon} />
        <span class="bar-btn-label">{props.text ?? props.label}</span>
      </button>
    </Show>
  )
}

const ALIGN_ICONS: Record<Alignment, IconName> = {
  left: 'alignLeft', 'center-x': 'alignCenterH', right: 'alignRight',
  top: 'alignTop', 'center-y': 'alignMiddleV', bottom: 'alignBottom',
}

/** Touch: what to do next while connecting cards, and a way out. */
export function ConnectBanner() {
  return (
    <Show when={touch() && connectMode()}>
      <div class="connect-banner" data-testid="connect-banner" role="status">
        <Icon size={18} name="line" />
        <span>{connectMode()!.from ? COPY.connectHint : 'Tap two cards to tie them together.'}</span>
        <button class="bar-btn" data-testid="connect-cancel" onClick={() => setConnectMode(null)}>Cancel</button>
      </div>
    </Show>
  )
}
