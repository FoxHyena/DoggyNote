import './canvas-entry.css'
import { Match, Show, Switch, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { api, ApiError } from '../state/api.ts'
import { acceptSession, type User } from '../state/session.ts'
import { isTauri } from '../state/platform.ts'
import { createTheme } from '../theme.ts'
import { BoardIconSvg } from './icons.tsx'
import './admin.css'

type LinkInfo = { expiresAt?: number; username?: string; boardId?: string; allowSignup?: boolean; permission?: string }

/** Public invitation and password-recovery entrypoint. No editor loads before redemption. */
export function Signup(props: { token?: string; boardToken?: string; mode?: 'signup' | 'reset' }) {
  createTheme()
  const reset = () => props.mode === 'reset'
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [confirmPassword, setConfirmPassword] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [done, setDone] = createSignal(false)
  const [info, { refetch }] = createResource(async () => {
    if (props.boardToken) {
      const data = await api<LinkInfo>(`/api/share/${encodeURIComponent(props.boardToken)}`)
      if (data.permission !== 'edit' || !data.allowSignup) throw new ApiError(410, 'This board link does not allow account creation. Ask the owner for an account invitation.')
      return data
    }
    return api<LinkInfo>(`/api/auth/${reset() ? 'recovery' : 'invite'}/${encodeURIComponent(props.token ?? '')}`)
  })
  onMount(() => {
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.append(meta)
    onCleanup(() => meta.remove())
  })

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    if (busy()) return
    if (password() !== confirmPassword()) { setError('The passwords do not match.'); return }
    setBusy(true); setError(null)
    try {
      if (reset()) {
        await api('/api/auth/reset', { method: 'POST', json: { token: props.token, password: password() } })
        setPassword(''); setConfirmPassword(''); setDone(true)
        history.replaceState(null, '', '/reset/complete')
      } else {
        const result = await api<{ user: User; token?: string; boardId?: string }>('/api/auth/signup', { method: 'POST', json: { token: props.token, boardToken: props.boardToken, username: username().trim(), password: password(), bearer: isTauri } })
        await acceptSession(result)
        location.assign(result.boardId ? `/#/b/${encodeURIComponent(result.boardId)}` : '/')
      }
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reach the server. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  return <div class="login"><div class="login-card" data-testid="account-link-page">
    <div class="login-logo"><BoardIconSvg icon="paw" size={34} /></div>
    <h1>{COPY.appName}</h1>
    <Switch>
      <Match when={info.loading}><p role="status">Checking your link…</p></Match>
      <Match when={info.error}>
        <h2>Link unavailable</h2><p class="form-error" role="alert">{info.error instanceof ApiError ? info.error.message : 'Could not check this link. Check your connection and try again.'}</p>
        <div class="account-link-actions"><button class="bar-btn" onClick={() => void refetch()}>Try again</button><a href="/">Sign in</a></div>
      </Match>
      <Match when={done()}><h2>Password updated</h2><p class="account-link-note">Every device and agent has been disconnected. Sign in with your new password.</p><div class="account-link-actions"><a class="primary-btn" href="/">Sign in</a></div></Match>
      <Match when={info()}>
        <h2>{reset() ? 'Choose a new password' : `Join ${COPY.appName}`}</h2>
        <p class="account-link-note">{reset() ? `Reset the password for ${info()?.username ?? 'your account'}. This signs out every device and agent.` : props.boardToken ? 'Create an account to edit this shared board. Your other boards start private.' : 'Choose your own username and password. Your boards start private.'}</p>
        <form onSubmit={submit} data-testid={reset() ? 'reset-form' : 'signup-form'}>
          <Show when={!reset()}><label>Username<input name="username" autocomplete="username" autocapitalize="off" required minLength={2} maxLength={32} pattern="[a-zA-Z0-9_.-]+" value={username()} onInput={(e) => setUsername(e.currentTarget.value)} ref={(el) => queueMicrotask(() => el.focus())} /></label></Show>
          <label>{reset() ? 'New password' : 'Password'}<input name="password" type="password" ref={(el) => reset() && queueMicrotask(() => el.focus())} autocomplete="new-password" required minLength={8} maxLength={200} value={password()} onInput={(e) => setPassword(e.currentTarget.value)} /></label>
          <label>Confirm password<input name="confirm-password" type="password" autocomplete="new-password" required minLength={8} maxLength={200} value={confirmPassword()} onInput={(e) => setConfirmPassword(e.currentTarget.value)} /></label>
          <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
          <button class="primary-btn" type="submit" disabled={busy()}>{busy() ? 'Saving…' : reset() ? 'Update password' : 'Create account'}</button>
        </form>
        <Show when={!reset()}><p class="account-link-note">Already have an account? <a href={props.boardToken ? `/?join=${encodeURIComponent(props.boardToken)}` : '/'}>Sign in</a>.</p></Show>
      </Match>
    </Switch>
  </div></div>
}
