import { For, Show, createResource, createSignal } from 'solid-js'
import type { Id } from '@doggynote/core'
import { ApiError, api } from '../state/api.ts'
import { syncNow } from '../state/sync.ts'
import { Icon, ToolIcons } from './icons.tsx'

type Share = { token: string; boardId: Id; includeChildren: boolean; createdAt: number }

export const shareUrl = (token: string) => {
  // The desktop app runs on tauri://, so links point at the deployed server.
  const base = (import.meta.env.VITE_API_BASE as string | undefined) || location.origin
  return `${base}/s/${token}`
}

export function ShareButton(props: { boardId: Id }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="zoom">
      <button class="icon-btn" data-testid="share" onClick={() => setOpen(!open())}>
        <Icon>{ToolIcons.share()}</Icon>
        <span class="icon-btn-label">Share</span>
      </button>
      <Show when={open()}>
        <SharePanel boardId={props.boardId} onClose={() => setOpen(false)} />
      </Show>
    </div>
  )
}

function SharePanel(props: { boardId: Id; onClose: () => void }) {
  const [list, { refetch }] = createResource(
    () => props.boardId,
    (id) => api<{ shares: Share[] }>(`/api/shares?boardId=${encodeURIComponent(id)}`).then((r) => r.shares),
  )
  const [includeChildren, setIncludeChildren] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal<string | null>(null)

  async function create() {
    setError(null)
    try {
      await syncNow() // the server needs the board before it can share it
      await api('/api/shares', { method: 'POST', json: { boardId: props.boardId, includeChildren: includeChildren() } })
      void refetch()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Can't reach the server")
    }
  }

  async function revoke(token: string) {
    await api(`/api/shares/${token}`, { method: 'DELETE' })
    void refetch()
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token))
      setCopied(token)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setError('Copy failed. Select the link and copy it.')
    }
  }

  return (
    <div class="menu share-panel" data-testid="share-panel">
      <div class="share-head">
        <strong>View-only links</strong>
        <button class="icon-btn" title="Close" onClick={props.onClose}>
          <Icon size={16}>{ToolIcons.close()}</Icon>
        </button>
      </div>
      <p class="share-sub">Anyone with the link can look, nobody can edit.</p>
      <label class="check">
        <input type="checkbox" data-testid="include-children" checked={includeChildren()} onChange={(e) => setIncludeChildren(e.currentTarget.checked)} />
        Include boards inside this one
      </label>
      <button class="primary-btn" data-testid="create-share" onClick={() => void create()}>
        Create link
      </button>
      <Show when={error()}>
        <p class="form-error">{error()}</p>
      </Show>
      <ul class="share-list">
        <For each={list() ?? []}>
          {(s) => (
            <li data-testid="share-link">
              <input class="share-url" readonly value={shareUrl(s.token)} data-testid="share-url" onFocus={(e) => e.currentTarget.select()} />
              <div class="share-actions">
                <span class="share-meta">{s.includeChildren ? 'with inner boards' : 'this board only'}</span>
                <button class="bar-btn" onClick={() => void copy(s.token)}>
                  {copied() === s.token ? 'Copied!' : 'Copy'}
                </button>
                <button class="bar-btn" data-testid="revoke-share" onClick={() => void revoke(s.token)}>
                  Turn off
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}
