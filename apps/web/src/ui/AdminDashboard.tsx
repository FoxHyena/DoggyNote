import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { api, ApiError, API_BASE } from '../state/api.ts'
import { user, type User } from '../state/session.ts'
import { Icon, ToolIcons } from './icons.tsx'
import './admin.css'

type Person = User & { createdAt: number }
type Invitation = { id: string; createdAt: number; expiresAt: number; revokedAt?: number; usedAt?: number; acceptedBy?: string }
type Session = { id: string; createdAt: number; expiresAt: number; device: string; current: boolean }
const date = (n: number) => new Date(n).toLocaleString()
const publicUrl = (url: string) => new URL(new URL(url).pathname, API_BASE || location.origin).href

/** Keyboard containment and focus return shared by account dialogs. */
export function useAccountDialog(element: () => HTMLElement, close: () => void) {
  const previous = document.activeElement as HTMLElement | null
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key !== 'Tab') return
    const focusable = Array.from(element().querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]')).filter((el) => el.getClientRects().length)
    const first = focusable[0]; const last = focusable[focusable.length - 1]
    if (!first) return
    if (!element().contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); return }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  onMount(() => { document.addEventListener('keydown', key); element().querySelector<HTMLElement>('button, input')?.focus() })
  onCleanup(() => {
    document.removeEventListener('keydown', key)
    const target = previous?.isConnected && previous !== document.body ? previous : document.querySelector<HTMLElement>('[data-testid="account"]')
    target?.focus()
  })
}

