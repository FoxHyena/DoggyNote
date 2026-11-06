import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { COPY } from '@doggynote/theme'
import type { Card, Vec } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { beginEdit, boardId, selection, setCardContextOpen } from '../state/ui.ts'
import { canCreateAreaFromSelection, createAreaFromSelection, buryArea, tidyArea } from '../state/areas.ts'
import { burySelection } from '../state/actions.ts'
import { copySelection, duplicateSelection } from '../state/clipboard.ts'
import { pasteFromSystem } from '../canvas/paste.ts'
import { canMakeSyncedCopy, makeSyncedCopy } from '../state/synced.ts'
import { liveState, peers, pingAt } from '../state/realtime.ts'
import { LabelsPopover } from './Labels.tsx'
import { openThread } from './CommentsPanel.tsx'
import { Icon } from './icons.tsx'
import { installMenu } from './menu.ts'
import { MoveToBoardMenuItem } from './MoveBoardPicker.tsx'
import { SheetGrip } from './SheetGrip.tsx'

export type ContextPoint = Vec & { screenX: number; screenY: number; cardId: string | null; columnId?: string; returnTo: HTMLElement }

/** Card actions use the same selection commands as the floating bar. Empty
 * canvas gets Paste on a board you can edit, and a location ping when somebody's there. */
