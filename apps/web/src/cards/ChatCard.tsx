import { Show, onMount } from 'solid-js'
import { mdToText } from '@doggynote/core'
import type { CardProps } from '../canvas/CardView.tsx'
import { chatThread, contextLinks, localChatRun, openChat, openChatId, restoreCachedChat } from '../state/chats.ts'
import { exporting } from '../state/export.ts'
import { isShareViewer } from '../state/api.ts'
import { Icon } from '../ui/icons.tsx'
import { ChatConversation } from '../ui/ChatPanel.tsx'
import '../ui/chat.css'

/** Only the active note mounts the live thread; passive previews never fetch transcripts. */
export function ChatCard(props: CardProps<'chat'>) {
  const neutral = () => isShareViewer() || exporting()
  const latest = () => chatThread(props.card.id)?.turns.at(-1)
  const waiting = () => localChatRun(props.card.id)?.status === 'running' && !!localChatRun(props.card.id)?.inputRequest
  const activate = (event: MouseEvent) => { event.stopPropagation(); openChat(props.card.id) }
  onMount(() => { if (!neutral() && !props.lod) void restoreCachedChat(props.card.id) })
  return <Show when={!neutral() && !props.lod && openChatId() === props.card.id} fallback={
    <div class="chat-card-content">
      <header class="chat-header"><h2>{neutral() ? 'Conversation' : typeof props.card.content?.title === 'string' ? props.card.content.title : 'Conversation'}</h2><Show when={!neutral() && !props.lod} fallback={<Icon name="comment" size={18} />}><button class="icon-btn" aria-label="Open conversation" data-tooltip="Continue conversation" data-nodrag onClick={activate}><Icon name="comment" size={18} /></button></Show></header>
      <Show when={!props.lod}>
        <Show when={!neutral()} fallback={<p class="chat-neutral">Conversation available to board members.</p>}>
          <div class="chat-passive-meta">{props.card.content?.provider === 'codex' ? 'Codex' : 'Claude'}<span>{contextLinks(props.card.id).length} sources</span></div>
          <div class="chat-preview" data-nodrag>
            <Show when={latest()} fallback={<div class="chat-empty"><h2>Think with your board</h2><p>Bring a few notes together. Ask a question, explore an alternative, keep what helps.</p></div>}>{(turn) => <><h3>You</h3><p class="chat-preview-prompt">{turn().prompt}</p><h3>{turn().provider === 'codex' ? 'Codex' : 'Claude'} <span>{waiting() ? 'Waiting for your answer' : turn().status}</span></h3><p class="chat-preview-answer">{waiting() ? localChatRun(props.card.id)!.inputRequest!.questions[0].question : mdToText(turn().answer).slice(0, 1600) || 'No answer yet.'}</p></>}</Show>
          </div>
          <button class="chat-resume" aria-label="Continue conversation" data-nodrag onClick={activate}><span>{waiting() ? 'Answer the question…' : latest() ? 'Continue the conversation…' : 'Ask about your connected notes…'}</span><Icon name="open" size={18} /></button>
        </Show>
      </Show>
    </div>
  }><ChatConversation card={props.card} /></Show>
}
