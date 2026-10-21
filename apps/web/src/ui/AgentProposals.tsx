import { For, Show, createMemo, createResource, createSignal, onCleanup, onMount, type Accessor, type JSX } from 'solid-js'
import type { AgentChange, AgentObject } from '@doggynote/core/agent'
import { StickerImage } from './StickerImage.tsx'
import { stickerBounds, stickerHeight, usableSticker, parseMarkdown } from '@doggynote/core'
import { boardDisplayTitle, cardColor } from '@doggynote/theme'
import { RichText } from '../editor/RichText.tsx'
import { api, assetUrl } from '../state/api.ts'
import { syncNow } from '../state/sync.ts'
import { endEdit } from '../state/ui.ts'
import * as doc from '../state/doc.ts'
import { BoardIconSvg, Icon, ToolIcons } from './icons.tsx'
import { agentDialogKeys } from './agentDialog.ts'
import './agents.css'

type Summary = { id: string; label: string; status: string; count: number; createdAt: number }
type Detail = { proposal: { id: string; label: string; status: string; changes: AgentChange[] }; before: AgentObject[]; after: AgentObject[] }
export type ProposalTrigger = { open: (returnFocus?: HTMLElement) => void; isOpen: Accessor<boolean>; pending: Accessor<number> }
export function AgentProposals(props: { boardId: string; renderTrigger?: (controls: ProposalTrigger) => JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  let returnFocus: HTMLElement | undefined
  const [list, { refetch }] = createResource(() => props.boardId, (id) => api<{ proposals: Summary[] }>(`/api/agent-proposals?boardId=${encodeURIComponent(id)}`).then((r) => r.proposals))
  const values = () => list.error ? [] : list()
  const refresh = async () => { try { await refetch() } catch { /* The resource error renders a retry state. */ } }
  onMount(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 10_000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    onCleanup(() => { clearInterval(timer); window.removeEventListener('focus', focus) })
  })
  const pending = () => values()?.filter((p) => p.status === 'pending').length ?? 0
  const show = (target?: HTMLElement) => {
    returnFocus = target ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
    endEdit(); setOpen(true); void syncNow().then(refresh)
  }
  const close = () => { setOpen(false); queueMicrotask(() => { if (returnFocus?.isConnected) returnFocus.focus() }) }
  return <>{props.renderTrigger ? props.renderTrigger({ open: show, isOpen: open, pending }) : <button class="icon-btn" data-testid="agent-proposals" title="Review agent proposals" aria-haspopup="dialog" aria-expanded={open()} onClick={(e) => show(e.currentTarget)}><BoardIconSvg icon="paw" size={18} /><span class="icon-btn-label">Agent proposals{pending() ? ` (${pending()})` : ''}</span></button>}<Show when={open()}><ProposalPanel proposals={values() ?? []} loading={list.loading} failed={!!list.error} onRefresh={refresh} onClose={close} /></Show></>
}
function ProposalPanel(props: { proposals: Summary[]; loading: boolean; failed: boolean; onRefresh: () => Promise<void>; onClose: () => void }) {
  const [selected, setSelected] = createSignal<string | null>(null)
  const [detail, { refetch }] = createResource(selected, (id) => api<Detail>(`/api/agent-proposals/${id}`))
  const detailValue = () => detail.error ? undefined : detail()
  const retryDetail = async () => { try { await refetch() } catch { /* Keep the failed preview retryable. */ } }
  const [view, setView] = createSignal<'before' | 'after'>('after'), [board, setBoard] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal<string | null>(null)
  let panel!: HTMLElement
  const boards = createMemo(() => (detailValue()?.after ?? []).filter((o) => o.kind === 'board'))
  const currentBoard = () => board() && boards().some((b) => b.id === board()) ? board()! : boards()[0]?.id
  onMount(() => {
    panel.querySelector<HTMLButtonElement>('button')?.focus()
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose() } }
    window.addEventListener('keydown', escape, true)
    onCleanup(() => window.removeEventListener('keydown', escape, true))
  })
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
      <p>Review the content and layout before applying a change. Your live board stays unchanged during preview.</p>
      <Show when={props.failed}><p role="alert" class="form-error">Could not load proposals.</p></Show>
      <div class="agents-review-layout"><nav aria-label="Proposals" class="agents-proposal-list"><button class="icon-btn" onClick={() => void props.onRefresh()}>Refresh</button><Show when={props.proposals.length} fallback={<p>{props.loading ? 'Loading…' : 'No proposals for this board yet.'}</p>}><For each={props.proposals}>{(p) => <button class="agents-proposal-choice" classList={{ on: selected() === p.id }} onClick={() => { setSelected(p.id); setBoard(null); setError(null); setView('after') }}><strong>{p.label}</strong><small>{p.status} · {p.count} objects</small></button>}</For></Show></nav>
        <div class="agents-proposal-detail"><Show when={selected()} fallback={<p class="agents-hint">Select a proposal to inspect its changes.</p>}><Show when={detailValue()} fallback={<div><p>{detail.error ? 'This proposal could not be loaded. Check your connection and retry.' : 'Loading preview…'}</p><Show when={detail.error}><button class="icon-btn" onClick={() => void retryDetail()}>Retry preview</button></Show></div>}>{(d) => <>
          <h3>{d().proposal.label}</h3><p class="agents-hint">{d().proposal.changes.length} objects · {d().proposal.status}</p>
          <div class="agents-preview-controls"><button class="icon-btn" aria-pressed={view() === 'before'} onClick={() => setView('before')}>Current board</button><button class="icon-btn" aria-pressed={view() === 'after'} onClick={() => setView('after')}>Proposed board</button><label>Preview board<select value={currentBoard()} onChange={(e) => setBoard(e.currentTarget.value)}><For each={boards()}>{(b) => <option value={b.id}>{boardDisplayTitle(b, 'Untitled board')}</option>}</For></select></label></div>
          <AgentBoardPreview objects={d()[view()]} boardId={currentBoard()} />
          <details class="agents-changes"><summary>Inspect {d().proposal.changes.length} changes</summary><For each={d().proposal.changes}>{(c) => <div><strong>{c.before ? c.after.deletedAt || c.after.purged ? 'Remove' : 'Update' : 'Create'} {c.after.kind === 'card' ? c.after.type : c.after.kind}</strong><pre>{JSON.stringify(c.after, null, 2)}</pre></div>}</For></details>
          <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
          <div class="agents-decisions"><Show when={d().proposal.status === 'pending'}><button class="icon-btn" disabled={busy()} onClick={() => void decide('reject')}>Reject</button><button class="primary-btn" data-testid="approve-agent-proposal" disabled={busy()} onClick={() => void decide('approve')}>{busy() ? 'Applying…' : 'Approve changes'}</button></Show><Show when={d().proposal.status === 'applied'}><button class="icon-btn" data-testid="reverse-agent-proposal" disabled={busy()} onClick={() => void decide('reverse')}>Reverse these changes</button><span class="agents-hint">Available while affected objects have no newer edits.</span></Show></div>
        </>}</Show></Show></div>
      </div>
    </section>
  </div>
}

