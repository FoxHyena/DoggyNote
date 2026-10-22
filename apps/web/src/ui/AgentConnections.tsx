import { SheetGrip } from './SheetGrip.tsx'
import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import { api, API_BASE } from '../state/api.ts'
import { refreshAccess } from '../state/access.ts'
import { Icon } from './icons.tsx'
import { agentDialogKeys } from './agentDialog.ts'
import './agents.css'

type Connection = { id: string; name: string; mode: 'read' | 'propose'; boardIds: string[]; expiresAt: number; revokedAt: number | null; lastUsedAt: number | null }
type BoardOption = { id: string; label: string; canEdit: boolean }

export function AgentConnections(props: { onClose: () => void }) {
  const [connections, { refetch }] = createResource(async () => {
    await refreshAccess()
    const [list, scope] = await Promise.all([api<{ connections: Connection[] }>('/api/agent-connections'), api<{ boards: BoardOption[] }>('/api/agent-connection-boards')])
    return { connections: list.connections, boards: scope.boards }
  })
  const values = () => connections.error ? [] : connections()?.connections
  const boards = () => connections.error ? [] : connections()?.boards ?? []
  const [name, setName] = createSignal(''), [mode, setMode] = createSignal<'read' | 'propose'>('propose')
  const [selected, setSelected] = createSignal<string[]>([]), [secret, setSecret] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal<string | null>(null), [copied, setCopied] = createSignal(false)
  let first!: HTMLInputElement
  onMount(() => {
    first.focus()
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose() } }
    window.addEventListener('keydown', escape, true)
    onCleanup(() => window.removeEventListener('keydown', escape, true))
  })
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); await refetch() } catch (e) { setError(e instanceof Error ? e.message : 'Could not update connections') } finally { setBusy(false) }
  }
  function create(e: SubmitEvent) {
    e.preventDefault()
    void action(async () => {
      const result = await api<{ token: string }>('/api/agent-connections', { method: 'POST', json: { name: name(), mode: mode(), boardIds: selected(), expiresInDays: 90 } })
      setSecret(result.token); setCopied(false); setName('')
    })
  }
  return <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
    <section class="dialog agents-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-connections-title" data-testid="agent-connections" onKeyDown={agentDialogKeys}><SheetGrip onDismiss={props.onClose} />
      <div class="agents-heading"><h2 id="agent-connections-title">Agent connections</h2><button class="icon-btn" title="Close" onClick={props.onClose}><Icon name="close" /></button></div>
      <p>Connect a local agent app to selected boards. Changes wait for your approval inside DoggyNote.</p>
      <Show when={error() || connections.error}><p class="form-error" role="alert">{error() ?? 'Could not load connections. Check your connection and try again.'}</p><button class="icon-btn" onClick={() => void action(async () => {})}>Retry</button></Show>
      <Show when={secret()}><div class="agents-secret" data-testid="agent-secret"><strong>Copy your connection token</strong><p>This token is shown once. Keep it in your agent app’s environment settings.</p><textarea readOnly aria-label="Agent connection token" value={secret()!} rows={2} ref={(el) => queueMicrotask(() => { el.focus(); el.select(); el.scrollIntoView({ block: 'nearest' }) })} /><button class="primary-btn" onClick={async () => { try { await navigator.clipboard.writeText(secret()!); setCopied(true) } catch { setError('Select and copy the token above.') } }}>{copied() ? 'Copied' : 'Copy token'}</button><button class="menu-item" onClick={() => setSecret(null)}>Done</button></div></Show>
      <form onSubmit={create} class="agents-form">
        <label>Connection name<input ref={first} required maxLength={80} value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="My local agent" /></label>
        <label>Access<select value={mode()} onChange={(e) => { setMode(e.currentTarget.value as 'read' | 'propose'); setSelected([]) }}><option value="propose">Read and propose changes</option><option value="read">Read only</option></select></label>
        <fieldset><legend>Boards and their nested boards</legend><p class="agents-hint">Choose only the boards this agent needs. Your {COPY.unsorted} is included only when selected.</p><div class="agents-board-options"><For each={boards().filter((b) => mode() === 'read' || b.canEdit)}>{(b) => <label><input type="checkbox" checked={selected().includes(b.id)} onChange={(e) => setSelected(e.currentTarget.checked ? [...selected(), b.id] : selected().filter((id) => id !== b.id))} />{boardDisplayTitle({ id: b.id, title: b.label })}</label>}</For></div></fieldset>
        <p class="agents-hint">Expires after 90 days. Revoking a connection stops access immediately.</p>
        <button class="primary-btn" disabled={busy() || !name().trim() || !selected().length} type="submit">{busy() ? 'Creating…' : 'Create connection'}</button>
      </form>
      <h3>Your connections</h3>
      <Show when={!connections.loading} fallback={<p>Loading connections…</p>}><Show when={values()?.length} fallback={<p class="agents-hint">No agent connections yet.</p>}><For each={values()}>{(connection) => <div class="agents-connection"><div><strong>{connection.name}</strong><small>{connection.revokedAt ? 'Revoked' : connection.expiresAt <= Date.now() ? 'Expired' : `${connection.mode === 'read' ? 'Read only' : 'Proposals'} · expires ${new Date(connection.expiresAt).toLocaleDateString()}`}</small></div><Show when={!connection.revokedAt && connection.expiresAt > Date.now()}><button class="icon-btn" disabled={busy()} onClick={() => void action(async () => { await api(`/api/agent-connections/${connection.id}`, { method: 'DELETE' }) })}>Revoke</button></Show></div>}</For></Show></Show>
      <details class="agents-setup"><summary>Local setup</summary><p>Run the DoggyNote MCP adapter from your checked-out app folder. Set these environment variables in the MCP client:</p><pre>{`DOGGYNOTE_URL=${API_BASE || location.origin}\nDOGGYNOTE_TOKEN=<your connection token>`}</pre><p>The connector uses stdio and never approves its own proposals. See <code>docs/mcp-setup.md</code> for the command and configuration.</p></details>
    </section>
  </div>
}
