import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { isAlive, parseMarkdown, type Comment } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { user } from '../state/session.ts'
import { setTrashOpen } from '../state/ui.ts'
import { addComment, deleteComment, editComment, isResolved, relativeTime, setResolved, setThreadCardId, threadCardId } from '../state/comments.ts'
import { RichText } from '../editor/RichText.tsx'
import { describeCard } from './TrashPanel.tsx'
import { setToyboxOpen } from './ToyboxPanel.tsx'
import { Icon, ToolIcons } from './icons.tsx'

/** Open the thread on a card (closing the other right-hand panels). */
export function openThread(cardId: string) {
  setTrashOpen(false)
  setToyboxOpen(false)
  setThreadCardId(cardId)
}

/** ⌘Enter / Ctrl+Enter. */
const isSend = (e: KeyboardEvent) => e.key === 'Enter' && (e.metaKey || e.ctrlKey)

function Message(props: { m: Comment; readOnly: boolean }) {
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal('')
  const mine = () => !props.readOnly && user()?.id === props.m.authorId
  const save = () => {
    editComment(props.m.id, draft())
    setEditing(false)
  }
  return (
    <li class="comment" data-testid="comment">
      <div class="comment-meta">
        <strong class="comment-author">{props.m.author}</strong>
        <span class="comment-time" title={new Date(props.m.createdAt).toLocaleString()}>
          {relativeTime(props.m.createdAt)}
          {props.m.editedAt ? ' · edited' : ''}
        </span>
        <Show when={mine() && !editing()}>
          <span class="comment-actions">
            <button
              class="link-btn"
              data-testid="comment-edit"
              onClick={() => {
                setDraft(props.m.text)
                setEditing(true)
              }}
            >
              Edit
            </button>
            <button class="link-btn" data-testid="comment-delete" onClick={() => deleteComment(props.m.id)}>
              Delete
            </button>
          </span>
        </Show>
      </div>
      <Show
        when={editing()}
        fallback={
          <div class="comment-text">
            <RichText doc={parseMarkdown(props.m.text)} />
          </div>
        }
      >
        <textarea
          class="comment-input"
          data-testid="comment-edit-input"
          rows={3}
          value={draft()}
          ref={(el) => queueMicrotask(() => el.focus())}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (isSend(e)) save()
            else if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(false)
            }
          }}
        />
        <div class="comment-edit-bar">
          <button class="bar-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button class="primary-btn" data-testid="comment-save" onClick={save}>
            Save
          </button>
        </div>
      </Show>
    </li>
  )
}

export function CommentsPanel(props: { readOnly?: boolean }) {
  const [draft, setDraft] = createSignal('')
  const card = createMemo(() => doc.getCard(threadCardId()))
  const messages = createMemo(() => (threadCardId() ? doc.commentsOn(threadCardId()!) : []))
  // The card went away (buried, moved into someone's Toy box): close.
  createEffect(() => {
    if (threadCardId() && !isAlive(doc.get(threadCardId()!))) setThreadCardId(null)
  })
  const send = () => {
    const id = threadCardId()
    if (!id || !draft().trim()) return
    addComment(id, draft())
    setDraft('')
  }

  return (
    <Show when={card()}>
      <aside class="trash comments" data-testid="comments-panel" aria-label="Comments" onPointerDown={(e) => e.stopPropagation()}>
        <header class="trash-head">
          <h2>Comments</h2>
          <Show when={!props.readOnly && messages().length}>
            <button
              class="bar-btn"
              data-testid="comment-resolve"
              classList={{ on: isResolved(card()!.id) }}
              title={isResolved(card()!.id) ? 'Open the thread again' : 'Mark the thread as done'}
              onClick={() => setResolved(card()!.id, !isResolved(card()!.id))}
            >
              <Icon size={16}>{ToolIcons.check()}</Icon>
              {isResolved(card()!.id) ? 'Reopen' : 'Resolve'}
            </button>
          </Show>
          <button class="icon-btn" title="Close" data-testid="comments-close" onClick={() => setThreadCardId(null)}>
            <Icon>{ToolIcons.close()}</Icon>
          </button>
        </header>
        <p class="toybox-sub comments-on">
          On <em>{describeCard(card()!)}</em>
          <Show when={isResolved(card()!.id)}>
            <span class="comments-resolved" data-testid="comments-resolved">
              {' '}
              · Resolved
            </span>
          </Show>
        </p>
        <Show when={messages().length} fallback={<p class="trash-empty">No comments yet.</p>}>
          <ul class="comment-list">
            <For each={messages()}>{(m) => <Message m={m} readOnly={!!props.readOnly} />}</For>
          </ul>
        </Show>
        <Show when={!props.readOnly}>
          <div class="comment-reply">
            <textarea
              class="comment-input"
              data-testid="comment-input"
              rows={3}
              placeholder={messages().length ? 'Reply… (⌘Enter to send)' : 'Start a thread… (⌘Enter to send)'}
              value={draft()}
              ref={(el) => queueMicrotask(() => el.focus())}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (isSend(e)) {
                  e.preventDefault()
                  send()
                } else if (e.key === 'Escape') setThreadCardId(null)
              }}
            />
            <button class="primary-btn" data-testid="comment-send" disabled={!draft().trim()} onClick={send}>
              Send
            </button>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
