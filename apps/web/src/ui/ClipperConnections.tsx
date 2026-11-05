import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import { api } from '../state/api.ts'
import { installModalKeys } from './agentDialog.ts'
import { Icon } from './icons.tsx'
import { SheetGrip } from './SheetGrip.tsx'
import './agents.css'

type Connection = { id: string; createdAt: number; expiresAt: number; revokedAt: number | null; lastUsedAt: number | null }
export function ClipperConnections(props: { onClose: () => void }) {
  const [list, { refetch }] = createResource(() => api<{ connections: Connection[] }>('/api/clipper-connections'))
  const [error, setError] = createSignal(''), [busy, setBusy] = createSignal(false)
  let scope!: HTMLElement, close!: HTMLButtonElement
  onMount(() => { close.focus(); onCleanup(installModalKeys(scope, props.onClose, close)) })
  async function revoke(id: string) {
    setBusy(true); setError('')
    try { await api(`/api/clipper-connections/${id}`, { method: 'DELETE' }); await refetch() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not revoke connection') }
    finally { setBusy(false) }
  }
  return <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
    <section ref={scope} class="dialog agents-dialog" role="dialog" aria-modal="true" aria-labelledby="clipper-connections-title" data-testid="clipper-connections"><SheetGrip onDismiss={props.onClose} />
      <div class="agents-heading"><h2 id="clipper-connections-title">Chrome connections</h2><button ref={close} class="icon-btn" aria-label="Close" onClick={props.onClose}><Icon name="close" /></button></div>
      <p>Chrome can save images to your boards’ Inboxes. Revoking a connection stops new saves immediately.</p>
      <Show when={error() || list.error}><p role="alert" class="form-error">{error() || 'Could not load connections.'}</p><button class="bar-btn" onClick={() => void refetch()}>Retry</button></Show>
      <Show when={!list.loading} fallback={<p role="status">Loading connections…</p>}>
        <Show when={list()?.connections.length} fallback={<p>No Chrome connections yet. Choose Connect DoggyNote in the extension to get started.</p>}>
          <For each={list()?.connections}>{(connection) => <div class="agents-connection" data-connection-id={connection.id}><div><strong>Chrome · {new Date(connection.createdAt).toLocaleDateString()}</strong><small>{connection.revokedAt ? 'Revoked' : connection.expiresAt < Date.now() ? 'Expired' : `Expires ${new Date(connection.expiresAt).toLocaleDateString()}`}</small><Show when={connection.lastUsedAt}><small>Last used {new Date(connection.lastUsedAt!).toLocaleString()}</small></Show></div><Show when={!connection.revokedAt && connection.expiresAt > Date.now()}><button class="bar-btn" disabled={busy()} onClick={() => void revoke(connection.id)}>Revoke</button></Show></div>}</For>
        </Show>
      </Show>
    </section>
  </div>
}
