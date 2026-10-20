import './canvas-entry.css'
import { Match, Show, Switch, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { api, ApiError } from '../state/api.ts'
import { checkSession, user } from '../state/session.ts'
import { createTheme } from '../theme.ts'
import { Login } from './Login.tsx'
import { Signup } from './Signup.tsx'
import { BoardIconSvg } from './icons.tsx'
import './sharing.css'

type Invitation = { permission: string; boardId: string; title: string; allowSignup: boolean; includeChildren: boolean; expiresAt: number }
export function EditInvite(props: { token: string }) {
  createTheme()
  const [signup, setSignup] = createSignal(false)
  const [signedIn, setSignedIn] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [info, { refetch }] = createResource(async () => {
    const value = await api<Invitation>(`/api/share/${encodeURIComponent(props.token)}`)
    if (value.permission !== 'edit') throw new ApiError(404, 'This is not an editing invitation.')
    await checkSession()
    setSignedIn(!!user())
    return value
  })
  onMount(() => {
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.append(meta)
    onCleanup(() => meta.remove())
  })
  async function accept() {
    setBusy(true); setError(null)
    try {
      const result = await api<{ boardId: string }>(`/api/shares/${encodeURIComponent(props.token)}/accept`, { method: 'POST', json: {} })
      location.assign(`/#/b/${encodeURIComponent(result.boardId)}`)
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reach the server. Try again when you are online.') }
    finally { setBusy(false) }
  }
  return <Switch>
    <Match when={signup()}><Signup boardToken={props.token} /></Match>
    <Match when={!info.loading && !info.error && info() && !signedIn()}>
      <Login onLogin={() => setSignedIn(true)} introduction={<div class="login-invitation"><h2>Join “{info()?.title}”</h2><p>Sign in to edit this board. Your personal boards stay private.</p><Show when={info()?.allowSignup}><button type="button" class="bar-btn" onClick={() => setSignup(true)}>Create an account</button></Show></div>} />
    </Match>
    <Match when={true}><div class="login"><div class="login-card" data-testid="edit-invitation">
      <div class="login-logo"><BoardIconSvg icon="paw" size={34} /></div>
      <Switch>
        <Match when={info.loading}><p role="status">Checking your invitation…</p></Match>
        <Match when={info.error}><h1>Invitation unavailable</h1><p class="form-error" role="alert">{info.error instanceof ApiError ? info.error.message : 'Could not check this invitation. Check your connection.'}</p><button class="bar-btn" onClick={() => void refetch()}>Try again</button><a href="/">My boards</a></Match>
        <Match when={info()}><h1>Join “{info()?.title}”</h1><p>You will be able to edit this board{info()?.includeChildren ? ' and the boards inside it' : ''}.</p><p class="share-sub">Signed in as {user()?.username}. This invitation can be accepted until {new Date(info()!.expiresAt).toLocaleDateString()}.</p><Show when={error()}><p class="form-error" role="alert">{error()}</p></Show><button class="primary-btn" disabled={busy()} onClick={() => void accept()}>{busy() ? 'Joining…' : 'Join board'}</button><a href="/">My boards</a></Match>
      </Switch>
    </div></div></Match>
  </Switch>
}
