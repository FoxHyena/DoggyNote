import { For, Match, Show, Switch, createMemo } from 'solid-js'
import { cardColorVars, COPY } from '@doggynote/theme'
import { cellDisplay, cellKey, cellValue, effectiveAlign, isBlankTable, readCell, setCells, tableColumns, tableRows, tableTitle, unreadText, type Card, type Cell, type TableColumn } from '@doggynote/core'
import * as doc from '../../state/doc.ts'
import { Icon } from '../../ui/icons.tsx'
import { editIsNewCard, isSelected, onEndEdit } from '../../state/ui.ts'
import { chipVars } from './chip.ts'
import { formatDate, formatNumber } from './format.ts'
import { TableEditor } from './TableEditor.tsx'
import type { CardProps } from '../../canvas/CardView.tsx'
import './table.css'

// A table card: its title, then a plain <table> with fixed layout. Every cell
// reads only its own synced field, so one person's edit repaints one cell. The
// editor (TableEditor) draws on top of this same DOM while the card is edited,
// so entering edit mode never moves anything.

// A new table left exactly as it started disappears instead of littering the board.
onEndEdit((id) => {
  const c = doc.getCard(id)
  if (c?.type === 'table' && editIsNewCard() && isBlankTable(c, COPY.table.starterColumns)) doc.discardNew(id)
})

const sameJson = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b)
const NO_COLUMN: TableColumn = { id: '', n: '', o: 0, w: 1, t: 'text', opts: [] }

export function TableCard(props: CardProps<'table'>) {
  return (
    <Show when={!props.lod} fallback={<div class="lod-box" style={{ height: `${Math.max(24, props.card.h - 24)}px` }} />}>
      <TableGrid card={props.card} editing={props.editing} readOnly={props.readOnly} />
    </Show>
  )
}

