import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { boardDisplayTitle, cardColorVars } from '@doggynote/theme'
import type { Id } from '@doggynote/core'
import { boardId, selection } from '../state/ui.ts'
import { touch } from '../state/device.ts'
import { moveBoardPath, moveDestinations, moveItemsToBoard, moveItemsToNewBoard, moveSelectionProblem } from '../state/boardMoves.ts'
import { Popover } from './Popover.tsx'
import { SheetGrip } from './SheetGrip.tsx'
import { BoardIconSvg, Icon } from './icons.tsx'
import './board-moves.css'

type Request = { ids: Id[]; source: Id; anchor: HTMLElement; keyboard: boolean }
const [request, setRequest] = createSignal<Request | null>(null)
export function openMoveBoardPicker(anchor: HTMLElement, keyboard = false, ids = [...selection()]) {
  setRequest({ ids, source: boardId(), anchor, keyboard })
}
export function MoveToBoardMenuItem(props: { close: () => void; anchor: () => HTMLElement }) {
  return <button class="menu-item" role="menuitem" data-testid="move-to-board" onClick={(e) => { const anchor = props.anchor(), ids = [...selection()]; props.close(); openMoveBoardPicker(anchor, e.detail === 0, ids) }}><Icon name="board" size={18} />Move to board…</button>
}
export function MoveBoardPickerHost() {
  createEffect(() => { const r = request(); if (r && r.source !== boardId()) setRequest(null) })
  onCleanup(() => setRequest(null))
  return <Show when={request()} keyed>{r => <MoveBoardPicker request={r} close={() => setRequest(null)} />}</Show>
}
function MoveBoardPicker(props: { request: Request; close: () => void }) {
  const [query, setQuery] = createSignal(''), [limit, setLimit] = createSignal(30)
  const [creating, setCreating] = createSignal(false), [name, setName] = createSignal(''), [error, setError] = createSignal('')
  let search!: HTMLInputElement, nameInput!: HTMLInputElement, list!: HTMLDivElement
  const matches = createMemo(() => moveDestinations(props.request.ids, query()))
  const visible = () => matches().slice(0, query().trim() ? limit() : 8)
  const problem = createMemo(() => moveSelectionProblem(props.request.ids))
  const close = () => {
    props.close()
    const anchor = props.request.anchor
    ;(anchor.isConnected ? anchor : document.querySelector<HTMLElement>('[data-testid="canvas"]'))?.focus({ preventScroll: true })
  }
  const finish = (result: ReturnType<typeof moveItemsToBoard>) => { if (result.ok) close(); else setError(result.reason) }
  const go = (id: Id) => finish(moveItemsToBoard(props.request.ids, id))
  const keys = (e: KeyboardEvent) => {
    const controls = [...list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const inSearch = e.target === search
    if (inSearch && !['ArrowDown', 'ArrowUp'].includes(e.key)) return
    e.preventDefault(); e.stopPropagation()
    const i = controls.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? controls.length - 1 : i < 0 ? (e.key === 'ArrowUp' ? controls.length - 1 : 0) : i + (e.key === 'ArrowUp' ? -1 : 1)
    if (next < 0) search.focus(); else controls[Math.min(next, controls.length - 1)]?.focus()
  }
  onMount(() => { if (!touch() || props.request.keyboard) search?.focus({ preventScroll: true }) })
  return <Popover anchor={() => props.request.anchor} label="Move to board" testid="move-board-picker" class={`menu move-board-picker${props.request.keyboard ? ' move-board-keyboard' : ''}`} close={close} autofocus={false}>
    <SheetGrip onDismiss={close} />
    <div class="nav-menu-head"><strong>Move to board</strong><button class="icon-btn" aria-label="Close move to board" onClick={close}><Icon name="close" size={16} /></button></div>
    <Show when={!creating()} fallback={
      <form class="move-board-create" onSubmit={e => { e.preventDefault(); if (name().trim()) finish(moveItemsToNewBoard(props.request.ids, name())) }}>
        <label for="move-board-name">Board name</label>
        <input ref={nameInput} id="move-board-name" class="labels-input" data-testid="move-board-name" value={name()} maxLength={200} onInput={e => { setName(e.currentTarget.value); setError('') }} autocomplete="off" enterkeyhint="done" />
        <div class="move-board-create-actions"><button class="bar-btn" type="button" onClick={() => { setCreating(false); setError(''); search?.focus() }}>Back</button><button class="primary-btn" type="submit" disabled={!name().trim() || !!problem()}>Create and move</button></div>
      </form>
    }>
      <label class="board-nav-search"><Icon size={16} name="search" /><input ref={search} type="search" data-testid="move-board-search" aria-label="Find a destination board" placeholder="Find a board…" autocomplete="off" value={query()} onInput={e => { setQuery(e.currentTarget.value); setLimit(30); setError('') }} onKeyDown={e => { keys(e); if (e.key === 'Enter' && visible()[0] && !problem()) { e.preventDefault(); go(visible()[0].id) } }} /></label>
      <div ref={list} class="move-board-results" onKeyDown={keys}>
        <For each={visible()} fallback={<p class="move-board-empty">{query().trim() ? 'No boards match your search.' : 'No other boards to move to yet.'}</p>}>{b =>
          <button class="menu-item move-board-result" data-testid="move-board-result" disabled={!!problem()} onClick={() => go(b.id)}>
            <span class="move-board-icon" style={{ color: cardColorVars(b.color, 'gold').text, background: cardColorVars(b.color, 'gold').bg }}><BoardIconSvg icon={b.icon} size={18} /></span>
            <span class="move-board-text"><span>{boardDisplayTitle(b, 'Untitled board')}</span><Show when={moveBoardPath(b)}><small>{moveBoardPath(b)}</small></Show></span>
          </button>
        }</For>
        <Show when={query().trim() && matches().length > limit()}><button class="menu-item" onClick={() => setLimit(n => n + 30)}>Show more ({matches().length - limit()})</button></Show>
      </div>
      <div class="menu-sep" />
      <button class="menu-item" data-testid="move-board-new" disabled={!!problem()} onClick={() => { setName(query().trim()); setCreating(true); setError(''); nameInput?.focus() }}><Icon name="plus" size={18} />New board…</button>
    </Show>
    <Show when={error() || problem()}><p class="move-board-error" role="alert">{error() || problem()}</p></Show>
  </Popover>
}
