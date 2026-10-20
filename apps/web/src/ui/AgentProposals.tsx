import { For, Show, createEffect, createResource, createSignal, on, onCleanup, onMount, type Accessor, type JSX } from 'solid-js'
import { cardLabel, type Card, type Obj } from '@doggynote/core'
import { boardDisplayTitle } from '@doggynote/theme'
import { api } from '../state/api.ts'
import { openPreview, proposalsChanged, type Badge, type ProposalDetail } from '../state/preview.ts'
import { showToast } from '../state/toast.ts'
import { syncNow } from '../state/sync.ts'
import { endEdit } from '../state/ui.ts'
import * as doc from '../state/doc.ts'
import { BoardIconSvg, Icon, ToolIcons } from './icons.tsx'
import { agentDialogKeys } from './agentDialog.ts'
import './agents.css'

type Summary = { id: string; label: string; status: string; count: number; createdAt: number }
type Detail = ProposalDetail
export type ProposalTrigger = { open: (returnFocus?: HTMLElement) => void; isOpen: Accessor<boolean>; pending: Accessor<number> }
export function AgentProposals(props: { boardId: string; renderTrigger?: (controls: ProposalTrigger) => JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  let returnFocus: HTMLElement | undefined
  const [list, { refetch }] = createResource(() => props.boardId, (id) => api<{ proposals: Summary[] }>(`/api/agent-proposals?boardId=${encodeURIComponent(id)}`).then((r) => r.proposals))
  // A failed poll keeps the last good list, so the button doesn't blink out of the top bar.
  const [last, setLast] = createSignal(new Map<string, Summary[]>())
  createEffect(() => { if (list.state === 'ready') { const id = props.boardId, v = list.latest ?? []; setLast((m) => new Map(m).set(id, v)) } })
  const values = () => last().get(props.boardId) ?? []
  const refresh = async () => { try { await refetch() } catch { /* The last good list stays; the dialog shows a retry. */ } }
  createEffect(on(proposalsChanged, () => void refresh(), { defer: true }))
  onMount(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 10_000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    onCleanup(() => { clearInterval(timer); window.removeEventListener('focus', focus) })
  })
  const pending = () => values().filter((p) => p.status === 'pending').length
  const show = (target?: HTMLElement) => {
    returnFocus = target ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
    endEdit()
    // One change waiting: straight to seeing it on the board.
    const waiting = values().filter((p) => p.status === 'pending')
    if (target?.dataset.testid === 'review-changes' && waiting.length === 1) return void preview(waiting[0].id)
    setOpen(true); void syncNow().then(refresh)
  }
  const close = () => { setOpen(false); queueMicrotask(() => { if (returnFocus?.isConnected) returnFocus.focus() }) }
  const preview = async (id: string) => {
    setOpen(false)
    try { await openPreview(id) } catch { showToast('That proposal could not be loaded. Check your connection and try again.') }
  }
  return <>{props.renderTrigger ? props.renderTrigger({ open: show, isOpen: open, pending }) : <button class="icon-btn" data-testid="agent-proposals" title="Review agent proposals" aria-haspopup="dialog" aria-expanded={open()} onClick={(e) => show(e.currentTarget)}><BoardIconSvg icon="paw" size={18} /><span class="icon-btn-label">Agent proposals{pending() ? ` (${pending()})` : ''}</span></button>}<Show when={open()}><ProposalPanel proposals={values()} loading={list.loading} failed={!!list.error} onRefresh={refresh} onClose={close} onPreview={(id) => void preview(id)} /></Show></>
}

const VERB: Record<Badge, string> = { added: 'New', changed: 'Edited', moved: 'Moved', removed: 'Buried' }

/** One line per change, in plain words: "New · note · Snack budget". */
function describe(change: Detail['proposal']['changes'][number], titleOf: (id: string) => string): { badge: Badge | null; text: string } {
  const after = change.after as Obj
  const badge: Badge | null = after.deletedAt || after.purged ? 'removed' : !change.before ? 'added' : 'changed'
  if (after.kind === 'card') {
    const moved = change.before && ['x', 'y', 'columnId', 'order', 'boardId'].some((k) => JSON.stringify((change.before as Record<string, unknown>)[k]) !== JSON.stringify((after as unknown as Record<string, unknown>)[k]))
    const edited = change.before && JSON.stringify((change.before as { content?: unknown }).content) !== JSON.stringify((after as Card).content)
    return { badge: badge === 'changed' && moved && !edited ? 'moved' : badge, text: `${after.type} · ${cardLabel(after as Card, titleOf)}` }
  }
  if (after.kind === 'board') return { badge, text: `board · ${boardDisplayTitle(after, 'Untitled board')}` }
  if (after.kind === 'connection') return { badge, text: 'connection' }
  return { badge, text: after.kind }
}