export function CardContextMenu(props: { point: ContextPoint; close: () => void }) {
  let menu!: HTMLDivElement
  const [labels, setLabels] = createSignal(false)
  const [at, setAt] = createSignal({ left: props.point.screenX, top: props.point.screenY })
  const item = () => doc.get(props.point.cardId ?? '')
  const card = () => doc.getCard(props.point.cardId ?? '')
  const cards = createMemo(() => [...selection()].map((id) => doc.getCard(id)).filter((c): c is Card => !!c))
  const sole = () => selection().size === 1 ? card() : undefined
  const writable = () => selection().size > 0 && [...selection()].every((id) => doc.canWriteObject(doc.get(id)))
  const canEdit = () => !!sole() && writable() && ['area', 'note', 'todo', 'column', 'image', 'swatch', 'board', 'link', 'movie', 'sketch', 'table'].includes(sole()!.type)
  const canLabel = () => writable() && cards().length > 0 && cards().every((c) => c.type !== 'column' && c.type !== 'area' && c.boardId === cards()[0].boardId)
  const canPing = () => liveState() === 'live' && peers().length > 0
  const canPaste = () => doc.canWriteObject(doc.getBoard(boardId()))
  const close = () => { props.close(); props.point.returnTo.focus({ preventScroll: true }) }
  const run = (action: () => void) => { close(); action() }
  createEffect(() => setCardContextOpen(!!item() && !labels()))
  onCleanup(() => setCardContextOpen(false))
  installMenu(() => !labels(), props.close, () => menu, () => props.point.returnTo)
  createEffect(() => {
    const c = item()
    if (props.point.cardId && (!c || c.deletedAt || c.purged)) close()
    if (!props.point.cardId && !canPing() && !canPaste()) close()
  })
  onMount(() => {
    setAt({ left: Math.max(8, Math.min(props.point.screenX, innerWidth - menu.offsetWidth - 8)), top: Math.max(8, Math.min(props.point.screenY, innerHeight - menu.offsetHeight - 8)) })
  })
  // Pastes land where the menu was opened, inside the column there if any.
  const paste = () => <button class="menu-item" role="menuitem" disabled={!canPaste()} aria-keyshortcuts="Meta+V" onClick={() => run(() => void pasteFromSystem(props.point, props.point.columnId))}><Icon name="paste" size={18} />Paste<kbd aria-hidden="true">⌘V</kbd></button>
  return (
    <Portal>
      <Show when={!labels()} fallback={<LabelsPopover cards={cards()} anchor={() => props.point.returnTo} close={close} />}>
        <div ref={menu} class="menu canvas-ping-menu" classList={{ 'card-context-menu': !!item() }} role="menu" aria-label={item() ? 'Card actions' : 'Canvas actions'} data-testid="canvas-context-menu" data-nodrag
          style={{ position: 'fixed', left: `${at().left}px`, top: `${at().top}px` }}
          onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <SheetGrip onDismiss={close} />
          <Show when={card()}>
            <button class="menu-item" role="menuitem" disabled={!canEdit()} onClick={() => run(() => beginEdit(card()!.id))}><Icon name="edit" size={18} />{card()?.type === 'board' ? 'Rename' : card()?.type === 'image' ? 'Caption' : 'Edit'}</button>
            <div class="menu-sep" role="separator" />
            <button class="menu-item" role="menuitem" disabled={!writable()} aria-keyshortcuts="Meta+X" onClick={() => run(() => copySelection(true))}><Icon name="cut" size={18} />Cut<kbd aria-hidden="true">⌘X</kbd></button>
            <button class="menu-item" role="menuitem" aria-keyshortcuts="Meta+C" onClick={() => run(() => copySelection(false))}><Icon name="copy" size={18} />Copy<kbd aria-hidden="true">⌘C</kbd></button>
            {paste()}
            <MoveToBoardMenuItem close={close} anchor={() => props.point.returnTo} />
            <button class="menu-item" role="menuitem" disabled={!writable()} aria-keyshortcuts="Meta+D" onClick={() => run(duplicateSelection)}><Icon name="duplicate" size={18} />Duplicate<kbd aria-hidden="true">⌘D</kbd></button>
            <div class="menu-sep" role="separator" />
            <Show when={canMakeSyncedCopy(sole())}>
              <button class="menu-item" role="menuitem" data-testid="make-synced-copy" onClick={() => run(() => makeSyncedCopy(card()!.id))}><Icon name="synced" size={18} />{COPY.synced.make}</button>
            </Show>
            <button class="menu-item" role="menuitem" disabled={!canLabel()} onClick={() => setLabels(true)}><Icon name="label" size={18} />Labels</button>
            <button class="menu-item" role="menuitem" disabled={!sole() || sole()?.type === 'board'} onClick={() => run(() => openThread(card()!.id))}><Icon name="comment" size={18} />Comment</button>
            <Show when={canCreateAreaFromSelection()}><button class="menu-item" role="menuitem" data-testid="area-from-selection" onClick={() => run(() => { createAreaFromSelection() })}><Icon name="board" size={18} />Create area from selection</button></Show>
            <Show when={sole()?.type === 'area'}><button class="menu-item" role="menuitem" onClick={() => run(() => tidyArea(sole()!.id))}><Icon name="tidy" size={18} />Tidy area</button><button class="menu-item" role="menuitem" onClick={() => run(() => buryArea(sole()!.id))}>Bury area and contents</button></Show>
            <div class="menu-sep" role="separator" />
            <button class="menu-item" role="menuitem" disabled={!writable()} onClick={() => run(burySelection)}><Icon name="bury" size={18} />{sole()?.type === 'area' ? 'Remove area (keep contents)' : COPY.bury}</button>
          </Show>
          <Show when={item()?.kind === 'sticker'}><MoveToBoardMenuItem close={close} anchor={() => props.point.returnTo} /><button class="menu-item" role="menuitem" onClick={() => run(burySelection)}><Icon name="bury" size={18} />{COPY.bury}</button></Show>
          <Show when={!item() && canPaste()}>{paste()}</Show>
          <Show when={canPing()}>
            <Show when={card() || canPaste()}><div class="menu-sep" role="separator" /></Show>
            <button class="menu-item" role="menuitem" onClick={() => run(() => pingAt(props.point))}><Icon name="lookHere" size={18} />{COPY.lookHere}</button>
          </Show>
        </div>
      </Show>
    </Portal>
  )
}
