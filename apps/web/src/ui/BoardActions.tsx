import './navigation.css'
import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import { AgentProposals } from './AgentProposals.tsx'
import { ExportButton } from './ExportMenu.tsx'
import { BoardIconSvg, Icon, ToolIcons } from './icons.tsx'

/** One proposal resource and export panel, shared by every board-action trigger. */
export function BoardActions(props: { boardId: string; primary?: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement
  let more!: HTMLButtonElement
  let menu!: HTMLDivElement
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) more.focus() }
  onMount(() => {
    const outside = (event: PointerEvent) => { if (open() && !root.contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => {
      if (!open() || event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close(true)
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    onCleanup(() => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true) })
  })
  const menuKeys = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === 'Backspace' || event.key === 'Delete') event.preventDefault()
    if (event.key === 'Tab') { close(true); return }
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (current + 1) % items.length
      : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
    if (next >= 0) { event.preventDefault(); items[next]?.focus() }
  }
  return <AgentProposals boardId={props.boardId} renderTrigger={(proposal) => <ExportButton renderTrigger={(png) => <div class="board-actions" ref={root} style={{ position: 'relative' }}>
    <Show when={proposal.pending() > 0}><button class="icon-btn board-actions-review" data-testid="review-changes" data-tooltip="Review pending agent changes" aria-haspopup="dialog" aria-expanded={proposal.isOpen()} onClick={() => { png.close(false); close(); proposal.open(more) }}><BoardIconSvg icon="paw" size={18} /><span>Review changes · {proposal.pending()}</span></button></Show>
    <Show when={props.primary}><div class="board-actions-primary" onClick={() => { png.close(false); close() }}>{props.primary}</div></Show>
    <button ref={more} class="icon-btn board-actions-more" data-testid="board-more" data-tooltip="More board actions" aria-label={`More board actions${proposal.pending() ? `, ${proposal.pending()} pending proposals` : ''}`} aria-haspopup="menu" aria-expanded={open()} onClick={() => { png.close(false); setOpen(!open()) }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); png.close(false); setOpen(true) } }}>
      <Icon><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></Icon><Show when={proposal.pending() > 0}><span class="board-actions-more-badge" aria-hidden="true">{proposal.pending()}</span></Show>
    </button>
    <Show when={open()}><div ref={(el) => { menu = el; queueMicrotask(() => menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()) }} class="menu nav-menu board-actions-menu" role="menu" aria-label="Board actions" data-testid="board-actions-menu" onKeyDown={menuKeys}>
      <button class="menu-item nav-menu-row" role="menuitem" data-testid="agent-proposals" aria-haspopup="dialog" onClick={() => { png.close(false); close(); proposal.open(more) }}><BoardIconSvg icon="paw" size={18} /><span class="nav-menu-label">Agent proposals</span><Show when={proposal.pending() > 0}><span class="nav-menu-meta">{` · ${proposal.pending()}`}</span></Show></button>
      <button class="menu-item nav-menu-row" role="menuitem" data-testid="export" aria-haspopup="dialog" onClick={() => { close(); png.open(more) }}><Icon size={18}>{ToolIcons.download()}</Icon><span class="nav-menu-label">Export PNG</span></button>
    </div></Show>
  </div>} />} />
}
