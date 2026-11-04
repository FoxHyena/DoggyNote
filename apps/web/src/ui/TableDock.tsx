import { Show } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { activeTable } from '../cards/table/tableControl.ts'
import { TableMenuItems } from './TableBar.tsx'
import { BarMenu } from './BarMenu.tsx'
import { Icon } from './icons.tsx'

// Editing a table on a phone: one row of controls riding on the keyboard (inside
// EditDock). ‹ and › stand in for Tab, since the keyboard has none; › on the last
// cell adds a row. The buttons act on pointerdown and keep focus, so the
// keyboard stays up. Bold, align and fill get their places between › and ⋯.

export function TableDock() {
  const keep = (e: PointerEvent) => e.preventDefault()
  return (
    <Show when={activeTable()}>
      {(t) => (
        <div class="table-dock" role="toolbar" aria-label={COPY.table.cells} data-testid="table-dock">
          <button class="table-dock-btn" data-testid="dock-prev" aria-label={COPY.table.previousCell} onPointerDown={(e) => { keep(e); t().prev() }}><Icon size={22} name="chevronLeft" /></button>
          <button class="table-dock-btn" data-testid="dock-next" aria-label={COPY.table.nextCell} onPointerDown={(e) => { keep(e); t().next() }}><Icon size={22} name="chevronRight" /></button>
          <span class="table-dock-sep" aria-hidden="true" />
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
