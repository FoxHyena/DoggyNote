import { Show, createSignal, onMount } from 'solid-js'
import { CLIPPER_REDIRECT } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import { api } from '../state/api.ts'
import { checkSession, user } from '../state/session.ts'
import { createTheme } from '../theme.ts'
import { Login } from './Login.tsx'
import { Icon } from './icons.tsx'

export function ClipperConnect() {
  createTheme()
  const params = new URLSearchParams(location.search)
  const challenge = params.get('challenge') ?? '', state = params.get('state') ?? '', redirectUri = params.get('redirect_uri') ?? ''
  const valid = /^[A-Za-z0-9_-]{43}$/.test(challenge) && /^[A-Za-z0-9_-]{43}$/.test(state) && redirectUri === CLIPPER_REDIRECT
  const [phase, setPhase] = createSignal<'checking' | 'login' | 'ready'>('checking')
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal('')
  onMount(async () => { setPhase(await checkSession() === 'ok' ? 'ready' : 'login') })
  async function approve() {
    if (!valid || busy()) return
    setBusy(true); setError('')
    try {
      const result = await api<{ redirect: string }>('/api/clipper/authorize', { method: 'POST', json: { challenge, state, redirectUri } })
      if (new URL(result.redirect).origin !== new URL(CLIPPER_REDIRECT).origin) throw new Error('Invalid connection callback')
      location.assign(result.redirect)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect'); setBusy(false) }
  }
  function cancel() {
    const url = new URL(CLIPPER_REDIRECT)
    url.searchParams.set('error', 'access_denied'); url.searchParams.set('state', state)
    location.assign(url)
  }
  return <Show when={valid} fallback={<main class="clipper-connect"><h1>Connection request unavailable</h1><p>Open the Chrome extension and choose Connect DoggyNote again.</p><a href="/">Open {COPY.appName}</a></main>}>
    <Show when={phase() !== 'login'} fallback={<Login onLogin={() => setPhase('ready')} />}>
      <main class="clipper-connect">
        <Icon name="paw" size={40} />
        <h1>Connect Chrome to {COPY.appName}</h1>
        <Show when={phase() === 'ready'} fallback={<p role="status">Checking your account…</p>}>
          <p>Signed in as <strong>{user()?.username}</strong></p>
          <p>The extension can list boards you can edit and save images to their Inboxes. It cannot read your cards or change your canvas.</p>
          <p>You can revoke this connection in Account → Chrome connections. It expires after 90 days.</p>
          <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
          <div class="clipper-connect-actions"><button class="bar-btn" disabled={busy()} onClick={cancel}>Cancel</button><button class="primary-btn" disabled={busy()} onClick={() => void approve()}>{busy() ? 'Connecting…' : 'Connect Chrome'}</button></div>
        </Show>
      </main>
    </Show>
  </Show>
}
