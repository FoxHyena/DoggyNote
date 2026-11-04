import { SheetGrip } from './SheetGrip.tsx'
import { For, Show, createEffect, createSignal, createUniqueId, type Accessor, type JSX } from 'solid-js'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import { boardPermissions, homeBoardId, legacyShared } from '../state/access.ts'
import { user } from '../state/session.ts'
import { boardId, openBoard, setRenamingBoardId } from '../state/ui.ts'
import { phone, touch } from '../state/device.ts'
import { type BoardPermission } from '../state/access.ts'
import { sharedRoots } from '../state/sharedBoards.ts'
import { isFavourite, setFavourite } from '../state/boardPrefs.ts'
import { boardTitle, favouriteBoards, reachable, recentBoardIds, searchBoards } from '../state/boardShortcuts.ts'
import { FavouriteButton } from './FavouriteButton.tsx'
import { Avatar } from './Avatar.tsx'
import * as doc from '../state/doc.ts'
import { BoardIconSvg, Icon } from './icons.tsx'
import './navigation.css'
import './collaboration.css'
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
  // Find a board: typing swaps the lists for matching titles. Focused on open with a keyboard only,
  // so a tap on a phone doesn't raise the keyboard over the lists.
  const [query, setQuery] = createSignal('')
  const matches = () => searchBoards(query(), 30)
  let search: HTMLInputElement | undefined, list: HTMLDivElement | undefined
  createEffect(() => {
    if (!open()) { setShowAll(false); setQuery(''); return }
    // After installMenu's own first focus, which is queued first.
    if (!touch()) queueMicrotask(() => search?.focus())
  })
  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); list?.querySelector<HTMLButtonElement>('button')?.focus() }
    else if (e.key === 'Enter' && query().trim()) { e.preventDefault(); const first = matches()[0]; if (first) go(first.id) }
  }
  // The avatar only shows initials, so the row's name says who shared it and whether it's view only.
  const sharedLabel = (b: BoardPermission) => [sharedTitle(b), b.sharedBy && `${COPY.boards.sharedBy} ${b.sharedBy}`, !b.canEdit && COPY.boards.viewOnly].filter(Boolean).join(', ')
  function go(id: string) { openBoard(id); setOpen(false); trigger.focus() }
  const canRename = () => phone() && !boardId().startsWith('toybox:') && doc.canWriteObject(doc.getBoard(boardId()))
  const rename = () => {
    setOpen(false)
    setRenamingBoardId(boardId())
    // Remain in the tap so installed iOS can raise its keyboard.
    document.querySelector<HTMLInputElement>('[data-testid="board-name-input"]')?.focus({ preventScroll: true })
  }
  const rowTitle = boardTitle
  // Starred boards, in star order; stars from your other devices arrive when you come back to the app.
  const favourites = favouriteBoards
  // The last few boards you opened on any device, one tap away. Favourites already have their own place.
  const recent = () => recentBoardIds(5)
  const canFavourite = () => phone() && reachable(boardId())
  let favouriteList: HTMLElement | undefined
  /** Unstarring removes the row; keep focus in the menu on the next starred board, or My Doghouse. */
  const keepFocus = (index: number) => setTimeout(() => {
    // After the row has gone: a microtask can still find (and focus) the row on its way out.
    const rows = favouriteList?.isConnected ? [...favouriteList.querySelectorAll<HTMLButtonElement>('[data-testid="favourite-board-link"]')] : []
    ;(rows[Math.min(index, rows.length - 1)] ?? root.querySelector<HTMLButtonElement>('[data-testid="personal-home"]'))?.focus()
  })
  return <div class="zoom board-navigation" ref={root}>
    <Show when={props.renderTrigger} fallback={
    <button ref={trigger} class="icon-btn" data-testid="board-navigation" data-tooltip={COPY.boards.triggerHint} title={COPY.boards.triggerHint} aria-label={COPY.boards.triggerHint} aria-haspopup="dialog" aria-controls={open() ? menuId : undefined} aria-expanded={open()} onClick={() => setOpen(!open())}><BoardIconSvg icon="kennel" size={19} /><span class="icon-btn-label">{COPY.boards.trigger}</span><span class="boards-caret" aria-hidden="true"><Icon size={14} name="chevronDown" /></span></button>
    }>{(render) => render()({ open, toggle: () => setOpen(!open()), menuId, ref: (el) => { trigger = el } })}</Show>
    <Show when={open()}><div id={menuId} class="menu nav-menu board-nav-menu" role="dialog" aria-label={COPY.boards.heading} data-testid="board-navigation-menu"><SheetGrip onDismiss={() => { setOpen(false); trigger.focus() }} />
      <div class="nav-menu-head"><strong>{COPY.boards.heading}</strong><button class="icon-btn" aria-label={COPY.boards.close} onClick={() => { setOpen(false); trigger.focus() }}><Icon size={16} name="close" /></button></div>
      <label class="board-nav-search"><Icon size={16} name="search" /><input ref={search} type="search" data-testid="board-search" aria-label={COPY.boards.find} placeholder={COPY.boards.findPlaceholder} autocomplete="off" enterkeyhint="go" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} onKeyDown={onSearchKey} /></label>
      <div ref={list} class="board-nav-scroll" data-testid="board-navigation-list">
        <Show when={!query().trim()} fallback={
          <div role="group" aria-label={COPY.boards.findResults}>
            <For each={matches()} fallback={<p class="nav-menu-description board-nav-no-match">{COPY.boards.noMatch}</p>}>{(m) => <button class="menu-item nav-menu-row" data-testid="board-search-result" onClick={() => go(m.id)}><BoardIconSvg icon={doc.getBoard(m.id)?.icon ?? 'paw'} size={18} /><span class="nav-menu-label">{m.title}</span><Show when={m.parent}><small class="nav-menu-meta board-nav-parent">{COPY.boards.inParent} {m.parent}</small></Show></button>}</For>
          </div>
        }>
        <Show when={canRename() || canFavourite()}>
          <Show when={canRename()}><button class="menu-item nav-menu-row" data-testid="rename-current-board" onClick={rename}><Icon name="edit" size={18} /><span class="nav-menu-label">{COPY.boards.rename}</span></button></Show>
          <Show when={canFavourite()}><button class="menu-item nav-menu-row" data-testid="favourite-current-board" aria-pressed={isFavourite(boardId())} onClick={() => setFavourite(boardId(), !isFavourite(boardId()))}><Icon name={isFavourite(boardId()) ? 'starFilled' : 'star'} size={18} class={isFavourite(boardId()) ? 'favourite-on' : undefined} /><span class="nav-menu-label">{isFavourite(boardId()) ? COPY.boards.unfavourite : COPY.boards.favourite}</span></button></Show>
          <div class="menu-sep" role="separator" />
        </Show>
        <button class="menu-item nav-menu-row" data-testid="personal-home" onClick={() => go(homeBoardId())}><BoardIconSvg icon="kennel" size={18} /><span class="nav-menu-label">My {COPY.home}</span></button>
        <Show when={legacyShared()}><div class="nav-menu-group"><button class="menu-item nav-menu-row" data-testid="legacy-space" aria-describedby={`${menuId}-legacy-description`} onClick={() => go('home')}><BoardIconSvg icon="paw" size={18} /><span class="nav-menu-label">{COPY.boards.legacy}</span></button><p id={`${menuId}-legacy-description`} class="nav-menu-description">{COPY.boards.legacyHint}</p></div></Show>
        <div class="menu-sep" role="separator" />
        <Show when={favourites().length}>
          <section ref={favouriteList} class="nav-menu-favourites" aria-labelledby={`${menuId}-favourites-heading`}>
            <strong id={`${menuId}-favourites-heading`} class="nav-menu-section-label">{COPY.boards.favourites}</strong>
            <For each={favourites()}>{(id, i) => <div class="nav-menu-starred">
              <button class="menu-item nav-menu-row" data-testid="favourite-board-link" onClick={() => go(id)}><BoardIconSvg icon={doc.getBoard(id)?.icon ?? 'paw'} size={18} /><span class="nav-menu-label">{rowTitle(id)}</span></button>
              <FavouriteButton boardId={id} class="nav-menu-star" onChange={() => keepFocus(i())} />
            </div>}</For>
          </section>
        </Show>
        <Show when={recent().length}>
          <section class="nav-menu-recent" aria-labelledby={`${menuId}-recent-heading`}>
            <strong id={`${menuId}-recent-heading`} class="nav-menu-section-label">{COPY.boards.recent}</strong>
            <For each={recent()}>{(id) => <button class="menu-item nav-menu-row" data-testid="recent-board" onClick={() => go(id)}><BoardIconSvg icon={doc.getBoard(id)?.icon ?? 'paw'} size={18} /><span class="nav-menu-label">{rowTitle(id)}</span></button>}</For>
          </section>
        </Show>
        <section ref={sharedList} class="nav-menu-section" aria-labelledby={`${menuId}-shared-heading`}>
          <strong id={`${menuId}-shared-heading`} class="nav-menu-section-label">{COPY.boards.shared}</strong>
          <Show when={shared().length} fallback={<p class="nav-menu-description">{COPY.boards.sharedEmpty}</p>}>
            <For each={visibleShared()}>{(b) => <button class="menu-item nav-menu-row" data-testid="shared-board-link" aria-label={sharedLabel(b)} onClick={() => go(b.id)}><BoardIconSvg icon={doc.getBoard(b.id)?.icon ?? 'paw'} size={18} /><span class="nav-menu-label">{sharedTitle(b)}</span><Show when={b.sharedBy || !b.canEdit}><span class="nav-menu-meta"><Show when={!b.canEdit}><small>{COPY.boards.viewOnly}</small></Show><Show when={b.sharedBy}>{(name) => <Avatar userId={b.sharedById ?? name()} name={name()} avatarId={b.sharedByAvatarId} class="nav-menu-avatar" testid="shared-by" title={`${COPY.boards.sharedBy} ${name()}`} />}</Show></span></Show></button>}</For>
            <Show when={!showAll() && shared().length > SHARED_PREVIEW}><button class="menu-item nav-menu-row nav-menu-more" data-testid="shared-show-all" onClick={expandShared}><span aria-hidden="true" /><span class="nav-menu-label">{COPY.boards.showAll} ({shared().length})</span></button></Show>
          </Show>
        </section>
        </Show>
      </div>
    </div></Show>
  </div>
}
