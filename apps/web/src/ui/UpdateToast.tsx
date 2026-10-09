import { Show, createSignal } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { APP_VERSION, applyUpdate, pendingUpdate, updateRequired } from '../state/updates.ts'

export function UpdateToast() {
  const [busy, setBusy] = createSignal(false)
  const [dismissed, setDismissed] = createSignal<string | null>(null)
  const go = async () => {
    setBusy(true)
    try {
      await applyUpdate()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Show when={updateRequired()}>
        <div class="dialog-backdrop" data-testid="update-required">
          <div class="dialog update-required">
            <h2>Time for a new collar</h2>
            <p>
              This version of {COPY.appName} ({APP_VERSION}) is too old for the server. Update to keep syncing; your
              notes are safe.
            </p>
            <button class="primary-btn" disabled={busy()} onClick={() => void go()}>
              {pendingUpdate()?.kind === 'desktop' ? 'Restart to update' : 'Reload'}
            </button>
          </div>
        </div>
      </Show>
      <Show when={!updateRequired() && pendingUpdate() && dismissed() !== pendingUpdate()!.version}>
        <div class="update-toast" role="status" data-testid="update-toast">
          <span aria-hidden="true">🦴</span>
          <span>
            {pendingUpdate()!.kind === 'desktop' ? 'A fresh bone is ready' : `${COPY.appName} was updated`} ·{' '}
            <strong>v{pendingUpdate()!.version}</strong>
          </span>
          <button class="primary-btn" data-testid="apply-update" disabled={busy()} onClick={() => void go()}>
            {pendingUpdate()!.kind === 'desktop' ? 'Restart' : 'Reload'}
          </button>
          <button class="icon-btn" title="Later" onClick={() => setDismissed(pendingUpdate()!.version)}>
            ✕
          </button>
        </div>
      </Show>
    </>
  )
}
