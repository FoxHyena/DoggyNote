import { Show, createSignal, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { COPY } from '@doggynote/theme'
import { phone } from '../state/device.ts'
import { ColumnMenuItems, RowMenuItems } from './TableBar.tsx'
import { installMenu } from './menu.ts'
import { SheetGrip } from './SheetGrip.tsx'

// The menu of a row or column grip (right-click or long-press) and of a column
// header's ⋯. Same items as the bar's ⋯, on the same menu shell: a popover beside
// the pointer, a bottom sheet on a phone (mobile.css).

export function TableLineMenu(props: { kind: 'rows' | 'cols'; x: number; y: number; returnTo: () => HTMLElement; close: () => void }) {
  let menu!: HTMLDivElement
  const [at, setAt] = createSignal({ left: props.x, top: props.y })
  const title = () => (props.kind === 'rows' ? COPY.table.rowActions : COPY.table.columnActions)
  installMenu(() => true, props.close, () => menu, props.returnTo)
  onMount(() => {
    setAt({ left: Math.max(8, Math.min(props.x, innerWidth - menu.offsetWidth - 8)), top: Math.max(8, Math.min(props.y, innerHeight - menu.offsetHeight - 8)) })
  })
  return (
    <Portal>
      <div ref={menu} class="menu bar-menu table-line-menu" role="menu" aria-label={title()} data-testid={props.kind === 'rows' ? 'table-row-menu' : 'table-column-menu-list'} data-nodrag style={{ position: 'fixed', left: `${at().left}px`, top: `${at().top}px` }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        <SheetGrip onDismiss={props.close} />
        <div class="nav-menu-head sheet-only"><strong>{title()}</strong><Show when={phone()}><button class="bar-btn" role="menuitem" onClick={props.close}>Done</button></Show></div>
        <Show when={props.kind === 'rows'} fallback={<ColumnMenuItems close={props.close} />}><RowMenuItems close={props.close} /></Show>
      </div>
    </Portal>
  )
}
