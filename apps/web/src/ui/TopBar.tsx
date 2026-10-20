import './navigation.css'
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { HOME_BOARD_ID, type Board, type Id } from '@doggynote/core'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { boardId, openBoard } from '../state/ui.ts'
import { installMenu } from './menu.ts'
import { phone, touch } from '../state/device.ts'

export function breadcrumbs(id: Id, root: Id = HOME_BOARD_ID): Board[] {
  const out: Board[] = []
  const seen = new Set<Id>()
  let cur = doc.getBoard(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    if (cur.id === root) break
    cur = cur.parentId ? doc.getBoard(cur.parentId) : undefined
  }
  return out
}

const titleOf = (b: Board) => boardDisplayTitle(b, b.id === HOME_BOARD_ID ? COPY.home : 'Untitled board')

export function TopBar(props: { readOnly: boolean; root?: Id; left?: JSX.Element; status?: JSX.Element; permission?: JSX.Element; right?: JSX.Element }) {
  const crumbs = createMemo(() => breadcrumbs(boardId(), props.root))
  const current = () => doc.getBoard(boardId())
  const [renaming, setRenaming] = createSignal(false)
  const [ancestorsOpen, setAncestorsOpen] = createSignal(false)
  let ancestorRoot!: HTMLDivElement, ancestorTrigger!: HTMLButtonElement
  installMenu(ancestorsOpen, () => setAncestorsOpen(false), () => ancestorRoot, () => ancestorTrigger)

  // On a phone the chevron is Back: a tap goes up one level, a long-press lists every parent.
  const backMode = () => phone() && touch()
  let hold: ReturnType<typeof setTimeout> | undefined
  let held = false
  const startHold = (e: PointerEvent) => {
    if (!backMode() || e.pointerType !== 'touch') return
    held = false
    hold = setTimeout(() => {
      held = true
      setAncestorsOpen(true)
    }, 450)
  }
  const endHold = () => clearTimeout(hold)
  const onParent = () => {
    if (held) return void (held = false)
    const up = crumbs().at(-2)
    if (backMode() && up) return openBoard(up.id)
    setAncestorsOpen(!ancestorsOpen())
  }

  function rename(value: string) {
    setRenaming(false)
    const b = current()
    const title = value.trim()
    if (b && title && title !== b.title) doc.update({ [b.id]: { title } })
  }

  return (
    <header class="topbar" data-tauri-drag-region>
      <div class="topbar-left">{props.left}<div class="board-heading">
      <nav class="crumbs" classList={{ 'deep-crumbs': crumbs().length > 2 }} aria-label="Breadcrumbs" data-testid="breadcrumbs">
        <Show when={crumbs().length > 1}><div class="ancestor-menu zoom" ref={ancestorRoot}>
          <button ref={ancestorTrigger} class="crumb" aria-label="Parent boards" data-testid="parent-boards" aria-expanded={ancestorsOpen()} onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold} onClick={onParent}><span class="parent-dots">…</span><svg class="parent-back" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          <Show when={ancestorsOpen()}><div class="menu nav-menu" aria-label="Parent boards"><For each={crumbs().slice(0,-1)}>{(b) => <button class="menu-item" onClick={() => { openBoard(b.id); setAncestorsOpen(false); queueMicrotask(() => (ancestorTrigger.isConnected ? ancestorTrigger : document.querySelector<HTMLButtonElement>('[data-testid=board-name]'))?.focus()) }}>{titleOf(b)}</button>}</For></div></Show>
        </div><span class="crumb-sep ancestor-menu">/</span></Show>
        <div class="ancestor-crumbs"><For each={crumbs().slice(0, -1)}>
          {(b) => (
            <>
              <button class="crumb" data-testid="crumb" onClick={() => openBoard(b.id)}>
                {titleOf(b)}
              </button>
              <span class="crumb-sep">/</span>
            </>
          )}
        </For></div>
        <Show when={current()}>
          <Show
            when={renaming()}
            fallback={
              <button
                class="crumb current"
                data-testid="board-name"
                title={props.readOnly || current()!.id.startsWith('toybox:') ? undefined : 'Rename board'}
                onClick={() => !props.readOnly && !current()!.id.startsWith('toybox:') && setRenaming(true)}
              >
                {titleOf(current()!)}
              </button>
            }
          >
            <input
              class="crumb-input"
              data-testid="board-name-input"
              value={current()!.title}
              ref={(el) => queueMicrotask(() => el.select())}
              onBlur={(e) => rename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          </Show>
        </Show>
      </nav>{props.status}{props.permission}</div></div>
      <div class="topbar-right">
        {props.right}
      </div>
    </header>
  )
}
