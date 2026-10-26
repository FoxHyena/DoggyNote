import { For, Show, createSignal } from 'solid-js'
import { mdToText, type UnreadThread } from '@doggynote/core'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { openBoard } from '../state/ui.ts'
import { revealCard } from '../state/columns.ts'
import { relativeTime } from '../state/comments.ts'
import { markAllSeen, unreadIds, unreadLabel, unreadList, unreadThread, unreadTotal } from '../state/unread.ts'
import { openThread } from './CommentsPanel.tsx'
import { describeCard } from './TrashPanel.tsx'
import { Popover } from './Popover.tsx'
import { Icon } from './icons.tsx'
import './unread.css'

/** Open the board, bring the card into view and open its thread (which marks it read). */
function goTo(t: UnreadThread) {
  openBoard(t.boardId)
  revealCard(t.cardId)
  openThread(t.cardId)
}

function Row(props: { t: UnreadThread; go: (t: UnreadThread) => void }) {
  const card = () => doc.getCard(props.t.cardId)
  const board = () => boardDisplayTitle(doc.getBoard(props.t.boardId), 'Board')
  return (
    <li>
      <button class="unread-row" data-testid="unread-row" aria-label={`${COPY.unread.goTo}: ${props.t.latest.author} on ${card() ? describeCard(card()!) : 'a card'}, ${unreadLabel(props.t.count)}`} onClick={() => props.go(props.t)}>
        <span class="unread-row-body">
          <span class="unread-row-who">
            <strong>{props.t.latest.author}</strong>
            <span class="unread-row-on"> on {card() ? describeCard(card()!) : 'a card'}</span>
          </span>
          <span class="unread-row-text">{mdToText(String(props.t.latest.text ?? '')).replace(/\s+/g, ' ').trim()}</span>
          <span class="unread-row-meta">
            {board()} · {relativeTime(props.t.at)}
            <Show when={props.t.count > 1}> · {props.t.count} new</Show>
          </span>
        </span>
        <span class="unread-go" aria-hidden="true">{COPY.unread.goTo}<Icon name="open" size={14} /></span>
      </button>
    </li>
  )
}

/**
 * Top-bar bell, only while something is unread: a list of threads with new
 * comments from friends, across every board you can read.
 */
export function UnreadButton() {
  const [open, setOpen] = createSignal(false)
  let trigger!: HTMLButtonElement
  const go = (t: UnreadThread) => {
    setOpen(false)
    goTo(t)
  }
  return (
    <Show when={unreadTotal() || open()}>
      <button
        ref={trigger}
        class="icon-btn unread-trigger"
        classList={{ on: open() }}
        data-testid="unread-button"
        data-tooltip={COPY.unread.title}
        aria-label={unreadTotal() ? `${COPY.unread.title}: ${unreadLabel(unreadTotal())}` : COPY.unread.title}
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span class="unread-bell">
          <Icon name="bell" />
          <Show when={unreadTotal()}><span class="unread-dot" aria-hidden="true" /></Show>
        </span>
        <span class="icon-btn-label" aria-hidden="true">
          {COPY.unread.short}<Show when={unreadTotal()}><span class="count-inline" data-testid="unread-count"> · {unreadTotal()}</span></Show>
        </span>
      </button>
      <Show when={open()}>
        <Popover anchor={() => trigger} label={COPY.unread.title} testid="unread-panel" class="unread-popover" close={() => setOpen(false)}>
          <header class="unread-head">
            <h2>{COPY.unread.title}</h2>
            <Show when={unreadList().length}>
              <button class="link-btn" data-testid="unread-mark-all" onClick={markAllSeen}>{COPY.unread.markAll}</button>
            </Show>
          </header>
          <Show when={unreadList().length} fallback={<p class="unread-empty" data-testid="unread-empty">{COPY.unread.caughtUp}</p>}>
            <ul class="unread-list">
              <For each={unreadIds()}>{(id) => <Show when={unreadThread(id)}>{(t) => <Row t={t()} go={go} />}</Show>}</For>
            </ul>
          </Show>
        </Popover>
      </Show>
    </Show>
  )
}
