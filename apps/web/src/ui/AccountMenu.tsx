import './navigation.css'
import { Show, createEffect, createSignal, createUniqueId, onCleanup } from 'solid-js'
import { logout, user } from '../state/session.ts'
import { Icon, ToolIcons } from './icons.tsx'
import { AdminDashboard } from './AdminDashboard.tsx'
import { AgentConnections } from './AgentConnections.tsx'
import { ThemeChoices, type ThemeChoicesProps } from './ThemeChoices.tsx'

export { SyncStatus } from './SyncStatus.tsx'

export function AccountMenu(props: ThemeChoicesProps) {
  const [open, setOpen] = createSignal(false)
  const [people, setPeople] = createSignal(false)
  const [agents, setAgents] = createSignal(false)
  const menuId = createUniqueId()
  let container!: HTMLDivElement
  let trigger!: HTMLButtonElement
  let menu: HTMLDivElement | undefined

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) trigger.focus()
  }
  const showMenu = (last = false) => {
    setOpen(true)
    queueMicrotask(() => {
      const controls = menu?.querySelectorAll<HTMLButtonElement>('button:not([tabindex="-1"])')
      const target = last ? controls?.item((controls?.length ?? 1) - 1) : controls?.item(0)
      target?.focus()
    })
  }
  createEffect(() => {
    if (!open()) return
    const outside = (event: Event) => {
      if (event.target instanceof Node && !container.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
    })
  })
  return (
    <div class="zoom account-menu" ref={container} onKeyDown={(event) => {
      // Account dialogs install their own keyboard containment on document/window.
      if (!open() && event.target !== trigger) return
      event.stopPropagation()
      if (event.key === 'Escape' && open()) { event.preventDefault(); close(true) }
    }}>
      <button
        ref={trigger}
        type="button"
        class="icon-btn account-trigger"
        data-testid="account"
        data-tooltip="Account"
        aria-label="Account"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={open() ? menuId : undefined}
        onClick={() => open() ? close() : showMenu()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            showMenu(event.key === 'ArrowUp')
          }
        }}
      >
        <Icon>{ToolIcons.user()}</Icon>
      </button>
      <Show when={open()}>
        <div ref={menu} id={menuId} class="menu nav-menu account-popover" role="dialog" aria-label="Account">
          <div class="account-menu-identity">{user()?.username}</div>
          <div class="account-menu-section-label">Appearance</div>
          <ThemeChoices mode={props.mode} onThemeChange={props.onThemeChange} />
          <Show when={user()?.isAdmin}>
            <button
              class="menu-item"
              data-testid="manage-people"
              onClick={() => {
                close()
                setPeople(true)
              }}
            >
              Manage people
            </button>
          </Show>
          <button class="menu-item" data-testid="manage-agents" onClick={() => { close(); setAgents(true) }}>Agent connections</button>
          <button class="menu-item" data-testid="sign-out" onClick={() => { close(); void logout() }}>
            Sign out
          </button>
        </div>
      </Show>
      <Show when={agents()}><AgentConnections onClose={() => { setAgents(false); trigger.focus() }} /></Show>
      <Show when={people()}>
        <AdminDashboard onClose={() => { setPeople(false); trigger.focus() }} />
      </Show>
    </div>
  )
}
