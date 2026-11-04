import { For, Show, createMemo } from 'solid-js'
import { cardColorVars, COPY } from '@doggynote/theme'
import { cellDisplay, cellKey, isBlankTable, readCell, tableColumns, tableRows, tableTitle, type Align, type Card, type TableColumn } from '@doggynote/core'
import * as doc from '../../state/doc.ts'
import { Icon } from '../../ui/icons.tsx'
import { editIsNewCard, onEndEdit } from '../../state/ui.ts'
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
      <TableGrid card={props.card} editing={props.editing} />
    </Show>
  )
}

function TableGrid(props: { card: Card<'table'>; editing: boolean }) {
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
  const showTitle = () => !!title() || writable()

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
                        {(colId) => <BodyCell card={fields} rowId={rowId} colId={colId} rowBg={bg} column={() => columns().find((c) => c.id === colId) ?? NO_COLUMN} />}
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
    <th scope="col" data-col={props.id} data-row="" data-align={alignOf(props.column(), undefined)} data-type={props.column().t}>
      {props.column().n}
    </th>
  )
}

function BodyCell(props: { card: () => Record<string, unknown>; rowId: string; colId: string; rowBg: () => string | undefined; column: () => TableColumn }) {
  // The one field this cell reads. A value of any type is tolerated (synced data).
  const cell = createMemo(() => readCell(props.card()[cellKey(props.rowId, props.colId)]), undefined, { equals: sameJson })
  const fill = () => {
    const bg = cell().bg ?? props.rowBg()
    return bg ? cardColorVars(bg) : null
  }
  return (
    <td
      data-row={props.rowId}
      data-col={props.colId}
      data-align={alignOf(props.column(), cell().a)}
      data-type={props.column().t}
      data-bold={cell().b ? '' : undefined}
      data-fill={fill() ? '' : undefined}
      style={fill() ? { '--cell-bg': fill()!.bg, '--cell-text': fill()!.text } : undefined}
    >
      {cellDisplay(props.column(), cell())}
    </td>
  )
}

/** Left unless the cell, its column or its type says otherwise: numbers sit on the right. */
function alignOf(column: TableColumn, cellAlign: Align | undefined): Align {
  return cellAlign ?? column.a ?? (column.t === 'number' ? 'r' : 'l')
}
