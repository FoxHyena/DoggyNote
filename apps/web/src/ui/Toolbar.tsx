import { For, Show, createSignal, type JSX } from 'solid-js'
import { DEFAULT_SIZE, findFreeSpot, screenToWorld, type CardType, type Vec } from '@doggynote/core'
import { cardHeight } from '../canvas/layout.ts'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { appendOrder, createCard, type Placement } from '../state/actions.ts'
import { boardId, camera, connectMode, setConnectMode, setTrashOpen, trashOpen, viewport } from '../state/ui.ts'
import { addImages } from '../canvas/paste.ts'
import { Icon, ToolIcons } from './icons.tsx'

type Tool = { id: CardType | 'line'; label: string; icon: () => JSX.Element }

const TOOLS: Tool[] = [
  { id: 'note', label: 'Note', icon: ToolIcons.note },
  { id: 'link', label: 'Link', icon: ToolIcons.link },
  { id: 'todo', label: 'To-do', icon: ToolIcons.todo },
  { id: 'line', label: 'Line', icon: ToolIcons.line },
  { id: 'board', label: 'Board', icon: ToolIcons.board },
  { id: 'column', label: 'Column', icon: ToolIcons.column },
]

/** A click on a tool drops the card near the viewport centre, in free space. */
function centrePlacement(type: CardType = 'note'): Placement {
  const v = viewport()
  const c = screenToWorld(camera(), { x: v.width / 2, y: v.height / 2.6 })
  const size = DEFAULT_SIZE[type]
  const taken = doc.cardsOn(boardId()).filter((k) => !k.columnId).map((k) => ({ x: k.x, y: k.y, w: k.w, h: cardHeight(k) }))
  const spot = findFreeSpot({ x: c.x - size.w / 2, y: c.y - 20, w: size.w, h: size.h }, taken)
  return { at: { x: spot.x + size.w / 2, y: spot.y + 20 } }
}

/** Card placement under a screen point: a column slot if over a column, else the world point. */
function placementAt(clientX: number, clientY: number): Placement | null {
  const v = viewport()
  if (clientX < v.left || clientY < v.top || clientX > v.left + v.width || clientY > v.top + v.height) return null
  const col = (document.elementFromPoint(clientX, clientY)?.closest('.card-column') as HTMLElement | null)?.dataset.cardId
  if (col) return { columnId: col, order: appendOrder(col) }
  return { at: screenToWorld(camera(), { x: clientX - v.left, y: clientY - v.top }) }
}

export function Toolbar() {
  let fileInput!: HTMLInputElement
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

  const trashCount = () => (trashOpen(), doc.trashedOn(boardId()).length)

  return (
    <aside class="toolbar" aria-label="Tools">
      <For each={TOOLS}>
        {(t) => (
          <button
            class="tool"
            classList={{ active: t.id === 'line' && !!connectMode() }}
            data-testid={`tool-${t.id}`}
            title={t.id === 'line' ? 'Line: click two cards to connect them' : `${t.label}: click to add, or drag onto the board`}
            onPointerDown={(e) => onToolPointerDown(e, t)}
          >
            <Icon size={22}>{t.icon()}</Icon>
            <span>{t.label}</span>
          </button>
        )}
      </For>
      <div class="toolbar-sep" />
      <button class="tool" data-testid="tool-image" title="Add image" onClick={() => fileInput.click()}>
        <Icon size={22}>{ToolIcons.image()}</Icon>
        <span>Image</span>
      </button>
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
        <Show when={trashCount() > 0}>
          <span class="badge">{trashCount()}</span>
        </Show>
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
