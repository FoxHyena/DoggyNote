import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import { boardDisplayTitle } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { boardId } from '../state/ui.ts'
import { decidePreview, exitPreview, frameChanges, preview, previewStep, setPreviewMode, showBoard, type Badge } from '../state/preview.ts'
import { BoardIconSvg, Icon } from './icons.tsx'
import './agents.css'
import './export.css'

// The bar shown while an agent proposal is previewed on the board: what it
// does, Proposed / Current, which board, and Approve / Reject / Exit.

const LABEL: Record<Badge, string> = { added: 'new', changed: 'edited', moved: 'moved', removed: 'buried' }

export function ProposalBanner() {
  const [busy, setBusy] = createSignal<'approve' | 'reject' | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const decide = async (action: 'approve' | 'reject') => {
    setBusy(action)
    setError(null)
    setError(await decidePreview(action))
    setBusy(null)
  }
  let banner: HTMLElement | undefined
  // Opening a preview moves focus to its banner, so the keyboard starts there.
  createEffect(on(() => preview()?.id, (id) => id && queueMicrotask(() => banner?.focus({ preventScroll: true }))))
  onMount(() => {
    const key = (e: KeyboardEvent) => {
      // Escape that closed a popup (it prevents the default) isn't for us.
      if (e.key !== 'Escape' || e.defaultPrevented || !preview() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      exitPreview()
    }
    window.addEventListener('keydown', key, true)
    onCleanup(() => window.removeEventListener('keydown', key, true))
  })
  return (
    <Show when={preview()}>
      {(p) => (
        <section ref={banner} tabindex="-1" class="proposal-banner" role="region" aria-label="Previewing agent proposal" data-testid="proposal-banner">
          <div class="proposal-banner-head">
            <span class="proposal-banner-icon" aria-hidden="true"><BoardIconSvg icon="paw" size={18} /></span>
            <div class="proposal-banner-text">
              <strong class="proposal-banner-title">{p().label}</strong>
              <span class="proposal-banner-counts" data-testid="proposal-counts">
                <For each={(Object.keys(LABEL) as Badge[]).filter((b) => p().counts[b])}>
                  {(b) => <span class={`proposal-count proposal-count-${b}`}>{p().counts[b]} {LABEL[b]}</span>}
                </For>
              </span>
            </div>
            <Show when={previewStep()}>
              {(s) => <span class="proposal-step proposal-step-phone" data-testid="proposal-step-phone">{s().n}/{s().of}</span>}
            </Show>
            <button class="icon-btn proposal-next-icon" data-testid="proposal-next-icon" aria-label="Next change" title="Next change" onClick={() => frameChanges(true)}>
              <Icon name="open" />
            </button>
            <button class="icon-btn proposal-banner-exit" data-testid="proposal-exit" aria-label="Stop previewing" title="Stop previewing (Esc)" onClick={exitPreview}>
              <Icon name="close" />
            </button>
          </div>
          <Show when={p().stale}>
            <p class="proposal-banner-note" role="status">Some of these cards were edited after the agent read them, so approving may be refused.</p>
          </Show>
          <Show when={error()}>
            <p class="proposal-banner-note form-error" role="alert">{error()}</p>
          </Show>
          <div class="proposal-banner-actions">
            <div class="segmented" role="radiogroup" aria-label="Show">
              <button role="radio" aria-checked={p().mode === 'after'} classList={{ on: p().mode === 'after' }} data-testid="proposal-show-after" onClick={() => setPreviewMode('after')}>Proposed</button>
              <button role="radio" aria-checked={p().mode === 'before'} classList={{ on: p().mode === 'before' }} data-testid="proposal-show-before" onClick={() => setPreviewMode('before')}>Current</button>
            </div>
            <Show when={p().boards.length > 1}>
              <select class="proposal-board-select" aria-label="Board" data-testid="proposal-board" value={boardId()} onChange={(e) => showBoard(e.currentTarget.value)}>
                <For each={p().boards}>{(id) => <option value={id}>{boardDisplayTitle(doc.getBoard(id), 'New board')}</option>}</For>
              </select>
            </Show>
            <button class="bar-btn proposal-next" data-testid="proposal-next" onClick={() => frameChanges(true)}>
              Next change
            </button>
            <Show when={previewStep()}>
              {(s) => <span class="proposal-step" data-testid="proposal-step" aria-live="polite">{s().n} of {s().of}</span>}
            </Show>
            <span class="proposal-banner-spacer" />
            <Show when={p().status === 'pending'}>
              <button class="bar-btn" data-testid="proposal-reject" disabled={!!busy()} onClick={() => void decide('reject')}>{busy() === 'reject' ? 'Rejecting…' : 'Reject'}</button>
              <button class="primary-btn" data-testid="proposal-approve" disabled={!!busy()} onClick={() => void decide('approve')}>{busy() === 'approve' ? 'Applying…' : 'Approve'}</button>
            </Show>
          </div>
        </section>
      )}
    </Show>
  )
}
