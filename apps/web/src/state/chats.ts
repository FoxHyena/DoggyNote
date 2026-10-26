import { createSignal, type Accessor, type Setter } from 'solid-js'
import { newId, type Connection } from '@doggynote/core'
import type { ChatProvider, ChatThread, ChatTurn, ContextSnapshot } from '@doggynote/core/chat'
import { api, ApiError, isShareViewer } from './api.ts'
import { isTauri } from './platform.ts'
import { user } from './session.ts'
import { canEditBoard, canReadBoard } from './access.ts'
import { boardId, endEdit, select } from './ui.ts'
import { frameChat } from '../canvas/chatViewport.ts'
import { syncNow } from './sync.ts'
import * as doc from './doc.ts'
import * as idb from './idb.ts'

export const [openChatId, setOpenChatId] = createSignal<string | null>(null)
export const [chatMessageTarget, setChatMessageTarget] = createSignal<{ chatId: string; messageId: string } | null>(null)
export const [chatAnnouncement, setChatAnnouncement] = createSignal('')
let signingOut = false
export function openChat(id: string) {
  const card = doc.getCard(id)
  if (!card || !canReadBoard(card.boardId)) return
  endEdit(); select([id])
  setOpenChatId(id)
  frameChat(id)
}
/** Saved-answer links open authorized history; following one never starts local work. */
export function openChatFromLocation() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const id = params.get('chat'), messageId = params.get('message')
  const card = id ? doc.getCard(id) : undefined
  if (card?.type === 'chat' && card.boardId === boardId() && canReadBoard(card.boardId) && !card.purged && !card.deletedAt) {
    setChatMessageTarget(messageId && messageId.length <= 64 ? { chatId: card.id, messageId } : null)
    openChat(card.id)
  }
}
window.addEventListener('hashchange', openChatFromLocation)
export type ProviderStatus = { provider: ChatProvider; state: string; version: string | null; message: string }
export const [chatProviders, setChatProviders] = createSignal<ProviderStatus[]>([])
export const [providerProblem, setProviderProblem] = createSignal('')
export async function discoverChatProviders() {
  if (!isTauri) return
  setProviderProblem('')
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    setChatProviders(await invoke<ProviderStatus[]>('chat_providers'))
  } catch { setProviderProblem('Local providers could not be checked. Update or restart the Mac app, then retry.') }
}
export type Capture = { context: ContextSnapshot; version: string }
/** A measured height may land while a sync push is in flight. Drain that follow-up too. */
export async function syncChatChanges() {
  for (let attempt = 0; attempt < 4; attempt++) {
    await syncNow()
    if (!doc.outboxSize()) return
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  throw new Error('Your local changes are waiting to sync. Reconnect and try again. Your edits are preserved.')
}
export async function inspectChat(id: string): Promise<Capture> {
  await syncChatChanges()
  return api(`/api/chats/${encodeURIComponent(id)}/context`)
}
const threads = new Map<string, [Accessor<ChatThread | null>, Setter<ChatThread | null>]>()
const cacheKey = (chatId: string, owner = user()?.id) => `chat:${owner ?? ''}:${chatId}`
function threadSignal(id: string) {
  const key = cacheKey(id)
  let signal = threads.get(key)
  if (!signal) { signal = createSignal<ChatThread | null>(null); threads.set(key, signal) }
  return signal
}
export const chatThread = (id: string) => threadSignal(id)[0]()
/** Passive board previews use local saved history, with no transcript network fan-out. */
export async function restoreCachedChat(id: string) {
  const owner = user()?.id, card = doc.getCard(id), signal = threadSignal(id)
  if (!owner || !card || signal[0]() || !canReadBoard(card.boardId) || isShareViewer()) return
  const cached = await idb.get<ChatThread>('meta', cacheKey(id, owner))
  if (cached && !signal[0]() && owner === user()?.id && canReadBoard(card.boardId)) signal[1](cached)
}
const draftPrefix = 'doggynote.chatDraft:'
const draftKey = (chatId: string, requestId?: string) => draftPrefix + JSON.stringify([user()?.id, chatId, requestId ?? null])
function readDraft(chatId: string, requestId?: string): unknown {
  if (!user() || isShareViewer()) return null
  try { return JSON.parse(localStorage.getItem(draftKey(chatId, requestId)) ?? 'null') } catch { return null }
}
function writeDraft(chatId: string, value: unknown, requestId?: string) {
  if (!user() || signingOut || isShareViewer()) return true
  try {
    const key = draftKey(chatId, requestId)
    if (value == null || value === '') localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch { return false }
}
export function chatDraft(id: string) { const value = readDraft(id); return typeof value === 'string' && value.length <= 12_000 ? value : '' }
export function saveChatDraft(id: string, value: string) { return writeDraft(id, value) }
export async function loadChat(id: string) {
  const owner = user()?.id, card = doc.getCard(id)
  if (!owner || !card || !canReadBoard(card.boardId) || isShareViewer()) return
  const key = cacheKey(id, owner), signal = threadSignal(id)
  if (!signal[0]()) {
    const cached = await idb.get<ChatThread>('meta', key)
    if (owner === user()?.id && cached) signal[1](cached)
  }
  try {
    const thread = await api<ChatThread>(`/api/chats/${encodeURIComponent(id)}`)
    if (owner !== user()?.id || !canReadBoard(card.boardId)) return
    signal[1](thread)
    await idb.put('meta', key, thread)
  } catch (error) {
    if (error instanceof ApiError && [401,403,404].includes(error.status)) { signal[1](null); await idb.del('meta', key) }
    throw error
  }
}

export function contextLinks(chatId: string): Connection[] {
  const chat = doc.getCard(chatId)
  return chat ? doc.connectionsOn(chat.boardId).filter((l) => l.purpose === 'context' && l.to === chatId) : []
}
export function attachContext(chatId: string, ids: string[]) {
  const chat = doc.getCard(chatId)
  if (!chat || !doc.canWriteObject(chat)) return
  const current = new Set(contextLinks(chatId).map((l) => l.from))
  const links = [...new Set(ids)].filter((id) => !current.has(id) && id !== chatId && doc.getCard(id)?.boardId === chat.boardId).map((from): Connection => ({ id: newId(), kind: 'connection', boardId: chat.boardId, from, to: chatId, purpose: 'context', arrow: 'end', createdAt: Date.now() }))
  doc.commit(links.map(doc.createChange))
}
export function detachContext(chatId: string, sourceId: string) {
  doc.update(Object.fromEntries(contextLinks(chatId).filter((l) => l.from === sourceId).map((l) => [l.id, { purged: true }])))
}

type Begin = { operationId: string; deviceId: string; runKey: string; expectedRevision: number; contextVersion: string; provider: ChatProvider; prompt: string }
export type InputRequest = { id: string; questions: { id: string; header: string; question: string; options?: { label: string; description: string }[] | null; isSecret?: boolean }[] }
export type LocalRun = { runId: string; chatId: string; userId: string; deviceId: string; sequence: number; status: 'running' | 'completed' | 'interrupted' | 'failed'; answer: string; usage: ChatTurn['usage']; error: string | null; inputRequest?: InputRequest | null }
type Binding = { chatId: string; owner: string; begin: Begin; input?: string; snapshot: LocalRun; serverSequence: number; pendingFinal: boolean; lastAuthorizedAt?: number }
const bindings = new Map<string, Binding>()
const runSignals = new Map<string, [Accessor<LocalRun | null>, Setter<LocalRun | null>]>()
function runSignal(id: string) {
  const key = cacheKey(id)
  let signal = runSignals.get(key)
  if (!signal) { signal = createSignal<LocalRun | null>(null); runSignals.set(key, signal) }
  return signal
}
export const localChatRun = (id: string) => runSignal(id)[0]()
const bindingKey = (binding: Binding) => `chat-run:${binding.owner}:${binding.begin.operationId}`
const bindingStorage = new Map<string, Promise<void>>()
function storeBinding(binding: Binding, remove = false) {
  const key = bindingKey(binding)
  const pending = (bindingStorage.get(key) ?? Promise.resolve()).catch(() => {}).then(() => remove ? idb.del('meta', key) : bindings.get(binding.begin.operationId) === binding ? idb.put('meta', key, binding) : undefined)
  bindingStorage.set(key, pending)
  return pending.finally(() => { if (bindingStorage.get(key) === pending) bindingStorage.delete(key) })
}
const saveBinding = (binding: Binding) => storeBinding(binding)
const forgetBinding = (binding: Binding) => storeBinding(binding, true)
let device: string | undefined
function deviceId() {
  if (device) return device
  device = localStorage.getItem('doggynote.chatDevice') ?? newId()
  localStorage.setItem('doggynote.chatDevice', device)
  return device
}
let runtimeStarted = false
let runtimeStarting: Promise<void> | null = null
const saving = new Map<string, Promise<void>>()
const serverWrites = new Map<string, Promise<unknown>>()
async function writeRun<T>(binding: Binding, work: () => Promise<T>): Promise<T> {
  const id = binding.begin.operationId
  const pending = (serverWrites.get(id) ?? Promise.resolve()).catch(() => {}).then(work)
  serverWrites.set(id, pending)
  try { return await pending }
  finally { if (serverWrites.get(id) === pending) serverWrites.delete(id) }
}
const revisionConflict = (error: unknown) => error instanceof ApiError && error.status === 409 && error.message === 'The conversation, context or access changed. Refresh and try again.'
async function postRun<T = unknown>(path: string, json: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await api<T>(path, { method: 'POST', json }) }
    catch (error) {
      // Another board can bump the shared access revision before commit.
      // Reauthorize at the endpoint; denial and expiry are never retried here.
      if (attempt >= 2 || !revisionConflict(error)) throw error
    }
  }
}
function progressRun(binding: Binding) {
  return writeRun(binding, async () => {
    const sequence = ++binding.serverSequence
    // Reserve durably before sending: reload must advance past an unknown outcome.
    await saveBinding(binding)
    const path = `/api/chats/${encodeURIComponent(binding.chatId)}/turns/${binding.begin.operationId}/progress`
    const json = { deviceId: binding.begin.deviceId, runKey: binding.begin.runKey, sequence, answer: binding.snapshot.answer }
    return postRun(path, json)
  })
}
async function persistRun(binding: Binding) {
  const id = binding.begin.operationId
  if (binding.owner !== user()?.id) return
  if (saving.has(id)) return saving.get(id)
  let release!: () => void
  saving.set(id, new Promise<void>((resolve) => { release = resolve }))
  const wasRunning = binding.snapshot.status === 'running'
  try {
    await saveBinding(binding)
    const credentials = { deviceId: binding.begin.deviceId, runKey: binding.begin.runKey }
    const path = `/api/chats/${encodeURIComponent(binding.chatId)}/turns/${encodeURIComponent(id)}`
    if (binding.snapshot.status === 'running') {
      await progressRun(binding)
      binding.lastAuthorizedAt = Date.now()
    } else {
      const allowedErrors = ['provider-unavailable','signed-out','rate-limit','process-failed','invalid-event','interrupted','input-too-large','tool-request']
      const json = { ...credentials, status: binding.snapshot.status, answer: binding.snapshot.answer, usage: binding.snapshot.usage, error: binding.snapshot.error ? allowedErrors.includes(binding.snapshot.error) ? binding.snapshot.error : 'process-failed' : null }
      await writeRun(binding, async () => { try { await postRun(`${path}/finish`, json) }
      catch (error) {
        // Lost leases are recoverable as explicitly interrupted transcripts, never retroactive success.
        if (!(error instanceof ApiError) || error.status !== 409 || error.message !== 'This run has ended. Its partial answer is preserved.') throw error
        await postRun(`${path}/finish`, { ...json, status: 'interrupted', error: 'interrupted' })
      } })
      binding.pendingFinal = false
      setChatAnnouncement('Conversation saved.')
      await loadChat(binding.chatId)
      if (localChatRun(binding.chatId)?.runId === id) runSignal(binding.chatId)[1](null)
      bindings.delete(id)
      await forgetBinding(binding)
    }
  } catch (error) {
    if (error instanceof ApiError && [401,403,404,409].includes(error.status) && !revisionConflict(error) && binding.snapshot.status === 'running') {
      await stopBinding(binding)
    }
    if (binding.pendingFinal) setChatAnnouncement('Answer waiting to finish saving. Reconnect to sync.')
    // Local recovery copy remains until the server acknowledges completion.
  } finally { saving.delete(id); release(); if (wasRunning && binding.pendingFinal) void persistRun(binding) }
}
function acceptNative(snapshot: LocalRun) {
  if (!snapshot || !['runId','chatId','userId','deviceId'].every((key) => typeof snapshot[key as keyof LocalRun] === 'string') || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0 || !['running','completed','interrupted','failed'].includes(snapshot.status) || typeof snapshot.answer !== 'string' || snapshot.answer.length > 60_000) return
  if (snapshot.inputRequest && !validInputRequest(snapshot.inputRequest)) return
  const binding = bindings.get(snapshot.runId)
  if (!binding || binding.owner !== user()?.id || snapshot.userId !== binding.owner || snapshot.chatId !== binding.chatId || snapshot.deviceId !== binding.begin.deviceId || snapshot.sequence <= binding.snapshot.sequence || binding.snapshot.status !== 'running') return
  const previous = binding.snapshot
  if (previous.status !== snapshot.status || previous.inputRequest?.id !== snapshot.inputRequest?.id || previous.sequence < 0) {
    setChatAnnouncement(snapshot.status === 'running' ? snapshot.inputRequest ? 'Conversation needs your answer.' : 'Conversation is running.' : snapshot.status === 'completed' ? 'Answer complete. Finishing saving.' : `Conversation ${snapshot.status}. Its answer may be incomplete.`)
  }
  binding.snapshot = snapshot
  binding.pendingFinal = snapshot.status !== 'running'
  runSignal(binding.chatId)[1](snapshot)
  if (binding.pendingFinal) void persistRun(binding)
}
async function stopBinding(binding: Binding) {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('chat_stop', { runId: binding.begin.operationId, userId: binding.owner, deviceId: binding.begin.deviceId }).catch(() => {})
  if (binding.snapshot.status === 'running') {
    binding.snapshot = { ...binding.snapshot, sequence: binding.snapshot.sequence + 1, status: 'interrupted', error: 'interrupted', inputRequest: null }
    binding.pendingFinal = true
    if (binding.owner === user()?.id) runSignal(binding.chatId)[1](binding.snapshot)
  }
}
export async function stopChat(id: string) {
  const binding = [...bindings.values()].find((b) => b.chatId === id && b.owner === user()?.id)
  if (binding) { await stopBinding(binding); await persistRun(binding) }
}
function validInputRequest(value: InputRequest) {
  const bounded = (text: unknown, max: number) => typeof text === 'string' && text.trim().length > 0 && text.length <= max
  return bounded(value.id, 200) && Array.isArray(value.questions) && value.questions.length > 0 && value.questions.length <= 3 && new Set(value.questions.map((q) => q?.id)).size === value.questions.length && value.questions.every((q) => q && !q.isSecret && bounded(q.id, 128) && bounded(q.header, 80) && bounded(q.question, 2000) && (q.options == null || (Array.isArray(q.options) && q.options.length <= 5 && q.options.every((o) => o && bounded(o.label, 100) && typeof o.description === 'string' && o.description.length <= 300))))
}
export function chatInputDraft(chatId: string, requestId: string): Record<string, string> {
  const value = readDraft(chatId, requestId)
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([key, answer]) => key.length <= 128 && typeof answer === 'string' && answer.length <= 4000)) : {}
}
export function saveChatInputDraft(chatId: string, requestId: string, answers: Record<string, string>) { return writeDraft(chatId, answers, requestId) }
export async function answerChatInput(chatId: string, requestId: string, answers: Record<string, string>) {
  const owner = user()?.id, card = doc.getCard(chatId)
  const binding = [...bindings.values()].find((b) => b.chatId === chatId && b.owner === owner)
  if (!isTauri || !owner || !card || !canEditBoard(card.boardId) || doc.previewing() || !binding || binding.snapshot.status !== 'running' || binding.snapshot.inputRequest?.id !== requestId) throw new Error('This question has ended, or you no longer have edit access.')
  const questions = binding.snapshot.inputRequest.questions
  if (Object.keys(answers).length !== questions.length || questions.some((q) => typeof answers[q.id] !== 'string' || !answers[q.id].trim() || answers[q.id].length > 4000)) throw new Error('Answer each question with at most 4,000 characters.')
  try {
    await progressRun(binding)
  } catch (error) {
    if (error instanceof ApiError && [401,403,404,409].includes(error.status) && !revisionConflict(error)) { await stopBinding(binding); await persistRun(binding) }
    throw error
  }
  if (owner !== user()?.id || binding.snapshot.status !== 'running' || binding.snapshot.inputRequest?.id !== requestId) return
  binding.lastAuthorizedAt = Date.now()
  const { invoke } = await import('@tauri-apps/api/core')
  if (owner !== user()?.id || binding.snapshot.status !== 'running' || binding.snapshot.inputRequest?.id !== requestId) return
  acceptNative(await invoke<LocalRun>('chat_answer', { runId: binding.begin.operationId, userId: owner, deviceId: binding.begin.deviceId, requestId, answers }))
  writeDraft(chatId, null, requestId)
  await saveBinding(binding)
}
/** Global app lifetime, independent of card culling or expanded-view lifetime. Never starts a run. */
export async function startChatRuntime() {
  if (!isTauri || runtimeStarted) return
  if (runtimeStarting) return runtimeStarting
  runtimeStarting = initializeChatRuntime().finally(() => { runtimeStarting = null })
  return runtimeStarting
}
async function initializeChatRuntime() {
  const [{ listen }, { invoke }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core')])
  const unlisten = await listen<LocalRun>('doggynote-chat', (event) => acceptNative(event.payload))
  try {
  const cached = await idb.getAll<unknown>('meta')
  for (const [key, value] of cached) {
    if (!key.startsWith(`chat-run:${user()?.id}:`)) continue
    const binding = value as Binding
    bindings.set(binding.begin.operationId, binding)
    runSignal(binding.chatId)[1](binding.snapshot)
    const snapshot = await invoke<LocalRun | null>('chat_run_snapshot', { runId: binding.begin.operationId, userId: binding.owner, deviceId: binding.begin.deviceId }).catch(() => null)
    if (snapshot) acceptNative(snapshot)
    else {
      binding.snapshot = { ...binding.snapshot, status: 'interrupted', error: 'interrupted', inputRequest: null }
      binding.pendingFinal = true
      runSignal(binding.chatId)[1](binding.snapshot)
    }
    void persistRun(binding)
  }
  setInterval(() => {
    for (const binding of bindings.values()) {
      const card = doc.getCard(binding.chatId)
      if (binding.owner !== user()?.id || !card || !canReadBoard(card.boardId) || (binding.snapshot.status === 'running' && Date.now() - (binding.lastAuthorizedAt ?? 0) > 30_000)) void stopBinding(binding)
      else void persistRun(binding)
    }
  }, 5000)
  runtimeStarted = true
  } catch (error) { unlisten(); throw error }
}
export async function sendChat(chatId: string, prompt: string, provider: ChatProvider, capture: Capture) {
  const owner = user()?.id, card = doc.getCard(chatId)
  if (signingOut) throw new Error('Signing out. This message has not been sent.')
  if (!isTauri) throw new Error('Sending messages requires the DoggyNote Mac app and a local provider.')
  if (!owner || !card || !canEditBoard(card.boardId) || doc.previewing()) throw new Error('You need edit access to send a message.')
  if (!chatProviders().some((p) => p.provider === provider && p.state === 'ready')) throw new Error('Refresh providers and resolve the sign-in or installation issue before sending.')
  await startChatRuntime()
  const prior = [...bindings.values()].find((b) => b.chatId === chatId && b.owner === owner && !b.input && b.snapshot.status === 'running')
  if (localChatRun(chatId)?.status === 'running' && !prior) throw new Error('A turn is already running.')
  await syncChatChanges()
  await loadChat(chatId)
  if (signingOut || owner !== user()?.id) throw new Error('The session changed. This message has not been sent.')
  const runId = prior?.begin.operationId ?? newId()
  const begin: Begin = prior?.begin ?? { operationId: runId, deviceId: deviceId(), runKey: newId().replaceAll('-', '') + newId().replaceAll('-', ''), expectedRevision: chatThread(chatId)?.revision ?? 0, contextVersion: capture.version, provider, prompt: prompt.trim() }
  if (prior && (begin.prompt !== prompt.trim() || begin.provider !== provider)) throw new Error('The previous send has an unknown outcome. Retry the same message or Stop before changing it.')
  const binding: Binding = prior ?? { chatId, owner, begin, snapshot: { runId, chatId, userId: owner, deviceId: begin.deviceId, sequence: -1, status: 'running', answer: '', usage: null, error: null }, serverSequence: 0, pendingFinal: false, lastAuthorizedAt: Date.now() }
  bindings.set(runId, binding)
  await saveBinding(binding)
  runSignal(chatId)[1](binding.snapshot)
  let accepted = false
  try {
    const result = await postRun<{ turn: ChatTurn; input?: string; replay: boolean }>(`/api/chats/${encodeURIComponent(chatId)}/turns`, begin)
    accepted = true
    if (result.turn.status !== 'running') { await loadChat(chatId); bindings.delete(runId); runSignal(chatId)[1](null); await forgetBinding(binding); return }
    if (!result.input) throw new Error('This send was recorded. Stop it and retry in a clean turn.')
    if (binding.snapshot.status !== 'running') { await persistRun(binding); return }
    binding.input = result.input
    await saveBinding(binding)
    // A fresh server permission/lease check immediately precedes explicit native execution.
    await progressRun(binding)
    if (binding.snapshot.status !== 'running') { await persistRun(binding); return }
    binding.lastAuthorizedAt = Date.now()
    const { invoke } = await import('@tauri-apps/api/core')
    if (signingOut || owner !== user()?.id || binding.snapshot.status !== 'running') { await stopBinding(binding); await persistRun(binding); return }
    const snapshot = await invoke<LocalRun>('chat_start', { request: { runId, chatId, userId: owner, deviceId: begin.deviceId, provider, input: result.input } })
    if (binding.snapshot.status !== 'running') await stopBinding(binding)
    else acceptNative(snapshot)
    await loadChat(chatId).catch(async (error) => {
      if (error instanceof ApiError && [401,403,404].includes(error.status)) { await stopBinding(binding); await persistRun(binding) }
    })
  } catch (error) {
    if (accepted) {
      // A late load/start failure must not overwrite an observed terminal turn.
      if (binding.snapshot.status === 'running') {
        binding.snapshot = { ...binding.snapshot, sequence: binding.snapshot.sequence + 1, status: 'failed', error: 'process-failed', inputRequest: null }
        binding.pendingFinal = true
        runSignal(chatId)[1](binding.snapshot)
        await stopBinding(binding)
      }
      if (binding.pendingFinal) await persistRun(binding)
    } else if (error instanceof ApiError) {
      bindings.delete(runId); runSignal(chatId)[1](null); await forgetBinding(binding)
    }
    throw error
  }
}

export async function finishChatRunsBeforeExit() {
  const pending = [...bindings.values()]
  for (const binding of pending) { await stopBinding(binding); await saveBinding(binding) }
  await Promise.race([Promise.allSettled(pending.map(persistRun)), new Promise((resolve) => setTimeout(resolve, 2000))])
}
/** Revoke local execution before credentials or recovery bindings can disappear. */
export async function finishChatRunsBeforeLogout() {
  signingOut = true
  try {
    if (isTauri) {
      await startChatRuntime().catch(() => {})
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('chat_stop_all')
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async () => { await finishChatRunsBeforeExit(); await Promise.all([...bindings.values()].filter((binding) => binding.owner === user()?.id).map(persistRun)) })(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Local work stopped, but its answer is still saving. Reconnect and try signing out again.')), 6000) }),
      ])
    } finally { clearTimeout(timeout) }
    if ([...bindings.values()].some((binding) => binding.owner === user()?.id && binding.pendingFinal && binding.snapshot.answer)) throw new Error('Local work stopped, but its answer is still saving. Reconnect and try signing out again.')
    const owner = user()?.id
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(draftPrefix)) {
        try { if (JSON.parse(key.slice(draftPrefix.length))[0] === owner) localStorage.removeItem(key) } catch { /* not one of our keys */ }
      }
    }
    setChatAnnouncement('')
  } catch (error) {
    signingOut = false
    if (isTauri) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('chat_begin_session').catch(() => {}) }
    throw error
  }
}
