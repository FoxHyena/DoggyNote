import { For, Show, createSignal, onCleanup, type JSX } from 'solid-js'
import { BUILTIN_TEMPLATES, isAlive, type Board, type BuiltinTemplate } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { canManageBoard } from '../state/access.ts'
import { user } from '../state/session.ts'
import { boardPermissions } from '../state/access.ts'
import { boardId, endEdit } from '../state/ui.ts'
import { copyBoard, openCreatedBoard, useBuiltin } from '../state/duplicates.ts'
import { showToast } from '../state/toast.ts'
import { agentDialogKeys } from './agentDialog.ts'
import { Icon, ToolIcons } from './icons.tsx'
import './templates.css'

export type TemplateMode = 'library' | 'duplicate' | 'save'
export function TemplatesDialog(props: { renderTrigger: (open: (mode: TemplateMode, trigger: HTMLElement) => void) => JSX.Element }) {
  const [mode, setMode] = createSignal<TemplateMode | null>(null)
  const [name, setName] = createSignal('')
  const [choice, setChoice] = createSignal<{ builtin?: BuiltinTemplate; board?: string } | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let returnFocus: HTMLElement | undefined
  let sourceId = ''
  let controller: AbortController | undefined
  const cancelRequest = () => { controller?.abort(); controller = undefined; setBusy(false) }
  const personal = () => Object.values(doc.objs).filter((o): o is Board => o.kind === 'board' && isAlive(o) && typeof o.templateName === 'string' && !!o.templateName.trim() && canManageBoard(o.id) && (boardPermissions().find((b) => b.id === o.id)?.ownerId === user()?.id || doc.localBoardCreations.has(o.id))).sort((a, b) => b.createdAt - a.createdAt)
  const open = (next: TemplateMode, trigger: HTMLElement) => {
    cancelRequest()
    endEdit()
    sourceId = boardId()
    returnFocus = trigger
    setName(next === 'duplicate' ? `${doc.getBoard(sourceId)?.title || 'Untitled board'} copy` : next === 'save' ? doc.getBoard(sourceId)?.title || 'My layout' : '')
    setChoice(null); setError(null); setMode(next)
  }
  const close = () => {
    cancelRequest()
    setMode(null)
    if (returnFocus?.isConnected) returnFocus.focus()
  }
  onCleanup(() => controller?.abort())
  const choose = (value: { builtin?: BuiltinTemplate; board?: string }, title: string) => { setChoice(value); setName(title); setError(null) }
  async function go() {
    if (busy()) return
    const currentMode = mode()
    if (!currentMode) return
    const origin = sourceId
    const selected = choice()
    const title = name().trim()
    if (!title) return setError('Enter a name for the new board.')
    if (currentMode === 'library' && !selected) return setError('Choose a template first.')
    setBusy(true); setError(null)
    const request = new AbortController()
    controller = request
    try {
      const id = currentMode === 'library' && selected?.builtin ? useBuiltin(selected.builtin, title)
        : await copyBoard(selected?.board ?? origin, title, { template: currentMode === 'save', signal: request.signal })
      if (request.signal.aborted || controller !== request) return
      close()
      if (currentMode === 'save') showToast('Layout saved to your personal templates. Discussion stays on the original.', 6000, { label: 'Undo', run: () => doc.undo() })
      else openCreatedBoard(id, origin)
    } catch (e) {
      if (!request.signal.aborted && controller === request) setError(e instanceof Error ? e.message : 'Could not create this board. Your original is safe.')
    } finally { if (controller === request) { controller = undefined; setBusy(false) } }
  }
  const remove = (board: Board) => {
    doc.update({ [board.id]: { deletedAt: Date.now() } })
    if (choice()?.board === board.id) { setChoice(null); setName('') }
    showToast('Saved layout removed.', 5000, { label: 'Undo', run: () => doc.undo() })
  }
  return <>
    {props.renderTrigger(open)}
    <Show when={mode()}>
      <dialog class="dialog template-dialog" role="dialog" aria-modal="true" aria-labelledby="templates-title" data-testid="templates-dialog" ref={(el) => queueMicrotask(() => { if (el.isConnected) el.showModal() })} onCancel={(e) => { e.preventDefault(); close() }} onKeyDown={agentDialogKeys}>
        <header class="template-heading"><h2 id="templates-title">{mode() === 'library' ? 'Start from a template' : mode() === 'save' ? 'Save a personal layout' : 'Duplicate board'}</h2><button class="icon-btn" aria-label="Close templates" onClick={close}><Icon size={18}>{ToolIcons.close()}</Icon></button></header>
        <div class="template-options">
          <p class="template-hint">{mode() === 'save' ? 'Save an independent snapshot of this board and its nested boards for later reuse.' : 'Every creation is independent. Change it freely without changing the original.'} New boards are private. Discussion stays on the original; board shortcuts keep their existing destinations.</p>
          <Show when={mode() === 'library'}>
            <div class="template-grid" aria-label="Starter templates">
              <For each={BUILTIN_TEMPLATES}>{(t) => <button class="template-choice" classList={{ on: choice()?.builtin === t.id }} aria-pressed={choice()?.builtin === t.id} data-testid={`template-${t.id}`} disabled={busy()} onClick={() => choose({ builtin: t.id }, t.name)}><strong>{t.name}</strong><span>{t.description}</span></button>}</For>
            </div>
            <h3>Personal layouts</h3>
            <Show when={personal().length} fallback={<p class="template-hint">Save a board from “More board actions → Save as template” to reuse your own layout here. Empty boards work too.</p>}>
              <div class="personal-templates"><For each={personal()}>{(b) => <div class="personal-template"><button class="template-choice" classList={{ on: choice()?.board === b.id }} aria-pressed={choice()?.board === b.id} data-testid="personal-template" disabled={busy()} onClick={() => choose({ board: b.id }, b.templateName!)}><strong>{b.templateName}</strong><span>Private saved layout</span></button><button class="bar-btn" aria-label={`Remove layout ${b.templateName}`} disabled={busy()} onClick={() => remove(b)}>Remove</button></div>}</For></div>
            </Show>
          </Show>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void go() }}>
          <label class="template-name">{mode() === 'save' ? 'Layout name' : 'New board name'}<input data-testid="template-name" value={name()} maxlength={160} disabled={busy()} required onInput={(e) => setName(e.currentTarget.value)} /></label>
          <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
          <footer class="template-footer"><button type="button" class="bar-btn" onClick={close}>Cancel</button><button type="submit" class="primary-btn" data-testid="create-from-template" disabled={busy() || !name().trim() || (mode() === 'library' && !choice())}>{busy() ? 'Preparing copy…' : mode() === 'save' ? 'Save layout' : mode() === 'duplicate' ? 'Create private copy' : 'Create board'}</button></footer>
          <Show when={busy()}><p class="template-hint" role="status">Checking the complete board tree. You can cancel safely.</p></Show>
        </form>
      </dialog>
    </Show>
  </>
}
