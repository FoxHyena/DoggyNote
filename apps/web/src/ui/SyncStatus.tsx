import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import * as doc from '../state/doc.ts'
import { lastError, lastSyncAt, pendingCount, pendingUploadsCount, syncNow, syncState } from '../state/sync.ts'
import './sync-status.css'
import { Icon, ToolIcons } from './icons.tsx'
import { downloadRecovery, recoverableChanges } from '../state/recovery.ts'

/** Network activity is deliberately separate from the quiet save-status control. */
export function SyncStatus() {
  const [open, setOpen] = createSignal(false)
  const [slow, setSlow] = createSignal(false)
  let shownAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const activeWork = createMemo(() => syncState() === 'syncing' && (pendingCount() > 0 || pendingUploadsCount() > 0))
  createEffect(() => {
    const active = activeWork()
    clearTimeout(timer)
    if (active) {
      if (!slow()) timer = setTimeout(() => { shownAt = Date.now(); setSlow(true) }, 1000)
    } else if (slow()) {
      timer = setTimeout(() => setSlow(false), Math.max(0, 500 - (Date.now() - shownAt)))
    }
  })
  const failure = () => doc.localSaveError() || (['offline', 'error', 'signed-out'].includes(syncState()) ? syncState() : null)
  const visualState = () => failure() ? (doc.localSaveError() ? 'error' : syncState()) : slow() ? 'syncing' : 'idle'
  const label = () => doc.localSaveError() ? 'Save problem' : syncState() === 'offline' ? 'Offline' : syncState() === 'error' ? 'Sync problem' : syncState() === 'signed-out' ? 'Signed out' : recoverableChanges().length ? 'Review edits' : slow() ? 'Syncing…' : 'Save status'
  const savedAt = () => lastSyncAt() ? new Date(lastSyncAt()!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet'
  const attention = () => !!failure() || slow() || recoverableChanges().length > 0
  const [popupPosition, setPopupPosition] = createSignal({ left: '16px', top: '48px' })
  let trigger!: HTMLButtonElement
  const position = () => { const rect = trigger.getBoundingClientRect(); setPopupPosition({ left: `${Math.max(16, Math.min(rect.left, window.innerWidth - 316))}px`, top: `${rect.bottom + 10}px` }) }
  const reposition = () => { if (open()) position() }
  window.addEventListener('resize', reposition)
  const retry = () => void syncNow()
  const outside = (event: PointerEvent) => {
    if (!(event.target as Element)?.closest('.save-status-wrap')) setOpen(false)
  }
  const escape = (event: KeyboardEvent) => {
    if (open() && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.focus() }
  }
  document.addEventListener('pointerdown', outside)
  window.addEventListener('keydown', escape, true)
  onCleanup(() => { clearTimeout(timer); document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', reposition) })
  return <div class="save-status-wrap">
    <button ref={trigger} class="sync-status" classList={{ attention: attention() }} data-testid="sync-status" data-state={visualState()}
      data-sync-state={syncState()} data-pending={pendingCount()} data-uploads={pendingUploadsCount()}
      aria-expanded={open()} aria-label={`Save status: ${label()}`} data-tooltip="Save and sync details"
      onClick={() => { position(); setOpen(!open()); retry() }}>
      <Show when={attention()} fallback={<Icon size={16}>{ToolIcons.check()}</Icon>}><Icon size={16}><Show when={failure() || recoverableChanges().length} fallback={<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 6" />}><path d="M12 3 2 21h20ZM12 9v5M12 17v.5" /></Show></Icon></Show><span classList={{ 'save-label-quiet': !attention() }}>{label()}</span>
    </button>
    <Show when={open()}><section class="save-details" style={popupPosition()} role="dialog" aria-label="Save and sync details" data-testid="sync-details">
      <h3>Your changes</h3>
      <p role={failure() ? 'alert' : undefined}>{doc.localSaveError() ?? lastError() ?? (syncState() === 'offline' ? 'Offline. Changes saved on this device will sync when you reconnect.' : syncState() === 'signed-out' ? 'Sign in to resume syncing.' : doc.lastLocalSave() ? 'Saved on this device.' : 'Local storage is ready.')}</p>
      <dl><dt>Changes waiting</dt><dd data-testid="pending-changes">{pendingCount()}</dd>
        <dt>Image uploads</dt><dd>{pendingUploadsCount()}</dd>
        <dt>Last synced</dt><dd>{savedAt()}</dd></dl>
      <Show when={recoverableChanges().length}><p>Access changed for {recoverableChanges().length} unsynced item(s). A local recovery copy is available.</p><button class="bar-btn" data-testid="download-recovery" onClick={downloadRecovery}>Download unsynced changes</button></Show>
      <button class="primary-btn" data-testid="sync-now" onClick={retry} disabled={syncState() === 'syncing'}>{failure() ? 'Retry' : 'Sync now'}</button>
    </section></Show>
  </div>
}
