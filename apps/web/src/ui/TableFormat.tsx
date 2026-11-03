import { For, Show, createSignal, type JSX } from 'solid-js'
import { CARD_COLORS, COPY, type PresetColor } from '@doggynote/theme'
import { COLUMN_TYPES, type Align, type ColumnType } from '@doggynote/core'
import { activeTable } from '../cards/table/tableControl.ts'
import { touch } from '../state/device.ts'
import { BarMenu } from './BarMenu.tsx'
import { ColorDots } from './ColorDots.tsx'
import { Icon, IconButton, type IconName } from './icons.tsx'
import { Popover } from './Popover.tsx'

// The table's formatting tools, shared by the desktop bar and the phone dock: Bold,
// Align, Fill, Type and Sort. Each is one button; the bar draws an icon button, the
// dock a 44px target. Menus and the fill panel open as popovers, or as bottom
// sheets on a phone (the same shells the other bar menus use).

export type Variant = 'bar' | 'dock'

/** A menu item runs, closes the menu, and hands the keyboard back to the grid. */
export const useAct = (close: () => void) => (run: () => void) => () => { close(); run(); activeTable()?.refocus() }

export const TYPE_ICONS: Record<ColumnType, IconName> = {
  text: 'typeText', number: 'typeNumber', checkbox: 'typeCheckbox', date: 'typeDate', select: 'typeSelect', rating: 'typeRating',
}
const ALIGN_ICONS: Record<Align, IconName> = { l: 'textAlignLeft', c: 'textAlignCenter', r: 'textAlignRight' }
const ALIGN_LABELS: Record<Align, string> = { l: COPY.table.alignLeft, c: COPY.table.alignCentre, r: COPY.table.alignRight }

const size = (v: Variant) => (v === 'dock' ? 22 : 18)
/** The dock's menus keep their own pointerdown: a cancelled one loses the click on iOS. */
function Wrap(props: { variant: Variant; children: JSX.Element }) {
  return props.variant === 'dock' ? <span class="table-dock-menu" onPointerDown={(e) => e.stopPropagation()}>{props.children}</span> : <>{props.children}</>
}

const check = (on: boolean) => <span class="menu-check" aria-hidden="true"><Show when={on}><Icon size={16} name="check" /></Show></span>

export function BoldTool(props: { variant: Variant }) {
  const t = activeTable
  return (
    <Show when={t()}>
      {(c) => props.variant === 'dock'
        ? <button class="table-dock-btn" data-testid="dock-bold" aria-label={COPY.table.bold} aria-pressed={c().bold()} disabled={!c().canFormat()} onPointerDown={(e) => { e.preventDefault(); c().toggleBold() }}><Icon size={22} name="bold" /></button>
        : <IconButton testid="table-bold" icon="bold" label={COPY.table.bold} title={`${COPY.table.bold} (⌘B)`} pressed={c().bold()} disabled={!c().canFormat()} onClick={() => c().toggleBold()} />}
    </Show>
  )
}

export function AlignTool(props: { variant: Variant }) {
  const t = activeTable
  const dock = () => props.variant === 'dock'
  return (
    <Show when={t()}>
      {(c) => (
        <Wrap variant={props.variant}>
          <BarMenu
            label=""
            title={COPY.table.align}
            tip={COPY.table.align}
            testId={dock() ? 'dock-align' : 'table-align'}
            menuTestId="table-align-menu"
            icon={<Icon name={ALIGN_ICONS[c().align() ?? 'l']} size={size(props.variant)} />}
          >
            {(close) => {
              const act = useAct(close)
              const off = () => c().kind() !== 'cols' && !c().canFormat()
              return <>
                <For each={['l', 'c', 'r'] as Align[]}>
                  {(a) => (
                    <button class="menu-item" role="menuitemradio" aria-checked={c().align() === a} data-testid={`table-align-${a}`} disabled={off()} onClick={act(() => c().setAlign(a))}>
                      {check(c().align() === a)}<Icon name={ALIGN_ICONS[a]} />{ALIGN_LABELS[a]}
                    </button>
                  )}
                </For>
                <div class="menu-sep" role="separator" />
                <button class="menu-item" role="menuitemradio" aria-checked={c().align() === null} data-testid="table-align-default" disabled={off()} onClick={act(() => c().setAlign(null))}>
                  {check(c().align() === null)}<Icon name="undo" />{c().kind() === 'cols' ? COPY.table.alignColumnDefault : COPY.table.alignCellDefault}
                </button>
              </>
            }}
          </BarMenu>
        </Wrap>
      )}
    </Show>
  )
}

