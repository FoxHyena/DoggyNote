import { Match, Show, Switch } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { activeTable } from '../cards/table/tableControl.ts'
import { TableMenuItems } from './TableBar.tsx'
import { BarMenu } from './BarMenu.tsx'
import { Icon } from './icons.tsx'

// Editing a table on a phone: one row of controls riding on the keyboard (inside
// EditDock). Laid out in three places: ‹ › on the left (they stand in for Tab,
// since the keyboard has none; › on the last cell adds a row), the selection's
// own buttons in the middle (PR 4 adds Bold, Align, Fill and Type there, up to
// three), and ⋯ pushed to the right edge. The buttons act on pointerdown and
// keep focus, so the keyboard stays up.

export function TableDock() {
  const keep = (e: PointerEvent) => e.preventDefault()
  const press = (run: () => void) => (e: PointerEvent) => { keep(e); run() }
  return (
    <Show when={activeTable()}>
      {(t) => (
        <div class="table-dock" role="toolbar" aria-label={COPY.table.cells} data-testid="table-dock" data-kind={t().kind()}>
          <button class="table-dock-btn" data-testid="dock-prev" aria-label={COPY.table.previousCell} onPointerDown={press(() => t().prev())}><Icon size={22} name="chevronLeft" /></button>
          <button class="table-dock-btn" data-testid="dock-next" aria-label={COPY.table.nextCell} onPointerDown={press(() => t().next())}><Icon size={22} name="chevronRight" /></button>
          <span class="table-dock-sep" aria-hidden="true" />
          <div class="table-dock-slots" data-testid="dock-slots">
            <Switch>
              <Match when={t().kind() === 'rows'}>
                <button class="table-dock-btn" data-testid="dock-row-below" aria-label={COPY.table.insertRowBelow} disabled={!t().canAddRow()} onPointerDown={press(() => t().insertRow('below'))}><Icon size={22} name="rowBelow" /></button>
                <button class="table-dock-btn" data-testid="dock-delete" aria-label={COPY.table.deleteRows(Math.max(1, t().rowSpan()))} disabled={!t().rowSpan()} onPointerDown={press(() => t().removeRows())}><Icon size={22} name="trash" /></button>
              </Match>
              <Match when={t().kind() === 'cols'}>
                <button class="table-dock-btn" data-testid="dock-column-right" aria-label={COPY.table.insertColumnRight} disabled={!t().canAddColumn()} onPointerDown={press(() => t().insertColumn('right'))}><Icon size={22} name="columnRight" /></button>
                <button class="table-dock-btn" data-testid="dock-delete" aria-label={COPY.table.deleteColumns(Math.max(1, t().colSpan()))} disabled={!t().canRemoveColumns()} onPointerDown={press(() => t().removeColumns())}><Icon size={22} name="trash" /></button>
              </Match>
            </Switch>
          </div>
          {/* The menu button needs its click, which a cancelled pointerdown loses on iOS: it keeps its own. */}
          <span class="table-dock-menu" onPointerDown={(e) => e.stopPropagation()}>
            <BarMenu label="" title={COPY.table.moreActions} testId="dock-table-more" menuTestId="dock-table-more-menu" icon={<Icon name="more" size={22} />}>
              {(close) => <TableMenuItems close={close} />}
            </BarMenu>
          </span>
        </div>
      )}
    </Show>
  )
}
