import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import { HOME_BOARD_ID, docToText, type Card, type Id } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { openBoard, select, setPaletteOpen, viewport } from '../state/ui.ts'
import { animateCamera } from '../canvas/Canvas.tsx'
import { cardHeight } from '../canvas/layout.ts'
import { BoardIconSvg, Icon, ToolIcons } from './icons.tsx'

// ⌘K "Fetch": search every board title and card text, jump to the result.

type Hit = { kind: 'board' | 'card'; id: Id; boardId: Id; title: string; snippet: string; score: number }

function cardText(c: Card): string {
  switch (c.type) {
    case 'note':
      return docToText((c as Card<'note'>).content.doc)
    case 'todo': {
      const t = (c as Card<'todo'>).content
      return [t.title, ...t.items.map((i) => i.text)].join('\n')
    }
    case 'link': {
      const l = (c as Card<'link'>).content
      return [l.title, l.description, l.url].filter(Boolean).join('\n')
    }
    case 'column':
      return (c as Card<'column'>).content.title
    default:
      return ''
  }
}

const boardTitle = (id: Id) => (id === HOME_BOARD_ID ? COPY.home : doc.getBoard(id)?.title || 'Untitled board')

export function search(query: string, limit = 30): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  const idx = doc.index()
  for (const b of idx.boards) {
    const t = (b.id === HOME_BOARD_ID ? COPY.home : b.title).toLowerCase()
    const at = t.indexOf(q)
    if (at >= 0) hits.push({ kind: 'board', id: b.id, boardId: b.id, title: boardTitle(b.id), snippet: b.parentId ? `in ${boardTitle(b.parentId)}` : '', score: at === 0 ? 3 : 2 })
  }
  for (const [bid, cards] of idx.cards) {
    for (const c of cards) {
      const text = cardText(c)
      const at = text.toLowerCase().indexOf(q)
      if (at < 0) continue
      const line = text.slice(0, at).lastIndexOf('\n') + 1
      const end = text.indexOf('\n', at)
      const snippet = text.slice(Math.max(line, at - 40), end < 0 ? undefined : Math.min(end, at + 80))
      hits.push({ kind: 'card', id: c.id, boardId: bid, title: snippet || text.slice(0, 80), snippet: `${c.type} in ${boardTitle(bid)}`, score: at === 0 ? 1.5 : 1 })
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}

export function jumpTo(hit: Hit) {
  setPaletteOpen(false)
  openBoard(hit.boardId)
  if (hit.kind === 'board') return
  // After the board switch has set its camera, centre on the card.
  setTimeout(() => {
    const c = doc.getCard(hit.id)
    if (!c) return
    const target = c.columnId ? (doc.getCard(c.columnId) ?? c) : c
    const v = viewport()
    const zoom = 1
    animateCamera({ x: target.x + target.w / 2 - v.width / 2 / zoom, y: target.y + cardHeight(target) / 2 - v.height / 2 / zoom, zoom })
    select([c.id])
  }, 30)
}

export function FetchPalette() {
  const [q, setQ] = createSignal('')
  const [active, setActive] = createSignal(0)
  const hits = createMemo(() => search(q()))
  let input!: HTMLInputElement
  onMount(() => input.focus())

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setPaletteOpen(false)
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(hits().length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      const h = hits()[active()]
      if (h) jumpTo(h)
    }
  }

  return (
    <div class="dialog-backdrop fetch-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setPaletteOpen(false)}>
      <div class="fetch" role="dialog" aria-label={COPY.search} data-testid="fetch">
        <div class="fetch-input-row">
          <Icon size={18}>{ToolIcons.search()}</Icon>
          <input
            ref={input}
            class="fetch-input"
            data-testid="fetch-input"
            placeholder={`${COPY.search}… boards, notes, to-dos, links`}
            value={q()}
            onInput={(e) => {
              setQ(e.currentTarget.value)
              setActive(0)
            }}
            onKeyDown={onKey}
          />
          <kbd>esc</kbd>
        </div>
        <Show when={q().trim()}>
          <ul class="fetch-results" role="listbox">
            <For each={hits()} fallback={<li class="fetch-empty">No bones found for “{q()}”.</li>}>
              {(h, i) => (
                <li
                  role="option"
                  aria-selected={i() === active()}
                  class="fetch-hit"
                  classList={{ active: i() === active() }}
                  data-testid="fetch-hit"
                  onPointerEnter={() => setActive(i())}
                  onClick={() => jumpTo(h)}
                >
                  <span class="fetch-icon">
                    <Show when={h.kind === 'board'} fallback={<Icon size={16}>{ToolIcons.note()}</Icon>}>
                      <BoardIconSvg icon={doc.getBoard(h.id)?.icon ?? 'paw'} size={16} />
                    </Show>
                  </span>
                  <span class="fetch-title">{h.title}</span>
                  <span class="fetch-snippet">{h.snippet}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}
