import './canvas-entry.css'
import { touch } from '../state/device.ts'
import { For, Show, createMemo, createSignal, createEffect, onCleanup, onMount } from 'solid-js'
import { HOME_BOARD_ID, cardText, normalizeLabelName, type Id, type Label } from '@doggynote/core'
import { LabelChip } from './Labels.tsx'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { openBoard, setPaletteOpen } from '../state/ui.ts'
import { revealCard } from '../state/columns.ts'
import { hasLabel, labelsOn } from '../state/labels.ts'
import { BoardIconSvg, Icon, ToolIcons } from './icons.tsx'

// ⌘K "Fetch": search every board title and card text, jump to the result.

type Hit = { kind: 'board' | 'card'; id: Id; boardId: Id; title: string; snippet: string; score: number; labels?: Label[] }

const boardTitle = (id: Id) => (id === HOME_BOARD_ID ? COPY.home : boardDisplayTitle(doc.getBoard(id)))

export function search(query: string, limit = 30): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  const idx = doc.index()
  for (const b of idx.boards) {
    const t = (b.id === HOME_BOARD_ID ? COPY.home : boardDisplayTitle(b)).toLowerCase()
    const at = t.indexOf(q)
    if (at >= 0) hits.push({ kind: 'board', id: b.id, boardId: b.id, title: boardTitle(b.id), snippet: b.parentId ? `in ${boardTitle(b.parentId)}` : '', score: at === 0 ? 3 : 2 })
  }
  const nq = normalizeLabelName(q)
  for (const [bid, cards] of idx.cards) {
    // A card matches its labels' names too, e.g. "lighting" finds every card labelled Lighting.
    const matching = labelsOn(bid).filter((l) => normalizeLabelName(l.name).includes(nq))
    for (const c of cards) {
      const text = cardText(c)
      const at = text.toLowerCase().indexOf(q)
      const labels = matching.filter((l) => hasLabel(c, l.id))
      if (at < 0 && !labels.length) continue
      const where = `${c.type} in ${boardTitle(bid)}`
      if (at < 0) {
        hits.push({ kind: 'card', id: c.id, boardId: bid, title: text.split('\n').find((line) => line.trim())?.slice(0, 80) || `Untitled ${c.type}`, snippet: where, score: 1.25, labels })
        continue
      }
      const line = text.slice(0, at).lastIndexOf('\n') + 1
      const end = text.indexOf('\n', at)
      const snippet = text.slice(Math.max(line, at - 40), end < 0 ? undefined : Math.min(end, at + 80))
      hits.push({ kind: 'card', id: c.id, boardId: bid, title: snippet || text.slice(0, 80), snippet: where, score: at === 0 ? 1.5 : 1, labels })
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}

export function jumpTo(hit: Hit) {
  setPaletteOpen(false)
  openBoard(hit.boardId)
  if (hit.kind === 'board') return
  // Opens a collapsed column if it hides the card, then centres and focuses it.
  revealCard(hit.id)
}

export function FetchPalette() {
  const [q, setQ] = createSignal('')
  const [active, setActive] = createSignal(0)
  const hits = createMemo(() => search(q()))
  let input!: HTMLInputElement
  const previousFocus = (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.querySelector('[data-testid="open-fetch"]')) as HTMLElement | null
  let results: HTMLUListElement | undefined
  onMount(() => input.focus())
  onCleanup(() => queueMicrotask(() => { if (previousFocus?.isConnected) previousFocus.focus() }))
  createEffect(() => {
    const index = active()
    queueMicrotask(() => results?.querySelectorAll('[role="option"]')[index]?.scrollIntoView({ block: 'nearest' }))
  })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPaletteOpen(false) }
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.max(0, Math.min(hits().length - 1, i + 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const h = hits()[active()]
      if (h) jumpTo(h)
    }
  }

  return (
    <div class="dialog-backdrop fetch-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setPaletteOpen(false)}>
      <div class="fetch" role="dialog" aria-modal="true" aria-label={COPY.search} data-testid="fetch" onKeyDown={(e) => { if (e.key === 'Escape') onKey(e) }}>
        <div class="fetch-input-row">
          <Icon size={18}>{ToolIcons.search()}</Icon>
          <input
            ref={input}
            class="fetch-input"
            role="combobox"
            aria-label={COPY.search}
            aria-expanded={!!q().trim()}
            aria-controls="fetch-results"
            aria-activedescendant={hits()[active()] ? `fetch-hit-${active()}` : undefined}
            data-testid="fetch-input"
            placeholder={touch() ? `${COPY.search} a board, note or link…` : `${COPY.search}… boards, notes, to-dos, links, labels`}
            value={q()}
            onInput={(e) => {
              setQ(e.currentTarget.value)
              setActive(0)
            }}
            onKeyDown={onKey}
          />
          <button class="fetch-close" aria-label="Close search" onClick={() => setPaletteOpen(false)}>{touch() ? 'Cancel' : <kbd>esc</kbd>}</button>
        </div>
        <Show when={!q().trim() && touch()}>
          <p class="fetch-empty fetch-hint">{COPY.fetchHint}</p>
        </Show>
        <Show when={q().trim()}>
          <ul ref={results} id="fetch-results" class="fetch-results" role="listbox" aria-label="Search results">
            <For each={hits()} fallback={<li class="fetch-empty">No bones found for “{q()}”.</li>}>
              {(h, i) => (
                <li
                  role="option"
                  id={`fetch-hit-${i()}`}
                  aria-selected={i() === active()}
                  class="fetch-hit"
                  classList={{ active: i() === active() }}
                  data-testid="fetch-hit"
                  onPointerEnter={() => setActive(i())}
                  // A direct listener, not Solid's document-level delegation: touch
                  // WebKit only turns a tap into a click on an element that listens itself.
                  on:click={() => jumpTo(h)}
                >
                  <span class="fetch-icon">
                    <Show when={h.kind === 'board'} fallback={<Icon size={16}>{ToolIcons.note()}</Icon>}>
                      <BoardIconSvg icon={doc.getBoard(h.id)?.icon ?? 'paw'} size={16} />
                    </Show>
                  </span>
                  <span class="fetch-title">{h.title}</span>
                  <span class="fetch-snippet">
                    {h.snippet}
                    <Show when={h.labels?.length}>
                      <span class="fetch-labels" data-testid="fetch-labels"><For each={h.labels}>{(label) => <LabelChip label={label} />}</For></span>
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}
