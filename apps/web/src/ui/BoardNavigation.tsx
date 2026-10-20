import { For, Show, createSignal, createUniqueId } from 'solid-js'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import { boardPermissions, homeBoardId, legacyShared } from '../state/access.ts'
import { user } from '../state/session.ts'
import { openBoard } from '../state/ui.ts'
import * as doc from '../state/doc.ts'
import { BoardIconSvg, Icon, ToolIcons } from './icons.tsx'
import './navigation.css'
import { installMenu } from './menu.ts'

/** Personal and shared roots are navigation, never synced fake board cards. */
export function BoardNavigation() {
  const [open, setOpen] = createSignal(false)
  const menuId = createUniqueId()
  let root!: HTMLDivElement, trigger!: HTMLButtonElement
  installMenu(open, () => setOpen(false), () => root, () => trigger)
  const shared = () => boardPermissions().filter((b) => b.ownerId !== user()?.id && !b.legacy && !b.id.startsWith('toybox:') && !b.id.startsWith('home:') && (!b.parentId || !boardPermissions().some((p) => p.id === b.parentId && p.ownerId !== user()?.id && !p.legacy)))
  function go(id: string) { openBoard(id); setOpen(false); trigger.focus() }
  return <div class="zoom board-navigation" ref={root}>
    <button ref={trigger} class="icon-btn" data-testid="board-navigation" data-tooltip="My boards and shared boards" title="My boards and shared boards" aria-label="My boards and shared boards" aria-haspopup="dialog" aria-controls={open() ? menuId : undefined} aria-expanded={open()} onClick={() => setOpen(!open())}><BoardIconSvg icon="kennel" size={19} /><span class="icon-btn-label">Boards</span><span class="boards-caret" aria-hidden="true">⌄</span></button>
    <Show when={open()}><div id={menuId} class="menu nav-menu board-nav-menu" role="dialog" aria-label="Your spaces" data-testid="board-navigation-menu">
      <div class="nav-menu-head"><strong>Your spaces</strong><button class="icon-btn" aria-label="Close boards" onClick={() => { setOpen(false); trigger.focus() }}><Icon size={16}>{ToolIcons.close()}</Icon></button></div>
      <div class="board-nav-scroll" data-testid="board-navigation-list">
        <button class="menu-item nav-menu-row" data-testid="personal-home" onClick={() => go(homeBoardId())}><BoardIconSvg icon="kennel" size={18} /><span class="nav-menu-label">My {COPY.home}</span></button>
        <Show when={legacyShared()}><div class="nav-menu-group"><button class="menu-item nav-menu-row" data-testid="legacy-space" aria-describedby={`${menuId}-legacy-description`} onClick={() => go('home')}><BoardIconSvg icon="paw" size={18} /><span class="nav-menu-label">Shared space</span></button><p id={`${menuId}-legacy-description`} class="nav-menu-description">Existing workspace boards, shared with the original members.</p></div></Show>
        <section class="nav-menu-section" aria-labelledby={`${menuId}-shared-heading`}>
          <strong id={`${menuId}-shared-heading`} class="nav-menu-section-label">Shared with me</strong>
          <Show when={shared().length} fallback={<p class="nav-menu-description">Boards shared with your account will appear here.</p>}><For each={shared()}>{(b) => <button class="menu-item nav-menu-row" data-testid="shared-board-link" onClick={() => go(b.id)}><BoardIconSvg icon={doc.getBoard(b.id)?.icon ?? 'paw'} size={18} /><span class="nav-menu-label">{boardDisplayTitle(doc.getBoard(b.id) ?? { id: b.id }, 'Shared board')}</span><small class="nav-menu-meta">{b.canEdit ? 'Can edit' : 'View only'}</small></button>}</For></Show>
        </section>
      </div>
    </div></Show>
  </div>
}
