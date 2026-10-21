import { suggestions, openStickers, stickerTrayOpen } from '../state/stickers.ts'
import './canvas-entry.css'
import { For, Show, createSignal, type JSX } from 'solid-js'
import { DEFAULT_SIZE, findFreeSpot, screenToWorld, type CardType, type Vec } from '@doggynote/core'
import { cardHeight } from '../canvas/layout.ts'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { appendOrder, createCard, type Placement } from '../state/actions.ts'
import { boardId, camera, connectMode, setConnectMode, setTrashOpen, trashOpen, viewport } from '../state/ui.ts'
import { addAnyFiles, addImages } from '../canvas/paste.ts'
import { Icon, ToolIcons } from './icons.tsx'

export type Tool = { id: CardType | 'line'; label: string; icon: () => JSX.Element }

export const TOOLS: Tool[] = [
  { id: 'note', label: 'Note', icon: ToolIcons.note },
  { id: 'link', label: 'Link', icon: ToolIcons.link },
  { id: 'todo', label: 'To-do', icon: ToolIcons.todo },
  { id: 'line', label: 'Line', icon: ToolIcons.line },
  { id: 'board', label: 'Board', icon: ToolIcons.board },
  { id: 'column', label: 'Column', icon: ToolIcons.column },
]

/** A click on a tool drops the card near the viewport centre, in free space. */
export function centrePlacement(type: CardType = 'note'): Placement {
  const v = viewport()
  const c = screenToWorld(camera(), { x: v.width / 2, y: v.height / 2.6 })
  const size = DEFAULT_SIZE[type]
  const taken = doc.cardsOn(boardId()).filter((k) => !k.columnId).map((k) => ({ x: k.x, y: k.y, w: k.w, h: cardHeight(k) }))
  const spot = findFreeSpot({ x: c.x - size.w / 2, y: c.y - 20, w: size.w, h: size.h }, taken)
  return { at: { x: spot.x + size.w / 2, y: spot.y + 20 } }
}

/** Where a drop at a screen point lands: a column slot if over a column, else a world point. Null off-canvas. */
export function placementAt(clientX: number, clientY: number): Placement | null {
  const v = viewport()
  if (clientX < v.left || clientY < v.top || clientX > v.left + v.width || clientY > v.top + v.height) return null
  const col = (document.elementFromPoint(clientX, clientY)?.closest('.card-column') as HTMLElement | null)?.dataset.cardId
  if (col) return { columnId: col, order: appendOrder(col) }
  return { at: screenToWorld(camera(), { x: clientX - v.left, y: clientY - v.top }) }
}

export function Toolbar() {
  let fileInput!: HTMLInputElement
  let uploadInput!: HTMLInputElement
  const [ghost, setGhost] = createSignal<{ tool: Tool; at: Vec } | null>(null)

  function onToolPointerDown(e: PointerEvent, tool: Tool) {
    if (e.button !== 0) return
    const start = { x: e.clientX, y: e.clientY }
    let dragging = false
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6 && tool.id !== 'line') dragging = true
      if (dragging) setGhost({ tool, at: { x: ev.clientX, y: ev.clientY } })
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setGhost(null)
      if (tool.id === 'line') {
        setConnectMode(connectMode() ? null : { from: null })
        return
      }
      const place = dragging ? placementAt(ev.clientX, ev.clientY) : centrePlacement(tool.id as CardType)
      if (!place) return
      // Columns can't nest.
      if (tool.id === 'column' && 'columnId' in place) return
      createCard(tool.id, place)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <aside class="toolbar" aria-label="Tools" onKeyDown={(e) => { if (!e.metaKey && !e.ctrlKey && ['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) { e.stopPropagation(); if (e.key === 'Backspace') e.preventDefault() } }}>
      <For each={TOOLS}>
        {(t) => (
          <button
            class="tool"
            classList={{ active: t.id === 'line' && !!connectMode() }}
            data-testid={`tool-${t.id}`}
            aria-label={t.label}
            onClick={(e) => {
              if (e.detail !== 0) return
              if (t.id === 'line') setConnectMode(connectMode() ? null : { from: null })
              else createCard(t.id, centrePlacement(t.id))
            }}
            title={t.id === 'line' ? 'Line: click two cards to connect them' : `${t.label}: click to add, or drag onto the board`}
            onPointerDown={(e) => onToolPointerDown(e, t)}
          >
            <Icon size={22}>{t.icon()}</Icon>
            <span>{t.label}</span>
          </button>
        )}
      </For>
      <button class="tool" data-testid="tool-stickers" aria-label="Stickers" aria-expanded={stickerTrayOpen()} aria-description={suggestions.length ? suggestions.length === 1 ? 'Pack found in Telegram' : `${suggestions.length} packs found in Telegram` : undefined} title={suggestions.length ? suggestions.length === 1 ? 'Pack found in Telegram' : `${suggestions.length} packs found in Telegram` : undefined} onClick={openStickers}><Icon size={22}><path d="M4 4h16v10l-6 6H4Z M14 20v-6h6 M8 9h.01 M15 9h.01 M8 12q4 5 8 0" /></Icon><span>Stickers</span><Show when={suggestions.length}><span class="sticker-found-dot" data-testid="sticker-found-badge" aria-hidden="true" /></Show></button>
      <div class="toolbar-sep" />
      <button class="tool" data-testid="tool-image" title="Add image" onClick={() => fileInput.click()}>
        <Icon size={22}>{ToolIcons.image()}</Icon>
        <span>Image</span>
      </button>
      <button class="tool" data-testid="tool-upload" title="Upload files (PDFs, docs, anything up to 50 MB)" onClick={() => uploadInput.click()}>
        <Icon size={22}>{ToolIcons.upload()}</Icon>
        <span>Upload</span>
      </button>
      <input
        ref={uploadInput}
        type="file"
        multiple
        hidden
        data-testid="upload-input"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])]
          e.currentTarget.value = ''
          const p = centrePlacement('file')
          if ('at' in p) addAnyFiles(files, p.at)
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="image-input"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])]
          e.currentTarget.value = ''
          const p = centrePlacement('image')
          if ('at' in p) void addImages(files, p.at)
        }}
      />
      <div class="toolbar-spacer" />
      <button class="tool" classList={{ active: trashOpen() }} data-testid="tool-trash" title={COPY.trash} onClick={() => setTrashOpen(!trashOpen())}>
        <Icon size={22}>{ToolIcons.trash()}</Icon>
        <span>{COPY.trash}</span>
      </button>
      <Show when={ghost()}>
        <div class="tool-ghost" style={{ left: `${ghost()!.at.x}px`, top: `${ghost()!.at.y}px` }}>
          <Icon size={22}>{ghost()!.tool.icon()}</Icon>
          {ghost()!.tool.label}
        </div>
      </Show>
    </aside>
  )
}
