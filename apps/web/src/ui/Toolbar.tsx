import { suggestions, openStickers, stickerTrayOpen } from '../state/stickers.ts'
import './canvas-entry.css'
import { For, Show, createSignal } from 'solid-js'
import { DEFAULT_SIZE, findFreeSpot, screenToWorld, type CardType, type Vec } from '@doggynote/core'
import { cardHeight } from '../canvas/layout.ts'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { appendOrder, createCard, type Placement } from '../state/actions.ts'
import { boardId, camera, connectMode, setConnectMode, setTrashOpen, trashOpen, viewport } from '../state/ui.ts'
import { addAnyFiles, addImages } from '../canvas/paste.ts'
import { beginBoardDrawing, boardDrawing, endBoardDrawing } from '../state/drawing.ts'
import { Icon, type IconName } from './icons.tsx'

export type Tool = { id: CardType | 'line' | 'draw'; label: string; icon: IconName }

export const TOOLS: Tool[] = [
  { id: 'note', label: 'Note', icon: 'note' },
  { id: 'todo', label: 'To-do', icon: 'todo' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'link', label: 'Link', icon: 'link' },
  { id: 'line', label: 'Line', icon: 'line' },
  { id: 'column', label: 'Column', icon: 'column' },
  { id: 'movie', label: 'Movie', icon: 'film' },
  { id: 'swatch', label: 'Colour', icon: 'swatch' },
  { id: 'sketch', label: 'Sketch', icon: 'sketch' },
  { id: 'draw', label: 'Draw', icon: 'draw' },
]

export const PRIMARY_TOOLS = TOOLS.slice(0, 3)
export const MORE_TOOLS = TOOLS.slice(3)

/** Tools that switch a mode rather than add a card. */
export const modeTool = (id: Tool['id']): id is 'line' | 'draw' => id === 'line' || id === 'draw'

/** The Line and Draw tools toggle their mode; any other tool ends draw mode and adds a card. */
export function useTool(id: Tool['id'], place: () => Placement | null) {
  if (id === 'draw') return boardDrawing() ? endBoardDrawing() : beginBoardDrawing()
  endBoardDrawing()
  if (id === 'line') return setConnectMode(connectMode() ? null : { from: null })
  const at = place()
  if (at) createCard(id, at)
}

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
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6 && !modeTool(tool.id)) dragging = true
      if (dragging) setGhost({ tool, at: { x: ev.clientX, y: ev.clientY } })
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      setGhost(null)
      useTool(tool.id, () => {
        const place = dragging ? placementAt(ev.clientX, ev.clientY) : centrePlacement(tool.id as CardType)
        // Columns can't nest.
        return place && tool.id === 'column' && 'columnId' in place ? null : place
      })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <aside class="toolbar" aria-label="Tools" onKeyDown={(e) => { if (!e.metaKey && !e.ctrlKey && ['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) { e.stopPropagation(); if (e.key === 'Backspace') e.preventDefault() } }}>
      <For each={[PRIMARY_TOOLS, MORE_TOOLS]}>
        {(group, index) => <>
          <Show when={index() === 1}><div class="toolbar-group-label">More</div></Show>
          <div class={index() === 0 ? "toolbar-primary" : "toolbar-secondary"} role="group" aria-label={index() === 0 ? "Create" : "More tools"}>
            <For each={group}>
              {(t) => (
                <button
                  class="tool"
                  classList={{ active: (t.id === 'line' && !!connectMode()) || (t.id === 'draw' && boardDrawing()), 'tool-primary': t.id === 'note' }}
                  data-testid={`tool-${t.id}`}
                  aria-label={t.label}
                  aria-pressed={t.id === 'draw' ? boardDrawing() : undefined}
                  onClick={(e) => {
                    if (e.detail !== 0) return
                    useTool(t.id, () => centrePlacement(t.id as CardType))
                  }}
                  title={t.id === 'line' ? 'Line: click two cards to connect them' : t.id === 'draw' ? 'Draw: ink straight on the board' : `${t.label}: click to add, or drag onto the board`}
                  onPointerDown={(e) => onToolPointerDown(e, t)}
                  // The new card takes focus on pointerup; a tap's late mousedown would take it back.
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <Icon size={22} name={t.icon} />
                  <span>{t.label}</span>
                </button>
              )}
            </For>
          </div>
        </>}
      </For>
      <div class="toolbar-secondary toolbar-media" role="group" aria-label="Media">
        <button class="tool" data-testid="tool-stickers" aria-label="Stickers" aria-expanded={stickerTrayOpen()} aria-description={suggestions.length ? suggestions.length === 1 ? 'Pack found in Telegram' : `${suggestions.length} packs found in Telegram` : undefined} title={suggestions.length ? suggestions.length === 1 ? 'Pack found in Telegram' : `${suggestions.length} packs found in Telegram` : undefined} onClick={openStickers}><Icon size={22} name="sticker" /><span>Stickers</span><Show when={suggestions.length}><span class="sticker-found-dot" data-testid="sticker-found-badge" aria-hidden="true" /></Show></button>
        <button class="tool" data-testid="tool-image" title="Add image" onClick={() => fileInput.click()}>
          <Icon size={22} name="image" />
          <span>Image</span>
        </button>
        <button class="tool" data-testid="tool-upload" title="Upload files (PDFs, docs, anything up to 50 MB)" onClick={() => uploadInput.click()}>
          <Icon size={22} name="upload" />
          <span>Upload</span>
        </button>
      </div>
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
        <Icon size={22} name="bury" />
        <span>{COPY.trash}</span>
      </button>
      <Show when={ghost()}>
        <div class="tool-ghost" style={{ left: `${ghost()!.at.x}px`, top: `${ghost()!.at.y}px` }}>
          <Icon size={22} name={ghost()!.tool.icon} />
          {ghost()!.tool.label}
        </div>
      </Show>
    </aside>
  )
}
