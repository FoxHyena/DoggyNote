import { Show, createSignal } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { login, type User } from '../state/session.ts'
import { ApiError } from '../state/api.ts'
import { BoardIconSvg } from './icons.tsx'

export function Login(props: { onLogin: (u: User) => void }) {
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      props.onLogin(await login(username().trim(), password()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach the server. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="login">
      <form class="login-card" onSubmit={submit} data-testid="login-form">
        <div class="login-logo">
          <BoardIconSvg icon="paw" size={34} />
        </div>
        <h1>{COPY.appName}</h1>
        <p class="login-sub">Sign in to fetch your boards.</p>
        <label>
          Username
          <input name="username" ref={(el) => queueMicrotask(() => el.focus())} autocomplete="username" autocapitalize="off" required value={username()} onInput={(e) => setUsername(e.currentTarget.value)} />
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required value={password()} onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        <Show when={error()}>
          <p class="form-error" role="alert" data-testid="login-error">
            {error()}
          </p>
        </Show>
        <button class="primary-btn" type="submit" disabled={busy()}>
          {busy() ? COPY.loading : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
