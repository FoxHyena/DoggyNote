import { Match, Show, Switch } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { activeTable } from '../cards/table/tableControl.ts'
import { BarMenu } from './BarMenu.tsx'
import { Icon, IconButton } from './icons.tsx'

// The selection bar while a table's cells are being edited (a mouse; touch has
// TableDock). Few controls on purpose: the bar stays narrow, and everything else
// is in the ⋯ menu. Which buttons show follows what is selected (cells, whole
// rows, whole columns); PR 4's Fill, Type, Sort and Align join each context
// before ⋯. Pointer presses are kept from taking focus, so the grid's field keeps
// the keyboard and a half-typed cell isn't saved early.

const keepFocus = (e: PointerEvent) => e.preventDefault()

export function TableBar() {
  const table = activeTable
  return (
    <Show when={table()}>
      {(t) => (
        <div class="bar-group bar-table" role="group" aria-label={COPY.table.cells} data-testid="table-bar" data-kind={t().kind()} onPointerDown={keepFocus}>
          <Switch>
            <Match when={t().kind() === 'rows'}>
              <IconButton testid="table-row-below" icon="rowBelow" label={COPY.table.insertRowBelow} disabled={!t().canAddRow()} onClick={() => t().insertRow('below')} />
              <IconButton testid="table-delete" icon="trash" label={COPY.table.deleteRows(Math.max(1, t().rowSpan()))} disabled={!t().rowSpan()} onClick={() => t().removeRows()} />
            </Match>
            <Match when={t().kind() === 'cols'}>
              <IconButton testid="table-column-right" icon="columnRight" label={COPY.table.insertColumnRight} disabled={!t().canAddColumn()} onClick={() => t().insertColumn('right')} />
              <IconButton testid="table-delete" icon="trash" label={COPY.table.deleteColumns(Math.max(1, t().colSpan()))} disabled={!t().canRemoveColumns()} onClick={() => t().removeColumns()} />
            </Match>
            <Match when={true}>
              <IconButton testid="table-row-below" icon="rowBelow" label={COPY.table.insertRowBelow} disabled={!t().canAddRow()} onClick={() => t().insertRow('below')} />
              <IconButton testid="table-column-right" icon="columnRight" label={COPY.table.insertColumnRight} disabled={!t().canAddColumn()} onClick={() => t().insertColumn('right')} />
              <IconButton testid="table-clear" icon="eraser" label={COPY.table.clear} title={`${COPY.table.clear} (Delete)`} disabled={!t().rowSpan()} onClick={() => t().clear()} />
            </Match>
          </Switch>
          <BarMenu label="" title={COPY.table.moreActions} testId="table-more" menuTestId="table-more-menu" icon={<Icon name="more" size={18} />}>
            {(close) => <TableMenuItems close={close} />}
          </BarMenu>
        </div>
      )}
    </Show>
  )
}

/** The ⋯ of the bar and the dock: the items for what is selected. */
export function TableMenuItems(props: { close: () => void }) {
  const table = activeTable
  return (
    <Show when={table()}>
      {(t) => (
        <Switch>
          <Match when={t().kind() === 'rows'}><RowMenuItems close={props.close} /></Match>
          <Match when={t().kind() === 'cols'}><ColumnMenuItems close={props.close} /></Match>
          <Match when={true}><CellMenuItems close={props.close} /></Match>
        </Switch>
      )}
    </Show>
  )
}

const useAct = (close: () => void) => (run: () => void) => () => { close(); run(); activeTable()?.refocus() }

/** Selected cells: insert and delete around them, and clear. */
function CellMenuItems(props: { close: () => void }) {
  const table = activeTable
  const act = useAct(props.close)
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

/** Selected rows (a row grip). */
export function RowMenuItems(props: { close: () => void }) {
  const table = activeTable
  const act = useAct(props.close)
  return (
    <Show when={table()}>
      {(t) => <>
        <button class="menu-item" role="menuitem" data-testid="table-row-above" disabled={!t().canAddRow()} onClick={act(() => t().insertRow('above'))}><Icon name="rowAbove" />{COPY.table.insertRowAbove}</button>
        <button class="menu-item" role="menuitem" data-testid="table-menu-row-below" disabled={!t().canAddRow()} onClick={act(() => t().insertRow('below'))}><Icon name="rowBelow" />{COPY.table.insertRowBelow}</button>
        <button class="menu-item" role="menuitem" data-testid="table-move-up" disabled={!t().canMove(-1)} onClick={act(() => t().move(-1))}><Icon name="arrowUp" />{COPY.table.moveRowUp}<kbd class="menu-hint">⌥⇧↑</kbd></button>
        <button class="menu-item" role="menuitem" data-testid="table-move-down" disabled={!t().canMove(1)} onClick={act(() => t().move(1))}><Icon name="arrowDown" />{COPY.table.moveRowDown}<kbd class="menu-hint">⌥⇧↓</kbd></button>
        <button class="menu-item" role="menuitem" data-testid="table-duplicate-rows" disabled={!t().canDuplicateRows()} onClick={act(() => t().duplicateRows())}><Icon name="duplicate" />{COPY.table.duplicateRows(Math.max(1, t().rowSpan()))}</button>
        <div class="menu-sep" role="separator" />
        <button class="menu-item" role="menuitem" data-testid="table-menu-clear" disabled={!t().rowSpan()} onClick={act(() => t().clear())}><Icon name="eraser" />{COPY.table.clear}</button>
        <button class="menu-item" role="menuitem" data-testid="table-delete-rows" disabled={!t().rowSpan()} onClick={act(() => t().removeRows())}><Icon name="trash" />{COPY.table.deleteRows(Math.max(1, t().rowSpan()))}</button>
      </>}
    </Show>
  )
}

/** Selected columns (a column grip or header): the one list for the bar's ⋯, the grip menu and the header's ⋯. */
export function ColumnMenuItems(props: { close: () => void }) {
  const table = activeTable
  const act = useAct(props.close)
  return (
    <Show when={table()}>
      {(t) => <>
        <button class="menu-item" role="menuitem" data-testid="table-rename-column" disabled={t().colSpan() !== 1} onClick={() => { props.close(); t().renameColumn() }}><Icon name="edit" />{COPY.table.renameColumn}</button>
        <button class="menu-item" role="menuitem" data-testid="table-column-left" disabled={!t().canAddColumn()} onClick={act(() => t().insertColumn('left'))}><Icon name="columnLeft" />{COPY.table.insertColumnLeft}</button>
        <button class="menu-item" role="menuitem" data-testid="table-menu-column-right" disabled={!t().canAddColumn()} onClick={act(() => t().insertColumn('right'))}><Icon name="columnRight" />{COPY.table.insertColumnRight}</button>
        <button class="menu-item" role="menuitem" data-testid="table-move-left" disabled={!t().canMove(-1)} onClick={act(() => t().move(-1))}><Icon name="arrowLeft" />{COPY.table.moveColumnLeft}<kbd class="menu-hint">⌥⇧←</kbd></button>
        <button class="menu-item" role="menuitem" data-testid="table-move-right" disabled={!t().canMove(1)} onClick={act(() => t().move(1))}><Icon name="arrowRight" />{COPY.table.moveColumnRight}<kbd class="menu-hint">⌥⇧→</kbd></button>
        <div class="menu-sep" role="separator" />
        <button class="menu-item" role="menuitem" data-testid="table-delete-columns" disabled={!t().canRemoveColumns()} onClick={act(() => t().removeColumns())}><Icon name="trash" />{COPY.table.deleteColumns(Math.max(1, t().colSpan()))}</button>
      </>}
    </Show>
  )
}
