import { Show } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { activeTable } from '../cards/table/tableControl.ts'
import { BarMenu } from './BarMenu.tsx'
import { Icon, IconButton } from './icons.tsx'

// The selection bar while a table's cells are being edited (a mouse; touch has
// TableDock). Few controls on purpose: the bar stays narrow, and everything else
// is in the ⋯ menu. Pointer presses are kept from taking focus, so the grid's
// field keeps the keyboard and a half-typed cell isn't saved early.

const keepFocus = (e: PointerEvent) => e.preventDefault()

export function TableBar() {
  const table = activeTable
  return (
    <Show when={table()}>
      {(t) => (
        <div class="bar-group bar-table" role="group" aria-label={COPY.table.cells} data-testid="table-bar" onPointerDown={keepFocus}>
          <IconButton testid="table-row-below" icon="rowBelow" label={COPY.table.insertRowBelow} disabled={!t().canAddRow()} onClick={() => t().insertRow('below')} />
          <IconButton testid="table-column-right" icon="columnRight" label={COPY.table.insertColumnRight} disabled={!t().canAddColumn()} onClick={() => t().insertColumn('right')} />
          <IconButton testid="table-clear" icon="eraser" label={COPY.table.clear} disabled={!t().rowSpan()} onClick={() => t().clear()} />
          <BarMenu label="" title={COPY.table.moreActions} testId="table-more" menuTestId="table-more-menu" icon={<Icon name="more" size={18} />}>
            {(close) => <TableMenuItems close={close} />}
          </BarMenu>
        </div>
      )}
    </Show>
  )
}

/** The structure actions, in the bar's ⋯ and the dock's. */
export function TableMenuItems(props: { close: () => void }) {
  const table = activeTable
  const act = (run: () => void) => () => { props.close(); run(); table()?.refocus() }
  return (
    <Show when={table()}>
      {(t) => <>
        <button class="menu-item" role="menuitem" data-testid="table-row-above" disabled={!t().canAddRow() || t().inHeader()} onClick={act(() => t().insertRow('above'))}><Icon name="rowAbove" />{COPY.table.insertRowAbove}</button>
        <button class="menu-item" role="menuitem" data-testid="table-menu-row-below" disabled={!t().canAddRow()} onClick={act(() => t().insertRow('below'))}><Icon name="rowBelow" />{COPY.table.insertRowBelow}</button>
        <button class="menu-item" role="menuitem" data-testid="table-column-left" disabled={!t().canAddColumn()} onClick={act(() => t().insertColumn('left'))}><Icon name="columnLeft" />{COPY.table.insertColumnLeft}</button>
        <button class="menu-item" role="menuitem" data-testid="table-menu-column-right" disabled={!t().canAddColumn()} onClick={act(() => t().insertColumn('right'))}><Icon name="columnRight" />{COPY.table.insertColumnRight}</button>
        <div class="menu-sep" role="separator" />
        <button class="menu-item" role="menuitem" data-testid="table-delete-rows" disabled={!t().rowSpan()} onClick={act(() => t().removeRows())}><Icon name="trash" />{COPY.table.deleteRows(Math.max(1, t().rowSpan()))}</button>
        <button class="menu-item" role="menuitem" data-testid="table-delete-columns" disabled={!t().canRemoveColumns()} onClick={act(() => t().removeColumns())}><Icon name="trash" />{COPY.table.deleteColumns(Math.max(1, t().colSpan()))}</button>
        <div class="menu-sep" role="separator" />
        <button class="menu-item" role="menuitem" data-testid="table-menu-clear" disabled={!t().rowSpan()} onClick={act(() => t().clear())}><Icon name="eraser" />{COPY.table.clear}</button>
      </>}
    </Show>
  )
}
