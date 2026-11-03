import { SheetGrip } from './SheetGrip.tsx'
import { For, Show, createEffect, createSignal, createUniqueId, type Accessor, type JSX } from 'solid-js'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import { boardPermissions, homeBoardId, legacyShared } from '../state/access.ts'
import { user } from '../state/session.ts'
import { boardId, openBoard, recentBoards, setRenamingBoardId } from '../state/ui.ts'
import { phone } from '../state/device.ts'
import { canReadBoard } from '../state/access.ts'
import { sharedRoots } from '../state/sharedBoards.ts'
import * as doc from '../state/doc.ts'
import { BoardIconSvg, Icon } from './icons.tsx'
import './navigation.css'
import { installMenu } from './menu.ts'

const SHARED_PREVIEW = 5

/** Personal and shared roots are navigation, never synced fake board cards. */
export function BoardNavigation(props: { renderTrigger?: (state: { open: Accessor<boolean>; toggle: () => void; menuId: string; ref: (el: HTMLButtonElement) => void }) => JSX.Element } = {}) {
  const [open, setOpen] = createSignal(false)
  const menuId = createUniqueId()
  let root!: HTMLDivElement, trigger!: HTMLButtonElement
  installMenu(open, () => setOpen(false), () => root, () => trigger)
  const sharedTitle = (b: { id: string }) => boardDisplayTitle(doc.getBoard(b.id) ?? { id: b.id }, COPY.boards.sharedUntitled)
  const shared = () => sharedRoots(boardPermissions(), user()?.id, sharedTitle)
  // The newest few shares; the rest wait behind "Show all" until the menu next opens.
  const [showAll, setShowAll] = createSignal(false)
  const visibleShared = () => showAll() ? shared() : shared().slice(0, SHARED_PREVIEW)
  let sharedList!: HTMLElement
  const expandShared = () => {
    setShowAll(true)
    sharedList.querySelectorAll<HTMLButtonElement>('[data-testid="shared-board-link"]')[SHARED_PREVIEW]?.focus()
  }
  createEffect(() => { if (!open()) setShowAll(false) })
  function go(id: string) { openBoard(id); setOpen(false); trigger.focus() }
  const canRename = () => phone() && !boardId().startsWith('toybox:') && doc.canWriteObject(doc.getBoard(boardId()))
  const rename = () => {
    setOpen(false)
    setRenamingBoardId(boardId())
    // Remain in the tap so installed iOS can raise its keyboard.
    document.querySelector<HTMLInputElement>('[data-testid="board-name-input"]')?.focus({ preventScroll: true })
  }
  // The last few boards, one tap away (phones have no breadcrumbs to hop back with).
  const recent = () => recentBoards().filter((id) => id !== boardId() && !id.startsWith('toybox:') && doc.getBoard(id) && canReadBoard(id)).slice(0, 5)
  return <div class="zoom board-navigation" ref={root}>
    <Show when={props.renderTrigger} fallback={
    <button ref={trigger} class="icon-btn" data-testid="board-navigation" data-tooltip={COPY.boards.triggerHint} title={COPY.boards.triggerHint} aria-label={COPY.boards.triggerHint} aria-haspopup="dialog" aria-controls={open() ? menuId : undefined} aria-expanded={open()} onClick={() => setOpen(!open())}><BoardIconSvg icon="kennel" size={19} /><span class="icon-btn-label">{COPY.boards.trigger}</span><span class="boards-caret" aria-hidden="true"><Icon size={14} name="chevronDown" /></span></button>
    }>{(render) => render()({ open, toggle: () => setOpen(!open()), menuId, ref: (el) => { trigger = el } })}</Show>
    <Show when={open()}><div id={menuId} class="menu nav-menu board-nav-menu" role="dialog" aria-label={COPY.boards.heading} data-testid="board-navigation-menu"><SheetGrip onDismiss={() => { setOpen(false); trigger.focus() }} />
      <div class="nav-menu-head"><strong>{COPY.boards.heading}</strong><button class="icon-btn" aria-label={COPY.boards.close} onClick={() => { setOpen(false); trigger.focus() }}><Icon size={16} name="close" /></button></div>
      <div class="board-nav-scroll" data-testid="board-navigation-list">
        <Show when={canRename()}><button class="menu-item nav-menu-row" data-testid="rename-current-board" onClick={rename}><Icon name="edit" size={18} /><span class="nav-menu-label">{COPY.boards.rename}</span></button><div class="menu-sep" role="separator" /></Show>
        <Show when={recent().length}>
          <section class="nav-menu-recent" aria-labelledby={`${menuId}-recent-heading`}>
            <strong id={`${menuId}-recent-heading`} class="nav-menu-section-label">{COPY.boards.recent}</strong>
            <For each={recent()}>{(id) => <button class="menu-item nav-menu-row" data-testid="recent-board" onClick={() => go(id)}><BoardIconSvg icon={doc.getBoard(id)?.icon ?? 'paw'} size={18} /><span class="nav-menu-label">{boardDisplayTitle(doc.getBoard(id), id.startsWith('home') ? `My ${COPY.home}` : 'Untitled board')}</span></button>}</For>
          </section>
        </Show>
        <button class="menu-item nav-menu-row" data-testid="personal-home" onClick={() => go(homeBoardId())}><BoardIconSvg icon="kennel" size={18} /><span class="nav-menu-label">My {COPY.home}</span></button>
        <Show when={legacyShared()}><div class="nav-menu-group"><button class="menu-item nav-menu-row" data-testid="legacy-space" aria-describedby={`${menuId}-legacy-description`} onClick={() => go('home')}><BoardIconSvg icon="paw" size={18} /><span class="nav-menu-label">{COPY.boards.legacy}</span></button><p id={`${menuId}-legacy-description`} class="nav-menu-description">{COPY.boards.legacyHint}</p></div></Show>
        <section ref={sharedList} class="nav-menu-section" aria-labelledby={`${menuId}-shared-heading`}>
          <strong id={`${menuId}-shared-heading`} class="nav-menu-section-label">{COPY.boards.shared}</strong>
          <Show when={shared().length} fallback={<p class="nav-menu-description">{COPY.boards.sharedEmpty}</p>}>
            <For each={visibleShared()}>{(b) => <button class="menu-item nav-menu-row" data-testid="shared-board-link" onClick={() => go(b.id)}><BoardIconSvg icon={doc.getBoard(b.id)?.icon ?? 'paw'} size={18} /><span class="nav-menu-label">{sharedTitle(b)}</span><Show when={b.sharedBy || !b.canEdit}><small class="nav-menu-meta"><Show when={b.sharedBy}><span class="nav-menu-who" title={b.sharedBy ?? undefined}>{b.sharedBy}</span></Show>{b.sharedBy && !b.canEdit ? ' · ' : ''}{b.canEdit ? '' : COPY.boards.viewOnly}</small></Show></button>}</For>
            <Show when={!showAll() && shared().length > SHARED_PREVIEW}><button class="menu-item nav-menu-row nav-menu-more" data-testid="shared-show-all" onClick={expandShared}><Icon size={18} name="chevronDown" /><span class="nav-menu-label">{COPY.boards.showAll} ({shared().length})</span></button></Show>
          </Show>
        </section>
      </div>
    </div></Show>
  </div>
}
