import { For, Show, createSignal } from 'solid-js'
import { Portal } from 'solid-js/web'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import type { Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { phone } from '../state/device.ts'
import { copiesOf, goToCopy, makeIndependent } from '../state/synced.ts'
import { Icon } from './icons.tsx'
import { installMenu } from './menu.ts'
import { SheetGrip } from './SheetGrip.tsx'
import './synced.css'

/**
 * The marker on a synced note. It is also the "Synced copies" dropdown: where
 * every copy lives, a way to go to each one, and a way to unsync this one.
 * Only rendered when the note has another copy this device can see.
 */
export function SyncedMarker(props: { card: Card }) {
  const [open, setOpen] = createSignal(false)
  const [at, setAt] = createSignal({ left: 0, top: 0 })
  let menu!: HTMLDivElement
  let trigger!: HTMLButtonElement
  let wasOpen = false
  const close = () => setOpen(false)
  installMenu(open, close, () => menu, () => trigger)
  const copies = () => copiesOf(props.card.id)
  const writable = () => doc.canWriteObject(props.card)
  const toggle = () => {
    if (wasOpen) return close()
    const r = trigger.getBoundingClientRect(), width = 260
    // Beside the chip, off the card, when there's room; otherwise below it.
    const side = r.left - 6 - width >= 8
    const below = r.bottom + 6 + 180 < window.innerHeight
    setAt(side ? { left: r.left - 6 - width, top: Math.max(8, r.top) } : { left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: below ? r.bottom + 6 : r.top - 6 })
    setOpen(true)
    queueMicrotask(() => {
      if (!menu) return
      if (side) setAt((a) => ({ ...a, top: Math.max(8, Math.min(a.top, window.innerHeight - menu.offsetHeight - 8)) }))
      else if (!below) setAt((a) => ({ ...a, top: r.top - 6 - menu.offsetHeight }))
    })
  }
  const run = (action: () => void) => { close(); action() }
  return (
    <>
      <button
        ref={trigger}
        class="synced-marker"
        data-testid="synced-marker"
        data-nodrag
        aria-label={COPY.synced.marker}
        aria-haspopup="menu"
        aria-expanded={open()}
        data-tip={COPY.synced.markerHint}
        onPointerDown={(e) => { e.stopPropagation(); wasOpen = open() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') wasOpen = open() }}
        onClick={(e) => { e.stopPropagation(); toggle() }}
        onDblClick={(e) => e.stopPropagation()}
      >
        <Icon name="synced" size={13} />
      </button>
      <Show when={open()}>
        <Portal>
          <div ref={menu} class="menu bar-menu synced-menu" role="menu" aria-label={COPY.synced.marker} data-testid="synced-menu" style={{ left: `${at().left}px`, top: `${at().top}px` }} onPointerDown={(e) => e.stopPropagation()}>
            <SheetGrip onDismiss={() => { close(); trigger.focus() }} />
            <div class="nav-menu-head synced-menu-head">
              <strong>{COPY.synced.marker}</strong>
              <Show when={phone()}><button class="bar-btn" role="menuitem" aria-label={COPY.synced.close} onClick={() => { close(); trigger.focus() }}>Done</button></Show>
            </div>
            <For each={copies()}>
              {(c) => {
                const here = () => c.id === props.card.id
                const title = () => boardDisplayTitle(doc.getBoard(c.boardId), 'Untitled board')
                const sameBoard = () => !here() && c.boardId === props.card.boardId
                return (
                  <Show when={!here()} fallback={
                    <div class="menu-item synced-copy synced-here" role="menuitem" aria-disabled="true" aria-current="true" data-testid="synced-copy" data-copy-id={c.id} aria-label={`${COPY.synced.here}, on ${title()}`}>
                      <Icon name="board" size={16} />
                      <span class="synced-copy-board">{title()}</span>
                      <span class="synced-copy-action">{COPY.synced.here}</span>
                    </div>
                  }>
                    <button class="menu-item synced-copy" role="menuitem" data-testid="synced-copy" data-copy-id={c.id} aria-label={`${COPY.synced.goTo} ${title()}${sameBoard() ? `, ${COPY.synced.sameBoard}` : ''}`} onClick={() => run(() => goToCopy(c.id))}>
                      <Icon name="board" size={16} />
                      <span class="synced-copy-board">{title()}<Show when={sameBoard()}><span class="synced-copy-note"> · {COPY.synced.sameBoard}</span></Show></span>
                      <span class="synced-copy-action">{COPY.synced.goTo}</span>
                    </button>
                  </Show>
                )
              }}
            </For>
            <Show when={writable()}>
              <div class="menu-sep" role="separator" />
              <button class="menu-item" role="menuitem" data-testid="make-independent" data-tip={COPY.synced.independentHint} onClick={() => run(() => makeIndependent(props.card.id))}>
                <Icon name="unsync" size={16} />{COPY.synced.independent}
              </button>
            </Show>
          </div>
        </Portal>
      </Show>
    </>
  )
}