function ProposalPanel(props: { proposals: Summary[]; loading: boolean; failed: boolean; onRefresh: () => Promise<void>; onClose: () => void; onPreview: (id: string) => void }) {
  const [selected, setSelected] = createSignal<string | null>(null)
  const [detail, { refetch }] = createResource(selected, (id) => api<Detail>(`/api/agent-proposals/${id}`))
  const detailValue = () => detail.error ? undefined : detail.latest
  const retryDetail = async () => { try { await refetch() } catch { /* Keep the failed preview retryable. */ } }
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal<string | null>(null)
  let panel!: HTMLElement
  onMount(() => {
    panel.querySelector<HTMLButtonElement>('button')?.focus()
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose() } }
    window.addEventListener('keydown', escape, true)
    onCleanup(() => window.removeEventListener('keydown', escape, true))
  })
  // With one proposal there's nothing to choose (the list may arrive after opening).
  createEffect(() => { if (!selected() && props.proposals.length === 1) setSelected(props.proposals[0].id) })
  const titleOf = (objects: Obj[]) => (id: string) => boardDisplayTitle((objects.find((o) => o.id === id && o.kind === 'board') as { id: string; title?: string } | undefined) ?? doc.getBoard(id), 'Board')
  async function decide(action: 'approve' | 'reject' | 'reverse') {
    if (!selected() || busy()) return
    setBusy(true); setError(null)
    try {
      if (action !== 'reject') { endEdit(); await syncNow(); if (doc.outboxSize()) throw new Error('Your local edits are still waiting to sync. Reconnect and try again.') }
      await api(`/api/agent-proposals/${selected()}/${action}`, { method: 'POST', json: {} })
      if (action !== 'reject') await syncNow()
      await props.onRefresh(); await refetch()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update this proposal') } finally { setBusy(false) }
  }
  return <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy() && props.onClose()}>
    <section ref={panel} class="dialog agents-dialog agents-review" role="dialog" aria-modal="true" aria-labelledby="agent-proposals-title" data-testid="agent-review" onKeyDown={agentDialogKeys}>
      <div class="agents-heading"><h2 id="agent-proposals-title">Agent proposals</h2><button class="icon-btn" title="Close" onClick={props.onClose}><Icon>{ToolIcons.close()}</Icon></button></div>
      <p>Agents can only suggest changes. Preview one on the board to see it exactly as it would look, then approve or reject it.</p>
      <Show when={props.failed}><p role="alert" class="form-error">Could not refresh the list. Showing what was last loaded.</p></Show>
      <div class="agents-review-layout"><nav aria-label="Proposals" class="agents-proposal-list"><button class="icon-btn" onClick={() => void props.onRefresh()}>Refresh</button><Show when={props.proposals.length} fallback={<p>{props.loading ? 'Loading…' : 'No proposals for this board yet.'}</p>}><For each={props.proposals}>{(p) => <button class="agents-proposal-choice" classList={{ on: selected() === p.id }} onClick={() => { setSelected(p.id); setError(null) }}><strong>{p.label}</strong><small>{p.status} · {p.count} {p.count === 1 ? 'change' : 'changes'}</small></button>}</For></Show></nav>
        <div class="agents-proposal-detail"><Show when={selected()} fallback={<p class="agents-hint">Select a proposal to see what it changes.</p>}><Show when={detailValue()} fallback={<div><p>{detail.error ? 'This proposal could not be loaded. Check your connection and retry.' : 'Loading…'}</p><Show when={detail.error}><button class="icon-btn" onClick={() => void retryDetail()}>Retry</button></Show></div>}>{(d) => <>
          <h3>{d().proposal.label}</h3><p class="agents-hint">{d().proposal.changes.length} {d().proposal.changes.length === 1 ? 'change' : 'changes'} · {d().proposal.status}</p>
          <ul class="agents-change-list" data-testid="agent-change-list"><For each={d().proposal.changes}>{(c) => { const line = describe(c, titleOf(d().after as Obj[])); return <li><Show when={line.badge}><span class={`proposal-count proposal-count-${line.badge}`}>{VERB[line.badge!]}</span></Show><span>{line.text}</span></li> }}</For></ul>
          <Show when={d().proposal.status !== 'reversed'}><button class={d().proposal.status === 'pending' ? 'primary-btn agents-preview-button' : 'icon-btn agents-preview-button'} data-testid="preview-on-board" onClick={() => props.onPreview(d().proposal.id)}>Preview on the board</button></Show>
          <details class="agents-changes"><summary>Technical details</summary><For each={d().proposal.changes}>{(c) => <div><strong>{c.before ? c.after.deletedAt || c.after.purged ? 'Remove' : 'Update' : 'Create'} {c.after.kind === 'card' ? c.after.type : c.after.kind}</strong><pre>{JSON.stringify(c.after, null, 2)}</pre></div>}</For></details>
          <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
          <div class="agents-decisions"><Show when={d().proposal.status === 'pending'}><button class="icon-btn" disabled={busy()} onClick={() => void decide('reject')}>Reject</button><button class="icon-btn" data-testid="approve-agent-proposal" disabled={busy()} onClick={() => void decide('approve')}>{busy() ? 'Applying…' : 'Approve without previewing'}</button></Show><Show when={d().proposal.status === 'applied'}><button class="icon-btn" data-testid="reverse-agent-proposal" disabled={busy()} onClick={() => void decide('reverse')}>Reverse these changes</button><span class="agents-hint">Available while affected objects have no newer edits.</span></Show></div>
        </>}</Show></Show></div>
      </div>
    </section>
  </div>
}