function TableGrid(props: { card: Card<'table'>; editing: boolean; readOnly: boolean }) {
  let wrap!: HTMLDivElement
  let tableEl: HTMLTableElement | undefined
  const fields = () => props.card as unknown as Record<string, unknown>
  // These re-run when a key is added or removed (a new cell), and keep their value
  // (so nothing downstream repaints) unless the rows or columns really changed.
  const columns = createMemo(() => tableColumns(props.card), [], { equals: sameJson })
  const rows = createMemo(() => tableRows(props.card), [], { equals: sameJson })
  const colIds = createMemo(() => columns().map((c) => c.id), [], { equals: sameJson })
  const rowIds = createMemo(() => rows().map((r) => r.id), [], { equals: sameJson })
  const total = createMemo(() => columns().reduce((sum, c) => sum + c.w, 0) || 1)
  const title = () => tableTitle(props.card)
  const writable = () => doc.canWriteObject(props.card)
  const toggle = (rowId: string, colId: string, on: boolean) => doc.update({ [props.card.id]: setCells(props.card, [{ row: rowId, col: colId, value: on }]) as Partial<Card> })
  const showTitle = () => !!title() || writable()
  // A selected table that isn't being edited ticks a box with one click, like a to-do. Never in the viewer.
  const live = () => !props.readOnly && writable() && !props.editing && isSelected(props.card.id)

  return (
    <div class="table-card" ref={wrap} data-testid="table-card">
      <div class="table-clip">
        <Show when={showTitle()}>
          <div class="table-title" data-table-title data-testid="table-title">
            <Show when={title()} fallback={<span class="table-placeholder" aria-hidden="true"><Icon name="paw" size={20} />{COPY.table.titlePlaceholder}</span>}>{title()}</Show>
          </div>
        </Show>
        <Show when={colIds().length} fallback={<div class="table-empty" data-testid="table-empty"><Icon name="paw" size={20} />{COPY.table.empty}</div>}>
          <table
            ref={tableEl}
            class="table-grid"
            data-testid="table-grid"
            role={props.editing ? 'grid' : undefined}
            aria-label={title() || COPY.table.gridLabel}
            aria-rowcount={props.editing ? rowIds().length + 1 : undefined}
            aria-colcount={props.editing ? colIds().length : undefined}
          >
            <colgroup>
              <For each={colIds()}>{(id) => <col style={{ width: `${((columns().find((c) => c.id === id)?.w ?? 1) / total()) * 100}%` }} />}</For>
            </colgroup>
            <thead>
              <tr>
                <For each={colIds()}>{(id) => <HeaderCell id={id} column={() => columns().find((c) => c.id === id) ?? NO_COLUMN} />}</For>
              </tr>
            </thead>
            <tbody>
              <For each={rowIds()}>
                {(rowId) => {
                  const bg = () => rows().find((r) => r.id === rowId)?.bg
                  return (
                    <tr data-row={rowId}>
                      <For each={colIds()}>
                        {(colId) => <BodyCell card={fields} rowId={rowId} colId={colId} rowBg={bg} live={live} toggle={toggle} column={() => columns().find((c) => c.id === colId) ?? NO_COLUMN} />}
                      </For>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
      <Show when={props.editing}>
        <TableEditor card={props.card} wrap={() => wrap} table={() => tableEl} rowIds={rowIds} colIds={colIds} columns={columns} />
      </Show>
    </div>
  )
}

function HeaderCell(props: { id: string; column: () => TableColumn }) {
  return (
    <th scope="col" data-col={props.id} data-row="" data-align={effectiveAlign(props.column(), undefined)} data-type={props.column().t}>
      {props.column().n}
    </th>
  )
}

function BodyCell(props: {
  card: () => Record<string, unknown>
  rowId: string
  colId: string
  rowBg: () => string | undefined
  column: () => TableColumn
  live: () => boolean
  toggle: (rowId: string, colId: string, on: boolean) => void
}) {
  // The one field this cell reads. A value of any type is tolerated (synced data).
  const cell = createMemo(() => readCell(props.card()[cellKey(props.rowId, props.colId)]), undefined, { equals: sameJson })
  // Cell beats row; the row beats the card.
  const fill = () => {
    const bg = cell().bg ?? props.rowBg()
    return bg ? cardColorVars(bg) : null
  }
  // Text a number or date column could not read stays visible, muted.
  const unread = () => unreadText(props.column(), cell())
  return (
    <td
      data-row={props.rowId}
      data-col={props.colId}
      data-align={effectiveAlign(props.column(), cell().a)}
      data-type={props.column().t}
      data-bold={cell().b ? '' : undefined}
      data-muted={unread() !== null ? '' : undefined}
      data-fill={fill() ? '' : undefined}
      style={fill() ? { '--cell-bg': fill()!.bg, '--cell-text': fill()!.text } : undefined}
    >
      <CellContent column={props.column()} cell={cell()} unread={unread()} live={props.live()} toggle={(on) => props.toggle(props.rowId, props.colId, on)} />
    </td>
  )
}

/** What a cell shows for its column's type. Anything the type can't read draws nothing (or, for numbers and dates, muted text). */
function CellContent(props: { column: TableColumn; cell: Cell; unread: string | null; live: boolean; toggle: (on: boolean) => void }) {
  const value = () => cellValue(props.column, props.cell)
  return (
    <Switch fallback={cellDisplay(props.column, props.cell)}>
      <Match when={props.unread !== null}>{props.unread}</Match>
      <Match when={props.column.t === 'number' && typeof value() === 'number'}>{formatNumber(value() as number)}</Match>
      <Match when={props.column.t === 'date' && typeof value() === 'string'}>{formatDate(value() as string)}</Match>
      <Match when={props.column.t === 'checkbox'}>
        <span
          class="table-check"
          data-testid="table-check"
          role="checkbox"
          aria-checked={value() === true}
          aria-readonly={!props.live || undefined}
          aria-label={value() === true ? COPY.table.ticked : COPY.table.unticked}
          data-nodrag={props.live ? '' : undefined}
          onClick={() => props.live && props.toggle(value() !== true)}
        />
      </Match>
      <Match when={props.column.t === 'rating'}>
        <span class="table-rating" data-testid="table-rating" role="img" data-n={(value() as number | null) ?? 0} aria-label={COPY.table.pawsLabel((value() as number | null) ?? 0)}>
          <For each={[1, 2, 3, 4, 5]}>
            {(i) => <span class="table-paw" data-paw={i} data-on={i <= ((value() as number | null) ?? 0) ? '' : undefined}><Icon name="paw" size={14} /></span>}
          </For>
        </span>
      </Match>
      <Match when={props.column.t === 'select'}>
        <Show when={props.column.opts.find((o) => o.id === value())}>
          {(o) => <span class="table-chip" data-testid="table-chip" data-none={o().c === 'none' ? '' : undefined} style={chipVars(o().c)}>{o().n}</span>}
        </Show>
      </Match>
    </Switch>
  )
}
