import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { COPY } from '@doggynote/theme'
import type { Vec } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { beginEdit, setCardContextOpen } from '../state/ui.ts'
import { burySelection } from '../state/actions.ts'
import { duplicateSelection } from '../state/clipboard.ts'
import { liveState, peers, pingAt } from '../state/realtime.ts'
import { LabelsPopover } from './Labels.tsx'
import { openThread } from './CommentsPanel.tsx'
import { Icon, ToolIcons } from './icons.tsx'
import { installMenu } from './menu.ts'

export type ContextPoint = Vec & { screenX: number; screenY: number; cardId: string | null; returnTo: HTMLElement }

/** Card actions use the same selection commands as the floating bar. Empty
 * canvas only gets a menu when there's somebody to receive a location ping. */
export function CardContextMenu(props: { point: ContextPoint; close: () => void }) {
  let menu!: HTMLDivElement
  const [labels, setLabels] = createSignal(false)
  const [at, setAt] = createSignal({ left: props.point.screenX, top: props.point.screenY })
  const card = () => doc.getCard(props.point.cardId ?? '')
  const writable = () => doc.canWriteObject(card())
  const canEdit = () => writable() && ['note', 'todo', 'column', 'image', 'swatch', 'board', 'link', 'movie'].includes(card()?.type ?? '')
  const canPing = () => liveState() === 'live' && peers().length > 0
  const close = () => { props.close(); props.point.returnTo.focus({ preventScroll: true }) }
  const run = (action: () => void) => { close(); action() }
  createEffect(() => setCardContextOpen(!!card() && !labels()))
  onCleanup(() => setCardContextOpen(false))
  installMenu(() => !labels(), props.close, () => menu, () => props.point.returnTo)
  createEffect(() => {
    const c = card()
    if (props.point.cardId && (!c || c.deletedAt || c.purged)) close()
    if (!props.point.cardId && !canPing()) close()
  })
  onMount(() => {
    setAt({ left: Math.max(8, Math.min(props.point.screenX, innerWidth - menu.offsetWidth - 8)), top: Math.max(8, Math.min(props.point.screenY, innerHeight - menu.offsetHeight - 8)) })
  })
  return (
    <Portal>
      <Show when={!labels()} fallback={<LabelsPopover cards={[card()!]} anchor={() => props.point.returnTo} close={close} />}>
        <div ref={menu} class="menu canvas-ping-menu" classList={{ 'card-context-menu': !!card() }} role="menu" aria-label={card() ? 'Card actions' : COPY.lookHere} data-testid="canvas-context-menu" data-nodrag
          style={{ position: 'fixed', left: `${at().left}px`, top: `${at().top}px` }}
          onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <Show when={card()}>
            <button class="menu-item" role="menuitem" disabled={!canEdit()} onClick={() => run(() => beginEdit(card()!.id))}><Icon size={18}>{ToolIcons.edit()}</Icon>Edit</button>
            <button class="menu-item" role="menuitem" disabled={!writable()} onClick={() => run(duplicateSelection)}><Icon size={18}>{ToolIcons.duplicate()}</Icon>Duplicate</button>
            <button class="menu-item" role="menuitem" disabled={!writable() || card()?.type === 'column'} onClick={() => setLabels(true)}><Icon size={18}>{ToolIcons.label()}</Icon>Labels</button>
            <button class="menu-item" role="menuitem" disabled={card()?.type === 'board'} onClick={() => run(() => openThread(card()!.id))}><Icon size={18}>{ToolIcons.comment()}</Icon>Comment</button>
            <div class="menu-sep" role="separator" />
            <button class="menu-item" role="menuitem" disabled={!writable()} onClick={() => run(burySelection)}><Icon size={18}>{ToolIcons.trash()}</Icon>{COPY.bury}</button>
          </Show>
          <Show when={canPing()}>
            <Show when={card()}><div class="menu-sep" role="separator" /></Show>
            <button class="menu-item" role="menuitem" onClick={() => run(() => pingAt(props.point))}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>{COPY.lookHere}</button>
          </Show>
        </div>
      </Show>
    </Portal>
  )
}
