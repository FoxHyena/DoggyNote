import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import type { Id } from '@doggynote/core'
import { boardDisplayTitle } from '@doggynote/theme'
import { ApiError, api } from '../state/api.ts'
import { canManageBoard, refreshAccess, boardPermissions } from '../state/access.ts'
import { syncNow } from '../state/sync.ts'
import * as doc from '../state/doc.ts'
import { Icon, ToolIcons } from './icons.tsx'
import { agentDialogKeys } from './agentDialog.ts'
import './sharing.css'

type Share = { token: string; boardId: Id; includeChildren: boolean; permission: 'view' | 'edit'; createdAt: number; expiresAt: number | null; allowSignup: boolean; scopeVersion: number }
type Member = { id: string; userId: string; username: string; permission: 'view' | 'edit'; viaLink: boolean }
type Sharing = { shares: Share[]; members: Member[]; ownerId: string | null; legacy: boolean }
export const shareUrl = (token: string, permission: 'view' | 'edit' = 'view') => {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) || location.origin
  return `${base}/${permission === 'edit' ? 'join' : 's'}/${token}`
}
export function ShareButton(props: { boardId: Id }) {
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement
  let trigger!: HTMLButtonElement
  const close = (restoreFocus = true) => { setOpen(false); if (restoreFocus) queueMicrotask(() => trigger?.isConnected && trigger.focus()) }
  onMount(() => {
    const outside = (event: PointerEvent) => { if (open() && !root.contains(event.target as Node)) close(false) }
    window.addEventListener('pointerdown', outside)
    onCleanup(() => window.removeEventListener('pointerdown', outside))
  })
  return <Show when={canManageBoard(props.boardId)}>
    <div class="zoom" ref={root}><button ref={trigger} class="icon-btn" data-testid="share" aria-label="Share board" aria-haspopup="dialog" aria-expanded={open()} onClick={() => open() ? close() : setOpen(true)}><Icon>{ToolIcons.share()}</Icon><span class="icon-btn-label">Share</span></button>
      <Show when={open()}><SharePanel boardId={props.boardId} onClose={() => close()} /></Show>
    </div>
  </Show>
}
function SharePanel(props: { boardId: Id; onClose: () => void }) {
  const [list, { refetch }] = createResource(() => props.boardId, async (id) => {
    await syncNow()
    return api<Sharing>(`/api/shares?boardId=${encodeURIComponent(id)}`)
  })
  const sharing = () => list.error ? undefined : list()
  const [permission, setPermission] = createSignal<'view' | 'edit'>('view')
  const [includeChildren, setIncludeChildren] = createSignal(true)
  const [allowSignup, setAllowSignup] = createSignal(false)
  const [username, setUsername] = createSignal('')
  const [memberPermission, setMemberPermission] = createSignal<'view' | 'edit'>('edit')
  const [error, setError] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const parent = () => boardPermissions().find((b) => b.id === props.boardId)?.parentId
  let panel!: HTMLDivElement
  onMount(() => {
    const position = () => {
      const anchor = panel.parentElement!.getBoundingClientRect()
      const width = panel.getBoundingClientRect().width
      const top = Math.min(anchor.bottom + 4, window.innerHeight - 120)
      panel.style.position = 'fixed'
      panel.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`
      panel.style.top = `${Math.max(12, top)}px`
      panel.style.right = 'auto'
      panel.style.maxHeight = `${window.innerHeight - Math.max(12, top) - 12}px`
    }
    position()
    panel.querySelector<HTMLButtonElement>('button')?.focus()
    window.addEventListener('resize', position)
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose() } }
    window.addEventListener('keydown', escape, true)
    onCleanup(() => { window.removeEventListener('keydown', escape, true); window.removeEventListener('resize', position) })
  })
  async function action(fn: () => Promise<unknown>) {
    if (busy()) return
    setBusy(true); setError(null)
    try { await fn(); await refreshAccess(); await refetch() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reach the server. Check your connection and try again.') }
    finally { setBusy(false) }
  }
  async function create() {
    await action(async () => {
      await syncNow()
      await api('/api/shares', { method: 'POST', json: { boardId: props.boardId, includeChildren: includeChildren(), permission: permission(), allowSignup: allowSignup() } })
    })
  }
  async function addMember(e: SubmitEvent) {
    e.preventDefault()
    await action(async () => { await api(`/api/boards/${encodeURIComponent(props.boardId)}/members`, { method: 'POST', json: { username: username().trim(), permission: memberPermission(), includeChildren: includeChildren() } }); setUsername('') })
  }
  async function copy(s: Share) {
    try { await navigator.clipboard.writeText(shareUrl(s.token, s.permission)); setCopied(s.token); setTimeout(() => setCopied(null), 1500) }
    catch { setError('Copy failed. Select the link and copy it.') }
  }
  return <div ref={panel} class="menu share-panel" data-testid="share-panel" role="dialog" aria-label="Board sharing" onKeyDown={agentDialogKeys}>
    <div class="share-head"><strong>Share board</strong><button class="icon-btn" aria-label="Close sharing" onClick={props.onClose}><Icon size={16}>{ToolIcons.close()}</Icon></button></div>
    <p class="share-sub">{sharing()?.legacy ? 'Shared space members already have editing access. Admins manage its invitations.' : 'Private until you invite someone. Only you and admins manage sharing.'}</p>
    <Show when={parent() && parent() !== `home:${sharing()?.ownerId}`}><p class="share-sub">People with inherited access from “{boardDisplayTitle(doc.getBoard(parent()), 'the parent board')}” keep that access. Manage it on the parent board.</p></Show>
    <label class="check"><input type="checkbox" data-testid="include-children" checked={includeChildren()} onChange={(e) => setIncludeChildren(e.currentTarget.checked)} />Include boards inside this one</label>
    <strong>Invite by username</strong>
    <form class="share-user-form" onSubmit={addMember} data-testid="share-member-form">
      <input aria-label="Username to invite" placeholder="Username" value={username()} required minLength={2} maxLength={32} onInput={(e) => setUsername(e.currentTarget.value)} />
      <select aria-label="Member permission" value={memberPermission()} onChange={(e) => setMemberPermission(e.currentTarget.value as 'view' | 'edit')}><option value="edit">Can edit</option><option value="view">View only</option></select>
      <button class="bar-btn" type="submit" disabled={busy()}>Invite</button>
    </form>
    <ul class="share-members"><For each={sharing()?.members ?? []}>{(m) => <li data-testid="share-member"><span>{m.username}<br /><small>{m.permission === 'edit' ? 'Can edit' : 'View only'}{m.viaLink ? ' · via invitation link' : ''}</small></span><button class="bar-btn" disabled={busy()} aria-label={`Remove access for ${m.username}`} onClick={() => void action(() => api(`/api/boards/${encodeURIComponent(props.boardId)}/members/${encodeURIComponent(m.id)}`, { method: 'DELETE' }))}>Remove</button></li>}</For></ul>
    <strong>Invite by link</strong>
    <div class="share-tabs" aria-label="Link permission"><button class="bar-btn" type="button" aria-pressed={permission() === 'view'} onClick={() => setPermission('view')}>View only</button><button class="bar-btn" type="button" data-testid="edit-link-option" aria-pressed={permission() === 'edit'} onClick={() => setPermission('edit')}>Can edit</button></div>
    <p class="share-sub">{permission() === 'view' ? 'Anyone with this link can look without signing in.' : 'Sign-in required. This invitation can be accepted for 7 days; access continues until removed.'}</p>
    <Show when={permission() === 'edit'}><label class="check"><input type="checkbox" data-testid="share-allow-signup" checked={allowSignup()} onChange={(e) => setAllowSignup(e.currentTarget.checked)} />Allow new accounts through this link</label><p class="share-sub">Leave this off to invite existing accounts only.</p></Show>
    <button class="primary-btn" data-testid="create-share" disabled={busy()} onClick={() => void create()}>{busy() ? 'Saving…' : sharing()?.shares.length ? 'New link' : 'Create link'}</button>
    <Show when={error() || list.error}><p class="form-error" role="alert">{error() || (list.error instanceof ApiError ? list.error.message : 'Could not load sharing. Try again when online.')}</p><Show when={list.error}><button class="bar-btn" onClick={() => void refetch()}>Retry loading sharing</button></Show></Show>
    <Show when={list.loading}><p class="share-sub" role="status">Loading sharing…</p></Show>
    <ul class="share-list"><For each={sharing()?.shares ?? []}>{(s) => <li data-testid="share-link">
      <input class="share-url" readonly aria-label={`${s.permission === 'edit' ? 'Editing' : 'View-only'} link`} value={shareUrl(s.token, s.permission)} data-testid="share-url" onFocus={(e) => e.currentTarget.select()} />
      <div class="share-actions"><span class="share-meta">{s.permission === 'edit' ? 'Can edit' : 'View only'} · {s.includeChildren ? 'with inner boards' : 'this board only'}</span><button class="bar-btn" onClick={() => void copy(s)}>{copied() === s.token ? 'Copied!' : 'Copy'}</button><button class="bar-btn" data-testid="revoke-share" disabled={busy()} onClick={() => void action(() => api(`/api/shares/${encodeURIComponent(s.token)}`, { method: 'DELETE' }))}>Turn off</button></div>
      <Show when={s.expiresAt}><span class="share-expiry">{s.expiresAt! <= Date.now() ? 'Expired for new recipients' : `Accept by ${new Date(s.expiresAt!).toLocaleDateString()}`}{s.allowSignup ? ' · Account creation allowed' : ''}</span></Show>
      <Show when={s.permission === 'view' && s.scopeVersion === 0}><p class="share-sub">Legacy link: includes referenced boards. Create a new link to share only this board and its nested boards.</p></Show>
    </li>}</For></ul>
    <p class="share-sub">Turning a link off removes access granted through it. Previously downloaded copies cannot be recalled.</p>
  </div>
}
