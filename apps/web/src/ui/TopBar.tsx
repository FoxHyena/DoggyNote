import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { HOME_BOARD_ID, type Board, type Id } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { boardId, camera, openBoard } from '../state/ui.ts'
import { zoomBy, zoomTo, zoomToFit } from '../canvas/Canvas.tsx'
import { Icon, ToolIcons } from './icons.tsx'

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

const titleOf = (b: Board) => (b.id === HOME_BOARD_ID ? b.title || COPY.home : b.title || 'Untitled board')

export function TopBar(props: { readOnly: boolean; root?: Id; right?: JSX.Element }) {
  const crumbs = createMemo(() => breadcrumbs(boardId(), props.root))
  const current = () => doc.getBoard(boardId())
  const [renaming, setRenaming] = createSignal(false)

  function rename(value: string) {
    setRenaming(false)
    const b = current()
    const title = value.trim()
    if (b && title && title !== b.title) doc.update({ [b.id]: { title } })
  }

  return (
    <header class="topbar" data-tauri-drag-region>
      <nav class="crumbs" aria-label="Breadcrumbs" data-testid="breadcrumbs">
        <For each={crumbs().slice(0, -1)}>
          {(b) => (
            <>
              <button class="crumb" data-testid="crumb" onClick={() => openBoard(b.id)}>
                {titleOf(b)}
              </button>
              <span class="crumb-sep">/</span>
            </>
          )}
        </For>
        <Show when={current()}>
          <Show
            when={renaming()}
            fallback={
              <button
                class="crumb current"
                data-testid="board-name"
                title={props.readOnly ? undefined : 'Rename board'}
                onClick={() => !props.readOnly && setRenaming(true)}
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
      </nav>
      <div class="topbar-right">
        <Show when={!props.readOnly}>
          <button class="icon-btn" data-testid="undo" title="Undo (⌘Z)" disabled={!doc.canUndo()} onClick={() => doc.undo()}>
            <Icon>{ToolIcons.undo()}</Icon>
          </button>
          <button class="icon-btn" data-testid="redo" title="Redo (⇧⌘Z)" disabled={!doc.canRedo()} onClick={() => doc.redo()}>
            <Icon>{ToolIcons.redo()}</Icon>
          </button>
        </Show>
        <ZoomControl />
        {props.right}
      </div>
    </header>
  )
}

function ZoomControl() {
  const [open, setOpen] = createSignal(false)
  const pct = () => `${Math.round(camera().zoom * 100)}%`
  const item = (label: string, kbd: string, fn: () => void) => (
    <button
      class="menu-item"
      onClick={() => {
        fn()
        setOpen(false)
      }}
    >
      <span>{label}</span>
      <kbd>{kbd}</kbd>
    </button>
  )
  return (
    <div class="zoom">
      <button class="icon-btn" data-testid="zoom" onClick={() => setOpen(!open())} aria-expanded={open()}>
        {pct()}
      </button>
      <Show when={open()}>
        <div class="menu" onPointerLeave={() => setOpen(false)}>
          {item('Zoom in', '⌘=', () => zoomBy(1.25))}
          {item('Zoom out', '⌘−', () => zoomBy(0.8))}
          {item('Zoom to 100%', '⌘0', () => zoomTo(1))}
          {item('Zoom to fit', '⌘1', zoomToFit)}
        </div>
      </Show>
    </div>
  )
}
