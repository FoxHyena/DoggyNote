import { Show, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js'
import { normalizeDisplayName } from '@doggynote/core'
import { api, ApiError } from '../state/api.ts'
import { updateProfile, user, type User } from '../state/session.ts'
import { showToast } from '../state/toast.ts'
import { installModalKeys } from './agentDialog.ts'
import { Icon } from './icons.tsx'
import { SheetGrip } from './SheetGrip.tsx'
import './profile.css'

export function ProfileEditor(props: { onClose: () => void }) {
  const me = user()!
  const [draft, setDraft] = createSignal(me.displayName ?? '')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const titleId = createUniqueId(), hintId = createUniqueId(), errorId = createUniqueId()
  let panel!: HTMLElement, input!: HTMLInputElement
  let active = true
  const close = () => { if (!busy()) props.onClose() }
  onMount(() => {
    input.focus({ preventScroll: true })
    onCleanup(installModalKeys(panel, close, input))
  })
  onCleanup(() => { active = false })
  async function save(event: SubmitEvent) {
    event.preventDefault()
    if (busy()) return
    const displayName = normalizeDisplayName(draft())
    if (displayName === undefined) { setError('Use a single line of up to 64 characters.'); return }
    setBusy(true); setError('')
    try {
      const result = await api<{ user: User }>('/api/me/profile', { method: 'PATCH', json: { displayName } })
      updateProfile(result.user)
      if (active) { showToast('Profile updated.'); props.onClose() }
    } catch (error) {
      if (active) setError(error instanceof ApiError ? error.message : 'Could not save your profile. Check your connection and try again.')
    } finally { if (active) setBusy(false) }
  }
  return <div class="dialog-backdrop profile-backdrop" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) close() }}>
    <section ref={panel} class="dialog profile-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="profile-editor" onKeyDown={e => e.stopPropagation()}>
      <SheetGrip onDismiss={close} disabled={busy()} />
      <header class="dialog-head"><h2 id={titleId}>Edit profile</h2><button type="button" class="icon-btn" aria-label="Close edit profile" disabled={busy()} onClick={close}><Icon name="close" /></button></header>
      <form onSubmit={event => void save(event)} aria-busy={busy()}>
        <div class="profile-fields">
          <label>Display name<input ref={input} name="displayName" autocomplete="nickname" maxLength={64} value={draft()} disabled={busy()} placeholder={me.username} aria-describedby={`${hintId}${error() ? ` ${errorId}` : ''}`} aria-invalid={!!error()} onInput={e => { setDraft(e.currentTarget.value); setError('') }} /></label>
          <p id={hintId} class="profile-hint">This is the name other people see. Leave it empty to use your username.</p>
          <label>Username<input name="username" value={`@${me.username}`} readOnly /></label>
          <Show when={error()}><p id={errorId} class="form-error" role="alert">{error()}</p></Show>
        </div>
        <footer class="profile-actions"><button type="button" class="bar-btn" disabled={busy()} onClick={close}>Cancel</button><button type="submit" class="primary-btn" disabled={busy() || normalizeDisplayName(draft()) === (me.displayName ?? null)}>{busy() ? 'Saving…' : 'Save'}</button></footer>
      </form>
    </section>
  </div>
}
