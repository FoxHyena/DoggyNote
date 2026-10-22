import { SheetGrip } from './SheetGrip.tsx'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import * as doc from '../state/doc.ts'
import { lastError, lastSyncAt, pendingCount, pendingUploadsCount, syncNow, syncState } from '../state/sync.ts'
import './sync-status.css'
import { COPY } from '@doggynote/theme'
import { Icon } from './icons.tsx'
import { discardRecovery, downloadRecovery, recoverableChanges } from '../state/recovery.ts'

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
  // A server failure stays put through retries: lastError only clears when a sync lands.
  const serverTrouble = () => !doc.localSaveError() && !!lastError() && syncState() !== 'offline' && syncState() !== 'signed-out'
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
  // The details button says what sync is doing: busy while a run is in flight,
  // then a short "Synced" once it lands, rather than a greyed-out "Sync now".
  // A sync is often quicker than the eye: "Syncing…" holds for a moment so it reads.
  const [held, setHeld] = createSignal(false)
  let heldTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    if (syncState() !== 'syncing') return
    setHeld(true)
    clearTimeout(heldTimer)
    heldTimer = setTimeout(() => setHeld(false), 500)
  })
  const busy = () => syncState() === 'syncing' || held()
  const [justSynced, setJustSynced] = createSignal(false)
  let syncedTimer: ReturnType<typeof setTimeout> | undefined
  createEffect((was: string | undefined) => {
    const now = syncState()
    if (was === 'syncing' && now === 'idle' && open()) {
      setJustSynced(true)
      clearTimeout(syncedTimer)
      syncedTimer = setTimeout(() => setJustSynced(false), 2000)
    } else if (now !== 'idle') setJustSynced(false)
    return now
  })
  const syncButtonState = () => (busy() ? 'syncing' : failure() ? 'retry' : justSynced() ? 'synced' : 'idle')
  const outside = (event: PointerEvent) => {
    if (!(event.target as Element)?.closest('.save-status-wrap')) setOpen(false)
  }
  const escape = (event: KeyboardEvent) => {
    if (open() && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.focus() }
  }
  document.addEventListener('pointerdown', outside)
  window.addEventListener('keydown', escape, true)
  onCleanup(() => { clearTimeout(timer); clearTimeout(syncedTimer); document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', reposition) })
  return <div class="save-status-wrap">
    <button ref={trigger} class="sync-status" classList={{ attention: attention() }} data-testid="sync-status" data-state={visualState()}
      data-sync-state={syncState()} data-pending={pendingCount()} data-uploads={pendingUploadsCount()}
      aria-expanded={open()} aria-label={label() === 'Save status' ? 'Save status' : `Save status: ${label()}`} data-tooltip="Save and sync details"
      onClick={() => { position(); setOpen(!open()); retry() }}>
      <Icon size={16} name={attention() ? failure() || recoverableChanges().length ? 'warning' : 'sync' : 'check'} /><span classList={{ 'save-label-quiet': !attention() }}>{label()}</span>
    </button>
    <Show when={open()}><section class="save-details" style={popupPosition()} role="dialog" aria-label="Save and sync details" data-testid="sync-details"><SheetGrip onDismiss={() => { setOpen(false); trigger.focus() }} />
      <h3>Your changes</h3>
      <p role={failure() ? 'alert' : undefined}>{doc.localSaveError() ?? (serverTrouble() ? COPY.syncSafe : syncState() === 'offline' ? 'Offline. Changes saved on this device will sync when you reconnect.' : syncState() === 'signed-out' ? 'Sign in to resume syncing.' : doc.lastLocalSave() ? 'Saved on this device.' : 'Local storage is ready.')}</p>
      {/* The server's reason is for the curious, not the headline. */}
      <Show when={serverTrouble()}><details class="save-error-detail" data-testid="sync-error-detail"><summary>What happened</summary><p>{lastError()}</p></details></Show>
      <dl><dt>Changes waiting</dt><dd data-testid="pending-changes">{pendingCount()}</dd>
        <dt>Image uploads</dt><dd>{pendingUploadsCount()}</dd>
        <dt>Last synced</dt><dd>{savedAt()}</dd></dl>
      <Show when={recoverableChanges().length}><p>Access changed for {recoverableChanges().length} unsynced item(s). A local recovery copy is available.</p><div class="recovery-actions"><button class="bar-btn" data-testid="download-recovery" aria-label="Download unsynced changes" data-tip="Save a copy of the unsynced edits as a file" onClick={downloadRecovery}>Download</button><button class="bar-btn" data-testid="discard-recovery" data-tip="Remove this notice and the local copy. Undo is available briefly." onClick={() => void discardRecovery()}>Discard</button></div></Show>
      <button class="primary-btn sync-now" data-testid="sync-now" data-state={syncButtonState()} aria-disabled={busy()} onClick={() => { if (!busy()) retry() }}>
        <Show when={syncButtonState() === 'syncing'}><svg class="sync-spinner" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="26 12" stroke-linecap="round" /></svg></Show>
        <Show when={syncButtonState() === 'synced'}><Icon size={14} name="check" /></Show>
        <span>{{ syncing: 'Syncing…', retry: 'Retry', synced: 'Synced', idle: 'Sync now' }[syncButtonState()]}</span>
      </button>
      <p class="save-label-quiet" role="status">{syncButtonState() === 'synced' ? 'Synced' : ''}</p>
    </section></Show>
  </div>
}
