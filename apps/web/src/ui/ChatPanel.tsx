import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { isAlive, mdToText, parseMarkdown, type Card } from '@doggynote/core'
import { CHAT_LIMITS, type ChatProvider, type ChatTurn, type ContextSnapshot } from '@doggynote/core/chat'
import * as doc from '../state/doc.ts'
import { chatAnnouncement, chatMessageTarget, setChatMessageTarget, answerChatInput, chatInputDraft, saveChatInputDraft, attachContext, chatDraft, saveChatDraft, chatProviders, chatThread, contextLinks, detachContext, discoverChatProviders, inspectChat, loadChat, localChatRun, openChatId, providerProblem, sendChat, setOpenChatId, stopChat, type InputRequest, type LocalRun, type Capture } from '../state/chats.ts'
import { canEditBoard, canReadBoard } from '../state/access.ts'
import { isTauri } from '../state/platform.ts'
import { boardId, camera, setCamera } from '../state/ui.ts'
import { revealCard } from '../state/columns.ts'
import { phone } from '../state/device.ts'
import { visible as visibleViewport } from '../state/viewport.ts'
import { frameChat, resetChatFocusScroll, revealChatComposer } from '../canvas/chatViewport.ts'
import { RichText } from '../editor/RichText.tsx'
import { Icon } from './icons.tsx'
import { api } from '../state/api.ts'
import { openPreview } from '../state/preview.ts'
import { branchChat, saveChatAnswer, sourceLabel } from './chatActions.ts'
import { showToast } from '../state/toast.ts'
import './chat.css'

