import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { COPY } from '@doggynote/theme'
import type { Card, Vec } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { beginEdit, selection, setCardContextOpen } from '../state/ui.ts'
import { canCreateAreaFromSelection, createAreaFromSelection, buryArea, tidyArea } from '../state/areas.ts'
import { burySelection, canMoveSelection } from '../state/actions.ts'
import { MoveToBoardPopover, moveTargets } from './MoveToBoard.tsx'
import { duplicateSelection } from '../state/clipboard.ts'
import { canMakeSyncedCopy, makeSyncedCopy } from '../state/synced.ts'
import { liveState, peers, pingAt } from '../state/realtime.ts'
import { LabelsPopover } from './Labels.tsx'
import { openThread } from './CommentsPanel.tsx'
import { Icon } from './icons.tsx'
import { installMenu } from './menu.ts'
import { SheetGrip } from './SheetGrip.tsx'

export type ContextPoint = Vec & { screenX: number; screenY: number; cardId: string | null; returnTo: HTMLElement }

/** Card actions use the same selection commands as the floating bar. Empty
 * canvas only gets a menu when there's somebody to receive a location ping. */
export function CardContextMenu(props: { point: ContextPoint; close: () => void }) {
  let menu!: HTMLDivElement
  const [labels, setLabels] = createSignal(false)
  const [moving, setMoving] = createSignal(false)
  const [at, setAt] = createSignal({ left: props.point.screenX, top: props.point.screenY })
  const card = () => doc.getCard(props.point.cardId ?? '')
  const cards = createMemo(() => [...selection()].map((id) => doc.getCard(id)).filter((c): c is Card => !!c))
  const sole = () => selection().size === 1 ? card() : undefined
  const writable = () => selection().size > 0 && [...selection()].every((id) => doc.canWriteObject(doc.get(id)))
  const canEdit = () => !!sole() && writable() && ['area', 'note', 'todo', 'column', 'image', 'swatch', 'board', 'link', 'movie', 'sketch'].includes(sole()!.type)
  const canLabel = () => writable() && cards().length > 0 && cards().every((c) => c.type !== 'column' && c.type !== 'area' && c.boardId === cards()[0].boardId)
  const canPing = () => liveState() === 'live' && peers().length > 0
  const close = () => { props.close(); props.point.returnTo.focus({ preventScroll: true }) }
  const run = (action: () => void) => { close(); action() }
  createEffect(() => setCardContextOpen(!!card() && !labels() && !moving()))
  onCleanup(() => setCardContextOpen(false))
  installMenu(() => !labels() && !moving(), props.close, () => menu, () => props.point.returnTo)
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
      <Show when={moving()}><MoveToBoardPopover anchor={() => props.point.returnTo} close={close} /></Show>
      <Show when={!labels() && !moving()} fallback={<Show when={labels()}><LabelsPopover cards={cards()} anchor={() => props.point.returnTo} close={close} /></Show>}>
        <div ref={menu} class="menu canvas-ping-menu" classList={{ 'card-context-menu': !!card() }} role="menu" aria-label={card() ? 'Card actions' : COPY.lookHere} data-testid="canvas-context-menu" data-nodrag
          style={{ position: 'fixed', left: `${at().left}px`, top: `${at().top}px` }}
          onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <SheetGrip onDismiss={close} />
          <Show when={card()}>
            <button class="menu-item" role="menuitem" disabled={!canEdit()} onClick={() => run(() => beginEdit(card()!.id))}><Icon name="edit" size={18} />{card()?.type === 'board' ? 'Rename' : 'Edit'}</button>
            <button class="menu-item" role="menuitem" disabled={!writable()} onClick={() => run(duplicateSelection)}><Icon name="duplicate" size={18} />Duplicate</button>
            <Show when={canMakeSyncedCopy(sole())}>
              <button class="menu-item" role="menuitem" data-testid="make-synced-copy" onClick={() => run(() => makeSyncedCopy(card()!.id))}><Icon name="synced" size={18} />{COPY.synced.make}</button>
            </Show>
            <button class="menu-item" role="menuitem" disabled={!canLabel()} onClick={() => setLabels(true)}><Icon name="label" size={18} />Labels</button>
            <button class="menu-item" role="menuitem" disabled={!sole() || sole()?.type === 'board'} onClick={() => run(() => openThread(card()!.id))}><Icon name="comment" size={18} />Comment</button>
            <Show when={canMoveSelection() && moveTargets().length}><button class="menu-item" role="menuitem" data-testid="move-to-board" onClick={() => setMoving(true)}><Icon name="moveTo" size={18} />Move to board…</button></Show>
            <Show when={canCreateAreaFromSelection()}><button class="menu-item" role="menuitem" data-testid="area-from-selection" onClick={() => run(() => { createAreaFromSelection() })}><Icon name="board" size={18} />Create area from selection</button></Show>
            <Show when={sole()?.type === 'area'}><button class="menu-item" role="menuitem" onClick={() => run(() => tidyArea(sole()!.id))}>Tidy area</button><button class="menu-item" role="menuitem" onClick={() => run(() => buryArea(sole()!.id))}>Bury area and contents</button></Show>
            <div class="menu-sep" role="separator" />
            <button class="menu-item" role="menuitem" disabled={!writable()} onClick={() => run(burySelection)}><Icon name="bury" size={18} />{sole()?.type === 'area' ? 'Remove area (keep contents)' : COPY.bury}</button>
          </Show>
          <Show when={canPing()}>
            <Show when={card()}><div class="menu-sep" role="separator" /></Show>
            <button class="menu-item" role="menuitem" onClick={() => run(() => pingAt(props.point))}><Icon name="lookHere" size={18} />{COPY.lookHere}</button>
          </Show>
        </div>
      </Show>
    </Portal>
  )
}