export function TypeTool(props: { variant: Variant }) {
  const t = activeTable
  return (
    <Show when={t()}>
      {(c) => (
        <Wrap variant={props.variant}>
          <BarMenu
            label=""
            title={COPY.table.columnType}
            tip={COPY.table.columnType}
            testId={props.variant === 'dock' ? 'dock-type' : 'table-type'}
            menuTestId="table-type-menu"
            icon={<Icon name={TYPE_ICONS[c().columnType() ?? 'text']} size={size(props.variant)} />}
          >
            {(close) => <TypeItems close={close} />}
          </BarMenu>
        </Wrap>
      )}
    </Show>
  )
}

/** The six types, the current one ticked. Choosing one converts the selected columns' values (nothing is lost). */
export function TypeItems(props: { close: () => void }) {
  const t = activeTable
  const act = useAct(props.close)
  return (
    <Show when={t()}>
      {(c) => (
        <For each={COLUMN_TYPES}>
          {(type) => (
            <button class="menu-item" role="menuitemradio" aria-checked={c().columnType() === type} data-testid={`table-type-${type}`} onClick={act(() => c().setType(type))}>
              {check(c().columnType() === type)}<Icon name={TYPE_ICONS[type]} />{COPY.table.types[type]}
            </button>
          )}
        </For>
      )}
    </Show>
  )
}

export function SortTool(props: { variant: Variant }) {
  const t = activeTable
  return (
    <Show when={t()}>
      <Wrap variant={props.variant}>
          <BarMenu
            label=""
            title={COPY.table.sort}
            tip={COPY.table.sort}
            testId={props.variant === 'dock' ? 'dock-sort' : 'table-sort'}
            menuTestId="table-sort-menu"
            icon={<Icon name="sortAsc" size={size(props.variant)} />}
          >
            {(close) => <SortItems close={close} />}
          </BarMenu>
      </Wrap>
    </Show>
  )
}

/** Sort A to Z and Z to A, worded for what the column holds. A one-off: it rewrites the row order, once. */
export function SortItems(props: { close: () => void }) {
  const t = activeTable
  const act = useAct(props.close)
  return (
    <Show when={t()}>
      {(c) => <>
        <button class="menu-item" role="menuitem" data-testid="table-sort-asc" disabled={!c().canSort()} onClick={act(() => c().sort('asc'))}><Icon name="sortAsc" />{COPY.table.sortLabel(c().columnType() ?? 'text', 'asc')}</button>
        <button class="menu-item" role="menuitem" data-testid="table-sort-desc" disabled={!c().canSort()} onClick={act(() => c().sort('desc'))}><Icon name="sortDesc" />{COPY.table.sortLabel(c().columnType() ?? 'text', 'desc')}</button>
      </>}
    </Show>
  )
}

/** The fill panel: the card colours as dots (presets only; "no colour" clears). Cells, or whole rows when rows are picked. */
export function FillTool(props: { variant: Variant }) {
  const t = activeTable
  const [open, setOpen] = createSignal(false)
  let trigger!: HTMLButtonElement
  const label = () => (t()?.kind() === 'rows' ? COPY.table.fillRows : COPY.table.fill)
  const close = () => { setOpen(false); activeTable()?.refocus() }
  return (
    <Show when={t()}>
      {(c) => <>
        <Wrap variant={props.variant}>
          <button
            ref={trigger}
            class={props.variant === 'dock' ? 'bar-btn' : 'bar-btn bar-icon'}
            data-testid={props.variant === 'dock' ? 'dock-fill' : 'table-fill'}
            aria-label={label()}
            data-tip={label()}
            aria-haspopup="dialog"
            aria-expanded={open()}
            disabled={!c().canFormat()}
            onClick={() => setOpen(!open())}
          >
            <Icon size={size(props.variant)} name="fill" />
          </button>
        </Wrap>
        <Show when={open()}>
          <Popover anchor={() => trigger} label={label()} testid="table-fill-popover" class="labels-panel table-pop table-fill" align="start" autofocus={!touch()} close={close}>
            <div class="nav-menu-head sheet-only" aria-hidden="true"><strong>{label()}</strong></div>
            <ColorDots
              class="label-dots"
              label={label()}
              dots={CARD_COLORS.map((color) => ({ value: color, name: COPY.colorNames[color] ?? color, paint: color === 'none' ? 'transparent' : `var(--dn-card-${color}-bg)`, testid: `table-fill-${color}`, none: color === 'none' }))}
              value={c().fill() ?? 'none'}
              autofocus
              onPick={(color) => { c().setFill(color === 'none' ? null : (color as PresetColor)); close() }}
            />
          </Popover>
        </Show>
      </>}
    </Show>
  )
}