export function AdminDashboard(props: { onClose: () => void }) {
  let panel!: HTMLDivElement
  useAccountDialog(() => panel, props.onClose)
  const [tab, setTab] = createSignal<'people' | 'invitations'>('people')
  const [people, { refetch: refreshPeople }] = createResource(() => api<{ users: Person[] }>('/api/users').then((r) => r.users))
  const [invitations, { refetch: refreshInvitations }] = createResource(() => api<{ invitations: Invitation[] }>('/api/admin/invites').then((r) => r.invitations))
  const [selected, setSelected] = createSignal<Person | null>(null)
  const [sessions, { refetch: refreshSessions }] = createResource(selected, (p) => api<{ sessions: Session[] }>(`/api/users/${p.id}/sessions`).then((r) => r.sessions))
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [isAdmin, setIsAdmin] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [link, setLink] = createSignal<{ url: string; label: string; expiresAt: number } | null>(null)
  const [copied, setCopied] = createSignal(false)

  async function run(fn: () => Promise<void>) {
    if (busy()) return
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reach the server. Try again.') }
    finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link()!.url); setCopied(true) }
    catch { setError('Copy was unavailable. Select and copy the link below.') }
  }
  const status = (i: Invitation) => i.usedAt ? `Accepted${i.acceptedBy ? ` by ${i.acceptedBy}` : ''}` : i.revokedAt ? 'Revoked' : i.expiresAt <= Date.now() ? 'Expired' : 'Pending'

  return <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
    <div ref={panel} class="dialog admin-dashboard" role="dialog" aria-modal="true" aria-labelledby="admin-title" data-testid="people-dialog">
      <header class="dialog-head"><h2 id="admin-title">Admin dashboard</h2><button class="icon-btn" title="Close" onClick={props.onClose}><Icon>{ToolIcons.close()}</Icon></button></header>
      <div class="admin-tabs" role="tablist" aria-label="Administration" onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const next = e.key === 'Home' ? 'people' : e.key === 'End' ? 'invitations' : tab() === 'people' ? 'invitations' : 'people'
        setTab(next); setError(null)
        e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next === 'people' ? 0 : 1]?.focus()
      }}>
        <button class="bar-btn" role="tab" aria-selected={tab() === 'people'} onClick={() => { setTab('people'); setError(null) }}>People</button>
        <button class="bar-btn" role="tab" aria-selected={tab() === 'invitations'} onClick={() => { setTab('invitations'); setError(null) }}>Invitations</button>
      </div>
      <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
      <Show when={link()}>{(l) => <section class="admin-link" aria-label={l().label}>
        <strong>{l().label}</strong><p>Copy this link now. It is shown only once and expires {date(l().expiresAt)}.</p>
        <label>Link<input data-testid="generated-account-link" readOnly value={l().url} onFocus={(e) => e.currentTarget.select()} /></label>
        <div class="admin-actions"><button class="bar-btn" onClick={() => void copy()}>{copied() ? 'Copied' : 'Copy link'}</button><button class="bar-btn" onClick={() => setLink(null)}>Dismiss link</button></div>
      </section>}</Show>
      <Show when={tab() === 'people'}>
        <section role="tabpanel" aria-label="People">
          <p class="admin-help">New people start with private boards. Share a board with them when you are ready.</p>
          <Show when={people.loading}><p role="status">Loading people…</p></Show>
          <Show when={people.error}><p class="form-error" role="alert">Could not load people. <button class="bar-btn" onClick={() => void refreshPeople()}>Try again</button></p></Show>
          <ul class="admin-list"><For each={people.error ? [] : people() ?? []}>{(p) => <li>
            <div><strong>{p.username}</strong><Show when={p.isAdmin}><span class="tag">admin</span></Show><small>Joined {date(p.createdAt)}</small></div>
            <div class="admin-actions"><button class="bar-btn" onClick={() => setSelected(selected()?.id === p.id ? null : p)}>Sessions</button>
              <button class="bar-btn" disabled={busy()} onClick={() => void run(async () => { const r = await api<{ url: string; expiresAt: number }>(`/api/users/${p.id}/recovery`, { method: 'POST', json: {} }); setLink({ ...r, url: publicUrl(r.url), label: `Password reset for ${p.username}` }); setCopied(false) })}>Reset password</button>
              <Show when={p.id !== user()?.id}><button class="bar-btn" disabled={busy()} onClick={() => { if (confirm(`Remove ${p.username}? They will lose account access and be signed out.`)) void run(async () => { await api(`/api/users/${p.id}`, { method: 'DELETE' }); if (selected()?.id === p.id) setSelected(null); await refreshPeople() }) }}>Remove</button></Show>
            </div>
          </li>}</For></ul>
          <Show when={selected()}>{(p) => <section class="admin-sessions" aria-label={`Sessions for ${p().username}`}>
            <h3>Sessions for {p().username}</h3><p>Revoking all access also disconnects their agents. Reset links disconnect all devices and agents when used.</p>
            <Show when={sessions.loading}><p role="status">Loading sessions…</p></Show><Show when={sessions.error}><p role="alert">Could not load sessions. <button class="bar-btn" onClick={() => void refreshSessions()}>Try again</button></p></Show>
            <Show when={!sessions.loading && !sessions.error && sessions()?.length === 0}><p>No active sessions.</p></Show>
            <ul class="admin-list"><For each={sessions.error || sessions.loading ? [] : sessions() ?? []}>{(s) => <li><div><strong>{s.current ? 'This device' : 'Signed-in device'}</strong><small class="admin-device">{s.device || 'Unknown device'}</small><small>Signed in {date(s.createdAt)}</small></div><button class="bar-btn" disabled={busy()} onClick={() => { if (confirm(`Sign out ${s.current ? 'this device' : 'this device session'}?`)) void run(async () => { await api(`/api/users/${p().id}/sessions/${s.id}`, { method: 'DELETE' }); if (s.current) location.assign('/'); else await refreshSessions() }) }}>Revoke session</button></li>}</For></ul>
            <button class="danger-btn" disabled={busy()} onClick={() => { if (confirm(`Sign ${p().username} out of every device and disconnect all their agents?`)) void run(async () => { await api(`/api/users/${p().id}/sessions`, { method: 'DELETE' }); if (p().id === user()?.id) location.assign('/'); else await refreshSessions() }) }}>Revoke all device and agent access</button>
          </section>}</Show>
          <form class="admin-add" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/users', { method: 'POST', json: { username: username().trim(), password: password(), isAdmin: isAdmin() } }); setUsername(''); setPassword(''); setIsAdmin(false); await refreshPeople() }) }}>
            <h3>Create an account directly</h3><p>For an easier handoff, create an invitation instead so they choose their own password.</p>
            <label>Username<input placeholder="username" data-testid="new-username" autocomplete="off" value={username()} onInput={(e) => setUsername(e.currentTarget.value)} required minLength={2} maxLength={32} pattern="[a-zA-Z0-9_.-]+" /></label>
            <label>Password<input placeholder="password (8+)" type="password" data-testid="new-password" autocomplete="new-password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} required minLength={8} maxLength={200} /></label>
            <label class="check"><input type="checkbox" checked={isAdmin()} onChange={(e) => setIsAdmin(e.currentTarget.checked)} /> Admin</label><button class="primary-btn" type="submit" disabled={busy()} data-testid="add-person">{busy() ? 'Saving…' : 'Add'}</button>
          </form>
        </section>
      </Show>
      <Show when={tab() === 'invitations'}><section role="tabpanel" aria-label="Invitations">
        <p class="admin-help">Single-use invitations expire after seven days. New accounts start private.</p>
        <button class="primary-btn" disabled={busy()} onClick={() => void run(async () => { const r = await api<{ url: string; invitation: Invitation }>('/api/admin/invites', { method: 'POST', json: {} }); setLink({ url: publicUrl(r.url), expiresAt: r.invitation.expiresAt, label: 'Account invitation' }); setCopied(false); await refreshInvitations() })}>Create invitation</button>
        <Show when={invitations.loading}><p role="status">Loading invitations…</p></Show><Show when={invitations.error}><p role="alert">Could not load invitations. <button class="bar-btn" onClick={() => void refreshInvitations()}>Try again</button></p></Show>
        <Show when={!invitations.loading && !invitations.error && invitations()?.length === 0}><p>No invitations yet.</p></Show>
        <ul class="admin-list"><For each={invitations.error ? [] : invitations() ?? []}>{(i) => <li data-testid="account-invitation"><div><strong>{status(i)}</strong><small>Created {date(i.createdAt)}</small><small>Expires {date(i.expiresAt)}</small></div><Show when={status(i) === 'Pending'}><button class="bar-btn" disabled={busy()} onClick={() => { if (confirm('Revoke this invitation? It will no longer allow signup.')) void run(async () => { await api(`/api/admin/invites/${i.id}`, { method: 'DELETE' }); await refreshInvitations() }) }}>Revoke invitation</button></Show></li>}</For></ul>
      </section></Show>
    </div>
  </div>
}
