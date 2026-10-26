import { expect, type Page } from '@playwright/test'
import { API_PORT } from './ports.ts'

/** Test-only Tauri stand-in. No fixture transport ships in the application. */
export async function installAgentBridge(page: Page) {
  const response = await page.request.post(`http://localhost:${API_PORT}/api/auth/login`, { data: { username: 'rex', password: 'goodboy123', bearer: true } })
  expect(response.ok()).toBe(true)
  const { token } = await response.json()
  await page.addInitScript(({ token }) => {
    type Snapshot = { runId: string; chatId: string; userId: string; deviceId: string; sequence: number; status: string; answer: string; usage: unknown; error: string | null; inputRequest?: any }
    const w = window as unknown as Record<string, any>
    sessionStorage.setItem('fake-keychain', token)
    const callbacks = new Map<number, (value: unknown) => void>(), listeners = new Map<string, number[]>()
    const saved = JSON.parse(sessionStorage.getItem('agent-fixture') ?? '{"started":[],"stopped":[],"runs":{}}')
    saved.answered ??= []
    saved.chatListens ??= 0
    const persist = () => sessionStorage.setItem('agent-fixture', JSON.stringify(saved))
    const event = (snapshot: Snapshot) => {
      for (const callback of listeners.get('doggynote-chat') ?? []) callbacks.get(callback)?.({ event: 'doggynote-chat', id: callback, payload: snapshot })
    }
    w.__chatFixture = {
      ...saved,
      get chatListens() { return saved.chatListens },
      emit(runId: string, fields: Partial<Snapshot>) {
        const snapshot = { ...saved.runs[runId], sequence: saved.runs[runId].sequence + 1, ...fields }
        if (snapshot.status !== 'running') snapshot.inputRequest = null
        saved.runs[runId] = snapshot; persist(); event(snapshot)
      },
      event,
    }
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    w.__TAURI_INTERNALS__ = {
      transformCallback(fn: (value: unknown) => void) { const id = callbacks.size + 1; callbacks.set(id, fn); return id },
      unregisterCallback(id: number) { callbacks.delete(id) },
      async invoke(command: string, args: Record<string, any> = {}) {
        if (command === 'get_token') return token
        if (command === 'chat_providers') return ['claude', 'codex'].map((provider) => ({ provider, state: 'ready', version: 'browser-fixture', message: 'Test fixture: no real provider process.' }))
        if (command === 'plugin:event|listen') {
          if (args.event === 'doggynote-chat') {
            saved.chatListens++; persist()
            if (sessionStorage.getItem('agent-fail-listen')) { sessionStorage.removeItem('agent-fail-listen'); throw new Error('Synthetic listener failure') }
          }
          listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]); return args.handler
        }
        if (command === 'chat_start') {
          const request = args.request
          if (!saved.runs[request.runId]) {
            saved.started.push(request)
            saved.runs[request.runId] = { runId: request.runId, chatId: request.chatId, userId: request.userId, deviceId: request.deviceId, sequence: 0, status: 'running', answer: '', usage: null, error: null }
            persist()
          }
          return saved.runs[request.runId]
        }
        if (command === 'chat_run_snapshot') {
          const run = saved.runs[args.runId]
          if (run && (run.userId !== args.userId || run.deviceId !== args.deviceId)) throw new Error('Run belongs to another device')
          return run ?? null
        }
        if (command === 'chat_answer') {
          const run = saved.runs[args.runId]
          if (run.userId !== args.userId || run.deviceId !== args.deviceId || run.inputRequest?.id !== args.requestId || run.status !== 'running') throw new Error('Question has ended or belongs to another run')
          saved.answered.push(args); persist()
          const text = run.inputRequest.questions.map((q: any) => `**Codex asks:** ${q.question}\n\n**You:** ${args.answers[q.id]}`).join('\n\n')
          w.__chatFixture.emit(args.runId, { inputRequest: null, answer: `${text}\n\n` })
          if (w.__chatFixture.answerCompletes) {
            w.__chatFixture.emit(args.runId, { inputRequest: null, answer: `${text}\n\nA playful kickoff plan.`, status: 'completed' })
            await new Promise((resolve) => setTimeout(resolve, 500))
            w.__chatFixture.answerReplyFinished = true
          }
          return saved.runs[args.runId]
        }
        if (command === 'chat_begin_session') return null
        if (command === 'chat_stop_all') {
          for (const [id, run] of Object.entries(saved.runs) as [string, Snapshot][]) { if (run.status === 'running') { saved.stopped.push(id); w.__chatFixture.emit(id, { status: 'interrupted', error: 'interrupted' }) } }
          persist(); return null
        }
        if (command === 'chat_stop') {
          saved.stopped.push(args.runId); persist()
          if (saved.runs[args.runId]) w.__chatFixture.emit(args.runId, { status: 'interrupted', error: 'interrupted' })
          return null
        }
        if (command === 'clear_token' || command === 'set_token' || command === 'exit_save_ready' || command === 'finish_exit_save' || command === 'haptic' || command.startsWith('plugin:')) return null
        throw new Error(`Unexpected browser fixture command: ${command}`)
      },
    }
  }, { token })
}