/** Isolated scene: reads proposal snapshots only, never installs a global doc. */
export function AgentBoardPreview(props: { objects: AgentObject[]; boardId?: string }) {
  const cards = () => props.objects.filter((o): o is Extract<AgentObject, { kind: 'card' }> => o.kind === 'card' && o.boardId === props.boardId && !o.deletedAt && !o.purged)
  const stickers = () => props.objects.filter(usableSticker).filter((s) => s.boardId === props.boardId && !s.deletedAt && !s.purged).sort((a, b) => a.z - b.z || a.id.localeCompare(b.id))
  const scene = createMemo(() => {
    const all = cards(), rects = new Map<string, { x: number; y: number; w: number; h: number }>()
    for (const c of all.filter((c) => !c.columnId)) rects.set(c.id, { x: c.x, y: c.y, w: c.w, h: c.h })
    for (const column of all.filter((c) => c.type === 'column')) {
      let y = column.y + 64
      for (const child of all.filter((c) => c.columnId === column.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) { rects.set(child.id, { x: column.x + 12, y, w: Math.max(60, column.w - 24), h: child.h }); y += child.h + 12 }
      const r = rects.get(column.id)
      if (r) r.h = Math.max(r.h, y - column.y + 12)
    }
    const bounds = [...rects.values(), ...stickers().map(stickerBounds)]
    const x = Math.min(0, ...bounds.map((r) => r.x)) - 20, y = Math.min(0, ...bounds.map((r) => r.y)) - 20
    const width = Math.max(320, ...bounds.map((r) => r.x + r.w - x + 20)), height = Math.max(180, ...bounds.map((r) => r.y + r.h - y + 20))
    return { rects, x, y, width, height }
  })
  const [available, setAvailable] = createSignal(600)
  let viewport!: HTMLDivElement
  onMount(() => { const ro = new ResizeObserver(() => setAvailable(viewport.clientWidth || 600)); ro.observe(viewport); onCleanup(() => ro.disconnect()) })
  const scale = () => Math.min(1, available() / scene().width)
  const connections = () => props.objects.filter((o): o is Extract<AgentObject, { kind: 'connection' }> => o.kind === 'connection' && o.boardId === props.boardId && !o.deletedAt && !o.purged)
  return <div class="agents-preview" ref={viewport} data-testid="agent-board-preview"><Show when={cards().length || stickers().length} fallback={<p class="agents-hint">This board has no cards or stickers.</p>}><div style={{ position: 'relative', height: `${scene().height * scale()}px` }}><div class="agents-preview-world" inert style={{ width: `${scene().width}px`, height: `${scene().height}px`, transform: `scale(${scale()})` }}>
    <svg class="agents-preview-lines" width={scene().width} height={scene().height} aria-hidden="true"><For each={connections()}>{(c) => { const from = () => scene().rects.get(c.from), to = () => scene().rects.get(c.to); return <Show when={from() && to()}><line x1={from()!.x + from()!.w / 2 - scene().x} y1={from()!.y + from()!.h / 2 - scene().y} x2={to()!.x + to()!.w / 2 - scene().x} y2={to()!.y + to()!.h / 2 - scene().y} /></Show> }}</For></svg>
    <For each={cards().sort((a, b) => (a.type === 'column' ? -1 : 0) - (b.type === 'column' ? -1 : 0) || a.z - b.z)}>{(c) => { const rect = () => scene().rects.get(c.id); return <Show when={rect()}><div class="agents-preview-card" classList={{ 'agents-preview-column': c.type === 'column' }} style={{ left: `${rect()!.x - scene().x}px`, top: `${rect()!.y - scene().y}px`, width: `${rect()!.w}px`, 'min-height': `${rect()!.h}px`, '--agent-card-bg': `var(--dn-card-${cardColor(c.color)}-bg)`, '--agent-card-text': `var(--dn-card-${cardColor(c.color)}-text)` }}><small>{c.type}</small><Show when={c.type === 'image'}><PreviewImage assetId={(c.content as { assetId: string }).assetId} /></Show><div class="agents-preview-text"><Show when={c.type === 'note'} fallback={cardText(c, props.objects)}><RichText doc={parseMarkdown((c.content as { md: string }).md ?? '')} /></Show></div></div></Show> }}</For>
    <For each={stickers()}>{(s) => <div class="agents-preview-sticker" style={{ left: `${s.x - scene().x}px`, top: `${s.y - scene().y}px`, width: `${s.w}px`, height: `${stickerHeight(s)}px` }}><div class="sticker-rotation" style={{ transform: `rotate(${s.angle}deg)` }}><StickerImage sticker={s.content} /></div></div>}</For>
  </div></div></Show></div>
}
function PreviewImage(props: { assetId: string }) { const [src] = createResource(() => props.assetId, (id) => assetUrl(id, 'thumb')); return <Show when={src()}><img alt="Proposed image" src={src()} /></Show> }
function cardText(card: Extract<AgentObject, { kind: 'card' }>, objects: AgentObject[]): string {
  // The "before" side is live synced data and may be malformed.
  try {
    const text = rawCardText(card, objects)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}
function rawCardText(card: Extract<AgentObject, { kind: 'card' }>, objects: AgentObject[]): string {
  switch (card.type) {
    case 'note': return card.content.md
    case 'todo': return [card.content.title, ...card.content.items.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`)].join('\n')
    case 'column': return card.content.title
    case 'link': return card.content.title || card.content.url
    case 'image': return card.content.caption || ''
    case 'file': return `${card.content.name}\n${Math.round(card.content.size / 1024)} KB`
    case 'board': return boardDisplayTitle(objects.find((o): o is Extract<AgentObject, { kind: 'board' }> => o.id === card.content.boardId && o.kind === 'board'), 'Nested board')
  }
}