export function ChatPanel() {
  const visible = createMemo(() => {
    const card = doc.getCard(openChatId())
    return card?.type === 'chat' && isAlive(card) && card.boardId === boardId() && canReadBoard(card.boardId) ? card as Card<'chat'> : undefined
  })
  createEffect(() => { if (openChatId() && !visible()) setOpenChatId(null) })
  return <div class="chat-announcement" role="status" aria-live="polite" aria-atomic="true" data-testid="chat-status">{chatAnnouncement()}</div>
}
function ContextText(props: { context: ContextSnapshot }) {
  return <>
    <p class="chat-size">{props.context.sources.length} {props.context.sources.length === 1 ? 'source' : 'sources'} · {props.context.characters.toLocaleString()} characters · ~{props.context.estimatedTokens.toLocaleString()} tokens (estimate)</p>
    <For each={props.context.sources}>{(source) => <details class="chat-source" open><summary>{source.label} <span>version {source.revision}</span></summary><pre>{source.text || '(Empty source)'}</pre></details>}</For>
    <For each={props.context.excluded}>{(source) => <p class="chat-excluded">Excluded: {source.reason}</p>}</For>
    <Show when={!props.context.sources.length}><p class="chat-muted">No source text will be supplied. Unlinked cards are excluded.</p></Show>
  </>
}
function LiveAnswer(props: { run: LocalRun }) {
  return <div data-testid="chat-live"><div class="chat-answer chat-stream">{props.run.answer || 'Preparing the local provider…'}</div><Show when={props.run.status !== 'running'}><p class="chat-excluded">Saved on this Mac; waiting for the server to acknowledge this {props.run.status === 'completed' ? 'answer' : 'partial answer'}. Reconnect to finish saving.</p></Show></div>
}
function turnProblem(error: string) {
  if (error === 'interrupted') return 'Interrupted. This answer may be incomplete.'
  if (error === 'tool-request') return 'This conversation cannot use the requested capability. Add the missing details in a new message.'
  if (error === 'provider-unavailable') return 'The provider configuration could not be isolated. Check its local settings or choose another provider.'
  return `The provider stopped (${error}). Check the provider and try another turn.`
}
function ProviderQuestions(props: { chatId: string; request: InputRequest; focusOnMount: boolean }) {
  let root!: HTMLElement
  const [answers, setAnswers] = createSignal<Record<string, string>>({ ...chatInputDraft(props.chatId, props.request.id) })
  const [sending, setSending] = createSignal(false), [problem, setProblem] = createSignal('')
  const update = (id: string, value: string) => { const next = { ...answers(), [id]: value }; setAnswers(next); if (!saveChatInputDraft(props.chatId, props.request.id, next)) setProblem("This browser could not save your draft. Keep this view open until you send it.") }
  onMount(() => requestAnimationFrame(() => {
    const active = document.activeElement
    if (root.isConnected && props.focusOnMount && (active === document.body || root.closest('[data-card-id]')?.contains(active))) root.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
  }))
  const submit = async () => {
    if (sending()) return
    setSending(true); setProblem('')
    try { await answerChatInput(props.chatId, props.request.id, answers()) }
    catch (error) { setProblem(error instanceof Error ? error.message : 'The answer could not be sent. Try again.') }
    finally { setSending(false) }
  }
  return <section ref={root} class="chat-questions" aria-label="Provider questions" data-testid="chat-questions">
    <h2>Codex needs your input</h2><p class="chat-muted">Your response becomes part of this saved conversation. Choose a suggestion or write an answer.</p>
    <For each={props.request.questions}>{(question) => <label>{question.question}
      <Show when={question.options?.length}><span class="chat-question-choice"><select aria-label={`${question.header}: suggestions`} disabled={sending()} value={question.options?.some((option) => option.label === answers()[question.id]) ? answers()[question.id] : ''} onChange={(event) => { if (event.currentTarget.value) update(question.id, event.currentTarget.value) }}><option value="">Choose a suggestion…</option><For each={question.options ?? []}>{(option) => <option value={option.label}>{option.label} — {option.description}</option>}</For></select><Icon name="chevronDown" size={16} /></span></Show>
      <textarea aria-label={question.question} rows={2} maxLength={4000} value={answers()[question.id] ?? ''} onInput={(event) => update(question.id, event.currentTarget.value)} disabled={sending()} />
    </label>}</For>
    <Show when={problem()}><p role="alert" class="chat-error">{problem()}</p></Show>
    <button class="primary-btn" disabled={sending() || props.request.questions.some((q) => !answers()[q.id]?.trim())} onClick={() => void submit()}>{sending() ? 'Sending answer…' : 'Send answer'}</button>
  </section>
}
export function ChatConversation(props: { card: Card<'chat'> }) {
  let compose!: HTMLTextAreaElement, messages!: HTMLDivElement, inspector!: HTMLElement, pickerTrigger!: HTMLButtonElement
  const [draft, setDraft] = createSignal(chatDraft(props.card.id)), [problem, setProblem] = createSignal(''), [busy, setBusy] = createSignal(false)
  const [capture, setCapture] = createSignal<Capture | null>(null), [picking, setPicking] = createSignal(false)
  const [provider, setProvider] = createSignal<ChatProvider>(props.card.content?.provider === 'codex' ? 'codex' : 'claude')
  const [showContext, setShowContext] = createSignal(false)
  const [draftProblem, setDraftProblem] = createSignal(''), [renaming, setRenaming] = createSignal(false), [highlighted, setHighlighted] = createSignal<string | null>(null)
  let draftVersion = 0, followLatest = true, scrollQueued = false
  const editDraft = (value: string) => { draftVersion++; setDraft(value) }
  const scrollLatest = () => {
    if (scrollQueued || !followLatest || showContext() || inputRequest()) return
    scrollQueued = true
    requestAnimationFrame(() => { scrollQueued = false; if (messages?.isConnected && followLatest && !showContext() && !inputRequest()) messages.scrollTop = messages.scrollHeight })
  }
  const [taskDraft, setTaskDraft] = createSignal<{ turn: ChatTurn; selected: string; title: string; lines: string } | null>(null)
  const writable = () => canEditBoard(props.card.boardId) && !doc.previewing()
  const thread = () => chatThread(props.card.id)
  const local = () => localChatRun(props.card.id)
  let ownsFocus = false, questionId: string | undefined, questionFocus = false
  const inputRequest = createMemo(() => {
    const request = local()?.status === 'running' ? local()?.inputRequest ?? null : null
    if (request?.id !== questionId) {
      questionId = request?.id
      questionFocus = ownsFocus || document.activeElement?.closest('[data-card-id]')?.getAttribute('data-card-id') === props.card.id
    }
    return request
  }, null, { equals: (a, b) => a?.id === b?.id })
  const running = () => local()?.status === 'running' || thread()?.turns.some((t) => t.status === 'running')
  const providerInfo = () => chatProviders().find((p) => p.provider === provider())
  const sources = () => contextLinks(props.card.id)
  const included = (id: string) => sources().some((l) => l.from === id)
  const candidates = () => doc.cardsOn(props.card.boardId).filter((c) => c.id !== props.card.id && c.type !== 'chat' && c.type !== 'column')
  const close = () => { setOpenChatId(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(props.card.id)}"] .chat-resume`)?.focus({ preventScroll: true })) }
  const stop = () => void stopChat(props.card.id).catch((error) => setProblem(error instanceof Error ? error.message : 'The run could not be stopped. Retry Stop.'))
  createEffect(() => { if (!saveChatDraft(props.card.id, draft())) setDraftProblem('This browser could not save your draft. Keep this view open until you send it.') })
  createEffect(() => { local()?.answer; thread()?.turns.length; scrollLatest() })
  createEffect(() => {
    const target = chatMessageTarget(), turns = thread()?.turns
    if (target?.chatId !== props.card.id || !turns?.some((turn) => turn.id === target.messageId)) return
    requestAnimationFrame(() => {
      const turn = messages?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(target.messageId)}"]`)
      if (!turn) return
      followLatest = false; setShowContext(false); setHighlighted(target.messageId)
      messages.scrollTop = turn.offsetTop; turn.focus({ preventScroll: true }); setChatMessageTarget(null)
    })
  })
  const attempt = async (work: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true); setProblem('')
    try { await work() } catch (error) { setProblem(error instanceof Error ? error.message : 'That could not be saved. Try again.') }
    finally { setBusy(false) }
  }
  const refreshContext = async () => { setCapture(null); setCapture(await inspectChat(props.card.id)) }
  let keyboardReturn: ReturnType<typeof camera> | null = null, keyboardCamera: ReturnType<typeof camera> | null = null
  createEffect(on(visibleViewport, (viewport) => {
    if (!phone() || !compose?.isConnected) return
    if (viewport.height >= innerHeight * 0.9) {
      if (keyboardReturn && JSON.stringify(camera()) === JSON.stringify(keyboardCamera)) setCamera(keyboardReturn)
      keyboardReturn = keyboardCamera = null
      frameChat(props.card.id)
    } else if (document.activeElement === compose) requestAnimationFrame(() => {
      if (!compose.isConnected) return
      keyboardReturn ??= camera()
      keyboardCamera = revealChatComposer(compose)
    })
  }))
  onMount(() => {
    if (inputRequest()) {
      if (document.activeElement === document.body) messages.querySelector<HTMLTextAreaElement>('.chat-questions textarea')?.focus({ preventScroll: true })
    } else compose?.focus({ preventScroll: true })
    const canvas = document.querySelector('[data-testid="canvas"]')
    canvas?.addEventListener('scroll', resetChatFocusScroll)
    window.addEventListener('scroll', resetChatFocusScroll)
    void attempt(async () => { await refreshContext(); await loadChat(props.card.id) })
    void discoverChatProviders()
    const timer = setInterval(() => void loadChat(props.card.id).catch(() => {}), 5000)
    onCleanup(() => { clearInterval(timer); canvas?.removeEventListener('scroll', resetChatFocusScroll); window.removeEventListener('scroll', resetChatFocusScroll) })
  })
  createEffect(on(inputRequest, (request) => { if (request) { setShowContext(false); requestAnimationFrame(() => { const form = messages?.querySelector<HTMLElement>('.chat-questions'); if (form) messages.scrollTop = form.offsetTop }) } }))
  const send = () => void attempt(async () => {
    const context = capture()
    if (!context) throw new Error('Inspect the exact context before sending.')
    const submitted = draft(), version = draftVersion
    followLatest = true
    try { await sendChat(props.card.id, submitted, provider(), context) }
    catch (error) {
      if (error instanceof Error && error.message.includes('Context changed since inspection')) { setCapture(null); setShowContext(true) }
      throw error
    }
    if (version === draftVersion) setDraft('')
    scrollLatest()
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (compose?.isConnected && ownsFocus && (active === document.body || compose.closest('[data-card-id]')?.contains(active))) compose.focus({ preventScroll: true })
    })
  })
  const selectedAnswer = (turn: ChatTurn) => {
    const selected = window.getSelection()?.toString() ?? ''
    return selected && (turn.answer.includes(selected) || mdToText(turn.answer).includes(selected)) ? selected : turn.answer
  }
  const saved = (turn: ChatTurn) => void attempt(async () => {
    const id = await saveChatAnswer(props.card, turn, selectedAnswer(turn))
    showToast('Answer saved as an editable note', 5000, { label: 'Show note', run: () => { close(); revealCard(id) } })
  })
  const proposeTasks = () => void attempt(async () => {
    const draft = taskDraft()
    if (!draft) return
    const tasks = draft.lines.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!tasks.length || tasks.length > 50) throw new Error('Choose between 1 and 50 tasks.')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([props.card.id, draft.turn.id, draft.selected, draft.title, tasks])))
    const operationId = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const result = await api<{ id: string }>(`/api/chats/${props.card.id}/task-proposal`, { method: 'POST', json: { operationId, messageId: draft.turn.id, selectedText: draft.selected, title: draft.title, tasks } })
    await openPreview(result.id)
    close()
  })
  const displayLocal = () => {
    const run = local()
    return run && (run.status === 'running' || !thread()?.turns.some((t) => t.id === run.runId && t.status !== 'running')) ? run : null
  }
  return <section class="chat-note" aria-label={typeof props.card.content?.title === 'string' ? props.card.content.title : 'Conversation'} data-testid="chat-conversation" aria-busy={busy()} onFocusIn={() => { ownsFocus = true; requestAnimationFrame(() => { resetChatFocusScroll(); if (compose?.isConnected && document.activeElement === compose && visibleViewport().height < innerHeight * 0.8) revealChatComposer(compose) }) }} onFocusOut={(e) => {
    // Removing the composer temporarily focuses body; moving to another editor
    // explicitly releases ownership before a provider question can arrive.
    if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) ownsFocus = false
  }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close() } }}>
    <header class="chat-header"><Show when={renaming()} fallback={<h2>{typeof props.card.content?.title === 'string' ? props.card.content.title : 'Conversation'}</h2>}><input class="chat-title-input" aria-label="Conversation title" data-nodrag maxLength={120} value={typeof props.card.content?.title === 'string' ? props.card.content.title : 'Conversation'} ref={(input) => requestAnimationFrame(() => { input.focus({ preventScroll: true }); input.select() })} onBlur={(e) => { const title = e.currentTarget.value.trim(); if (title && writable()) doc.update({ [props.card.id]: { content: { ...props.card.content, title } } }); setRenaming(false) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(false) } }} /></Show><div class="chat-header-actions" data-nodrag><Show when={writable() && !renaming()}><button class="icon-btn" aria-label="Rename conversation" onPointerDown={(e) => e.stopPropagation()} onClick={() => setRenaming(true)}><Icon name="edit" size={16} /></button></Show><Show when={showContext() && local()?.status === 'running'}><button class="bar-btn" onPointerDown={(e) => e.stopPropagation()} onClick={stop}>Stop</button></Show><button class="icon-btn" aria-label="Close conversation" data-tooltip="Finish editing" onPointerDown={(e) => e.stopPropagation()} onClick={close}><Icon name="minus" size={17} /></button></div></header>
    <div class="chat-options" data-nodrag>
      <label><select aria-label="Chat provider" value={provider()} disabled={!!running() || !writable()} onChange={(e) => { const value = e.currentTarget.value as ChatProvider; setProvider(value); doc.update({ [props.card.id]: { content: { ...props.card.content, provider: value } } }) }}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
      <button class="bar-btn" aria-expanded={showContext()} onClick={() => { const opening = !showContext(); setShowContext(opening); if (opening) void attempt(refreshContext) }} aria-label={showContext() ? 'Back to thread' : `Inspect context (${sources().length})`}>{showContext() ? 'Back to thread' : `${sources().length} ${sources().length === 1 ? 'source' : 'sources'}`}</button>
    </div>
    <Show when={problem()}><div role="alert" class="chat-error chat-notice">{problem()}<Show when={!capture() && showContext()}><button class="bar-btn" disabled={busy()} onClick={() => void attempt(refreshContext)}>Inspect updated context</button></Show></div></Show><Show when={draftProblem()}><p role="alert" class="chat-error chat-notice">{draftProblem()}</p></Show>
    <div class="chat-workspace" classList={{ 'with-context': showContext() }} data-nodrag>
      <section class="chat-conversation" hidden={showContext()}>
        <div ref={messages} class="chat-messages" tabIndex={0} onScroll={() => { followLatest = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 32 }}>
          <Show when={thread()?.parent}><p class="chat-muted">Branched from a completed answer. Visible history and its context are preserved; hidden provider state is not transferred.</p></Show>
          <Show when={!thread()?.turns.length && !displayLocal()}><div class="chat-empty"><h2>What are you working through?</h2><p>Connect a brief, a few notes or a list. Keep the conversation beside the ideas that started it.</p><button class="bar-btn" onClick={() => { setShowContext(true); setPicking(true) }}>Add context</button></div></Show>
          <For each={thread()?.turns ?? []}>{(turn) => <article class="chat-turn" classList={{ 'chat-turn-highlighted': highlighted() === turn.id }} data-message-id={turn.id} tabIndex={-1} data-testid="chat-turn">
            <h2>You</h2><p class="chat-prompt">{turn.prompt}</p>
            <h2>{turn.provider === 'claude' ? 'Claude' : 'Codex'} <span class="chat-muted">{turn.status === 'running' ? displayLocal()?.runId === turn.id ? inputRequest() ? 'Waiting for your answer' : displayLocal()!.status === 'running' ? 'Running' : `${displayLocal()!.status} · waiting to save` : 'Running on the initiating Mac' : turn.status}</span></h2>
            <Show when={turn.status === 'running' && displayLocal()?.runId === turn.id}><LiveAnswer run={displayLocal()!} /></Show>
            <Show when={turn.status !== 'running' || displayLocal()?.runId !== turn.id}><div class="chat-answer"><RichText doc={parseMarkdown(turn.answer)} /></div></Show>
            <Show when={turn.error}><p class="chat-excluded">{turnProblem(turn.error!)}</p></Show>
            <Show when={writable() && turn.status === 'completed'}><div class="chat-answer-actions"><button class="bar-btn" disabled={busy()} aria-label="Save answer / selection as note" onClick={() => saved(turn)}>Save as note</button><button class="bar-btn" disabled={busy()} aria-label="Branch here" onClick={() => void attempt(() => branchChat(props.card, turn))}>Branch</button><button class="bar-btn" aria-label="Propose to-do list" onClick={() => {
              const selected = selectedAnswer(turn)
              const lines = selected.split('\n').filter((line) => /^\s*(?:[-*+] |\d+[.)] )/.test(line)).map((line) => line.replace(/^\s*(?:[-*+] |\d+[.)] )(?:\[[ xX]\]\s*)?/, '')).join('\n')
              setTaskDraft({ turn, selected, title: 'Next steps', lines })
            }}>Make tasks</button></div></Show>
            <details class="chat-used-context"><summary>Context used · {turn.context.sources.length} sources<Show when={capture() && turn.context.sources.some((s) => capture()!.context.sources.find((v) => v.id === s.id)?.text !== s.text)}> · sources changed or disconnected</Show></summary><ContextText context={turn.context} /><Show when={turn.usage}><p class="chat-size">Provider reported: {turn.usage?.inputTokens ?? '—'} input / {turn.usage?.outputTokens ?? '—'} output tokens</p></Show></details>
          </article>}</For>
          <Show when={displayLocal() && !thread()?.turns.some((t) => t.id === displayLocal()!.runId)}><article class="chat-turn chat-live"><h2>{provider() === 'claude' ? 'Claude' : 'Codex'} · {displayLocal()!.status}</h2><LiveAnswer run={displayLocal()!} /></article></Show>
          <Show when={isTauri && providerInfo()?.state === 'ready' && !providerProblem() && !inputRequest()}><details class="chat-provider-details"><summary>Provider details</summary><p>{providerInfo()?.message} ({providerInfo()?.version})</p><button class="link-btn" onClick={() => void discoverChatProviders()}>Refresh providers</button></details></Show>
          <Show when={inputRequest()} keyed>{(request) => <ProviderQuestions chatId={props.card.id} request={request} focusOnMount={questionFocus} />}</Show>
        </div>
        <Show when={taskDraft()}>{(draft) => <section class="chat-task-draft" aria-label="Task proposal draft"><h2>Propose a to-do list</h2><p class="chat-muted">Review the lines drawn from this answer. Edit as needed, one task per line. Every task starts unchecked, with no owners or deadlines.</p><label>List title<input aria-label="Task list title" value={draft().title} onInput={(e) => setTaskDraft({ ...draft(), title: e.currentTarget.value })} /></label><label>Tasks<textarea aria-label="Proposed tasks" rows={4} value={draft().lines} placeholder="Write one task per line" onInput={(e) => setTaskDraft({ ...draft(), lines: e.currentTarget.value })} /></label><div class="chat-answer-actions"><button class="bar-btn" onClick={() => setTaskDraft(null)}>Cancel</button><button class="bar-btn" disabled={busy() || !draft().lines.trim()} onClick={proposeTasks}>Review on board</button></div></section>}</Show>
        <div class="chat-composer">
          <Show when={!inputRequest()}>
          <Show when={!isTauri} fallback={<Show when={providerProblem() || providerInfo()?.state !== 'ready'}><div class="chat-provider-status"><span>{providerProblem() || providerInfo()?.message || 'Checking local providers…'} <Show when={providerInfo()?.version}>({providerInfo()!.version})</Show></span><button class="link-btn" onClick={() => void discoverChatProviders()}>Refresh providers</button></div></Show>}><p class="chat-muted">Read and organize here. Send messages from the DoggyNote Mac app.</p></Show>
          <textarea ref={compose} aria-label="Message" placeholder={thread()?.turns.length ? 'Ask a follow-up…' : 'Ask about the connected context…'} rows={2} maxLength={CHAT_LIMITS.promptChars} value={draft()} onInput={(e) => editDraft(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!running()) send() } }} disabled={!writable()} />
          </Show>
          <div class="chat-send-row"><span class="chat-muted">{inputRequest() ? 'Waiting for your answer. Stop ends this turn.' : running() ? 'You can keep working on the board.' : '⌘Enter to send'}</span><Show when={local()?.status === 'running'} fallback={<button class="primary-btn" disabled={!isTauri || !writable() || busy() || !!running() || !draft().trim() || !capture() || providerInfo()?.state !== 'ready'} onClick={send}>Send</button>}><button class="bar-btn" onClick={stop}>Stop</button></Show></div>
        </div>
      </section>
      <Show when={showContext()}><aside ref={inspector} class="chat-context" aria-label="Context inspector"><div class="chat-context-tools"><h2>Context for the next message</h2><button class="bar-btn" disabled={busy()} onClick={() => void attempt(refreshContext)}>Refresh context</button></div>
        <Show when={writable()}><button ref={pickerTrigger} class="bar-btn" aria-expanded={picking()} onClick={() => setPicking(!picking())}>Add context</button></Show>
        <Show when={picking()}><fieldset class="chat-picker"><legend>Cards on this board</legend><For each={candidates()}>{(card) => <label><input type="checkbox" checked={included(card.id)} disabled={!writable() || !['note','todo'].includes(card.type)} onChange={(e) => { e.currentTarget.checked ? attachContext(props.card.id, [card.id]) : detachContext(props.card.id, card.id); setCapture(null) }} /><span>{sourceLabel(card)}<Show when={!['note','todo'].includes(card.type)}><small>Only notes and to-do lists are supported</small></Show></span></label>}</For><button class="bar-btn" disabled={busy()} onClick={() => void attempt(async () => { await refreshContext(); setPicking(false); inspector.scrollTop = 0; pickerTrigger.focus({ preventScroll: true }); requestAnimationFrame(() => { resetChatFocusScroll(); if (phone()) frameChat(props.card.id) }) })}>Done · inspect changes</button></fieldset></Show>
        <Show when={capture()} fallback={<p class="chat-muted">Refresh context to inspect what will be sent.</p>}>{(value) => <ContextText context={value().context} />}</Show>
        <details class="chat-context-help"><summary>How context works</summary><p class="chat-muted">Only direct links are included. Earlier messages keep their captured text. Disconnecting a source affects future messages.</p></details>
        <Show when={writable()}><p class="chat-muted">To leave earlier context behind, start a clean conversation.</p><button class="bar-btn" disabled={busy()} onClick={() => void attempt(() => branchChat(props.card))}>Clean conversation</button></Show>
      </aside></Show>
    </div>
  </section>
}
