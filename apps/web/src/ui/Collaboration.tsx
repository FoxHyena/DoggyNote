import './collaboration.css'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { noteMarkdown, type Card } from '@doggynote/core'
import { liveState, members, peers, personStyle, sessionName, following, follow, stopFollowing, pingAt, pings, installRealtime } from '../state/realtime.ts'
import { boardId, camera, viewport } from '../state/ui.ts'
import * as doc from '../state/doc.ts'
import { rectOf } from '../canvas/layout.ts'
import { installMenu } from './menu.ts'
import { user } from '../state/session.ts'

const initials = (name: string) => name.slice(0, 2).toUpperCase()
export function Collaborators() {
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement, trigger!: HTMLButtonElement
  const closeAction = () => { setOpen(false); trigger.focus() }
  installMenu(open, () => setOpen(false), () => root, () => trigger)
  onMount(() => onCleanup(installRealtime()))
  const people = createMemo(() => {
    const unique = new Map<string, ReturnType<typeof members>[number]>()
    for (const m of [...members()].sort((a, b) => a.sessionId.localeCompare(b.sessionId))) if (!unique.has(m.userId)) unique.set(m.userId, m)
    return [...unique.values()].sort((a, b) => a.username.localeCompare(b.username))
  })
  return <div class="collaborators" ref={root}>
    <button ref={trigger} class="people-trigger" data-testid="collaborators" aria-label={`People on this board${people().length ? `: ${people().length}` : ''}. ${liveState() === 'live' ? 'Live' : liveState() === 'connecting' ? 'Connecting' : 'Reconnecting'}`} aria-expanded={open()} onClick={() => setOpen(!open())}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2"/></svg>
      <span class="people-count">{liveState() === 'live' ? people().length || 1 : '…'}</span>
      <span class="people-avatars" aria-hidden="true"><For each={people().slice(0, 2)}>{(p) => <span class="person-avatar" style={personStyle(p.userId)}>{initials(p.username)}</span>}</For></span>
    </button>
    <Show when={open()}><div class="menu nav-menu people-menu" role="region" aria-label="People on this board">
      <div class="nav-menu-head"><strong>On this board</strong><span class="people-status" data-state={liveState()} data-testid="live-status">{liveState() === 'live' ? 'Live' : liveState() === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span></div>
      <Show when={people().length} fallback={<p class="people-hint">{liveState() === 'live' ? 'Just you for now.' : 'Live presence is unavailable. Your edits still save and sync.'}</p>}>
        <ul class="people-list"><For each={people()}>{(p) => <li class="person-row" data-testid="participant" style={personStyle(p.userId)}>
          <span class="person-avatar" aria-hidden="true">{initials(p.username)}</span>
          <div class="person-info"><strong>{p.username}{p.userId === user()?.id ? ' (you)' : ''}</strong><small>{members().some((m) => m.userId === p.userId && m.editing) ? 'Editing a note' : p.canEdit ? 'Can edit' : 'View only'}{members().filter((m) => m.userId === p.userId).length > 1 ? ' · multiple sessions' : ''}</small></div>
          <Show when={peers().some((m) => m.userId === p.userId)}><button class="person-follow" aria-label={`Follow ${p.username}`} onClick={() => { const session = peers().find((m) => m.userId === p.userId && m.editing) ?? peers().find((m) => m.userId === p.userId); if (session) follow(session.sessionId); closeAction() }}>Follow</button></Show>
        </li>}</For></ul>
      </Show>
      <div class="nav-menu-section"><button class="menu-item" disabled={liveState() !== 'live'} onClick={() => { pingAt(); closeAction() }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>{COPY.lookHere}</button><p class="people-hint">Point out your selected card or the center of your view.</p></div>
    </div></Show>
  </div>
}

/** Screen-space overlays stay readable at every board zoom, including LOD. */
export function CollaborationOverlay() {
  const name = sessionName
  const point = (p: { x: number; y: number }) => ({ left: `${(p.x - camera().x) * camera().zoom}px`, top: `${(p.y - camera().y) * camera().zoom}px` })
  const inView = (p: { x: number; y: number }) => { const c = camera(), v = viewport(); return p.x >= c.x && p.y >= c.y && p.x <= c.x + v.width / c.zoom && p.y <= c.y + v.height / c.zoom }
  const leader = () => peers().find((p) => p.sessionId === following())
  const pingPosition = (p: { x: number; y: number }) => {
    const c = camera(), v = viewport()
    return { x: Math.min(Math.max(24, (p.x - c.x) * c.zoom), Math.max(24, v.width - 24)), y: Math.min(Math.max(28, (p.y - c.y) * c.zoom), Math.max(28, v.height - 64)) }
  }
  const pingDescription = (p: ReturnType<typeof pings>[number]) => {
    const object = Object.values(doc.objs).find((o) => {
      if (o.kind !== 'card' || o.boardId !== boardId() || o.deletedAt || o.purged) return false
      const r = rectOf(o.id)
      return r && p.point.x >= r.x && p.point.x <= r.x + r.w && p.point.y >= r.y && p.point.y <= r.y + r.h
    })
    const title = object?.kind === 'card' && object.type === 'note' ? noteMarkdown(object as Card<'note'>).split('\n')[0]!.replace(/^#+\s*/, '').slice(0, 80) : ''
    return `${p.username} pointed to ${title ? `“${title}”` : 'a location on this board'}.`
  }
  return <>
    <div class="collaboration-announcements" role="log" aria-live="polite" aria-relevant="additions"><For each={pings()}>{(p) => <p>{pingDescription(p)}</p>}</For></div>
    <div class="collaboration-overlay" aria-hidden="true">
      <For each={peers()}>{(p) => <div style={personStyle(p.userId)}>
        <For each={p.previews}>{(preview) => <div class="remote-outline remote-preview" data-testid="remote-preview" style={{ ...point(preview), width: `${(preview.w ?? 240) * camera().zoom}px`, height: `${(preview.h ?? 80) * camera().zoom}px` }}><span class="remote-label">{name(p)}</span></div>}</For>
        <For each={p.selection.filter((id) => !p.previews.some((v) => v.id === id))}>{(id) => {
          const object = () => doc.getCard(id), rect = () => rectOf(id)
          return <Show when={object() && rect()}><div class="remote-outline" data-testid="remote-selection" style={{ ...point(rect()!), width: `${rect()!.w * camera().zoom}px`, height: `${rect()!.h * camera().zoom}px` }}><span class="remote-label">{name(p)}{p.editing === id ? ' · editing' : ''}</span></div></Show>
        }}</For>
        <Show when={p.pointer && inView(p.pointer)}><div class="remote-cursor" data-testid="remote-cursor" style={point(p.pointer!)}><svg width="18" height="23" viewBox="0 0 18 23"><path d="M1 1v17l5-4 4 8 3-2-4-8 7-1z"/></svg><span class="remote-label">{name(p)}</span></div></Show>
      </div>}</For>
      <For each={pings()}>{(p) => <div class="remote-ping" data-testid="remote-ping" data-offscreen={!inView(p.point)} style={{ left: `${pingPosition(p.point).x}px`, top: `${pingPosition(p.point).y}px`, ...personStyle(p.userId) }}><svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18"/><circle cx="22" cy="22" r="4"/></svg><span class="remote-label" style={{ transform: pingPosition(p.point).x > viewport().width / 2 ? 'translateX(-100%)' : undefined }}>{p.username} · {COPY.lookHere}{!inView(p.point) ? ' · off-screen' : ''}</span></div>}</For>
    </div>
    <Show when={leader()}><div class="follow-banner" style={personStyle(leader()!.userId)} role="status"><span>Following <strong>{leader()!.username}</strong></span><button onClick={() => { stopFollowing(); document.querySelector<HTMLButtonElement>('[data-testid="collaborators"]')?.focus() }}>Stop following</button></div></Show>
  </>
}
