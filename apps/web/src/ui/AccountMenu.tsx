import { SheetGrip } from './SheetGrip.tsx'
import './navigation.css'
import { Show, createEffect, createSignal, createUniqueId, onCleanup } from 'solid-js'
import { logout, user } from '../state/session.ts'
import { Icon } from './icons.tsx'
import { AdminDashboard } from './AdminDashboard.tsx'
import { AgentConnections } from './AgentConnections.tsx'
import { AboutDialog } from './AboutDialog.tsx'
import { ThemeToggle, type ThemeToggleProps } from '../ThemeToggle.tsx'
import { COPY } from '@doggynote/theme'
import { canPrompt, installed, isIOS, promptInstall } from '../state/install.ts'
import { isTauri } from '../state/platform.ts'
import { GUIDES_URL } from '../state/api.ts'
import { phone, touch } from '../state/device.ts'
import { setShortcutsOpen } from '../state/ui.ts'

export { SyncStatus } from './SyncStatus.tsx'

export function AccountMenu(props: ThemeToggleProps) {
  const [open, setOpen] = createSignal(false)
  const [people, setPeople] = createSignal(false)
  const [agents, setAgents] = createSignal(false)
  const [about, setAbout] = createSignal(false)
  const [installHelp, setInstallHelp] = createSignal(false)
  const offerInstall = () => !isTauri && !installed() && (canPrompt() || (touch() && isIOS))
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
    // Safari doesn't focus a button you click, so after pressing the appearance icon
    // focus is on <body> and Escape never reaches the menu's own key handler.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.activeElement !== document.body) return
      event.preventDefault()
      close(true)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
    })
  })
  return (
    <div class="zoom account-menu" ref={container} onKeyDown={(event) => {
      // Account dialogs install their own keyboard containment on document/window.
      if (!open() && event.target !== trigger) return
      // "?" from the (closed) Account button reaches the shortcut sheet.
      if (!open() && event.key === '?') return
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
        <Icon name="user" />
      </button>
      <Show when={open()}>
        <div ref={menu} id={menuId} class="menu nav-menu account-popover" role="dialog" aria-label="Account"><SheetGrip onDismiss={() => close(true)} />
          <div class="account-menu-identity">{user()?.username}</div>
          <div class="account-menu-appearance"><span aria-hidden="true">Appearance</span><ThemeToggle mode={props.mode} onThemeChange={props.onThemeChange} /></div>
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
          <Show when={offerInstall()}>
            <button
              class="menu-item"
              data-testid="install-app"
              aria-expanded={canPrompt() ? undefined : installHelp()}
              onClick={() => (canPrompt() ? void promptInstall().then(() => close()) : setInstallHelp(!installHelp()))}
            >
              {COPY.installTitle}
            </button>
            <Show when={installHelp()}>
              <p class="nav-menu-description install-help" data-testid="install-help">
                In Safari, tap Share, then Add to Home Screen. It opens full screen like an app. You'll sign in once more there.
              </p>
            </Show>
          </Show>
          <button class="menu-item" data-testid="manage-agents" onClick={() => { close(); setAgents(true) }}>Agent connections</button>
          <Show when={!phone()}><button class="menu-item" data-testid="open-shortcuts" onClick={() => { close(); setShortcutsOpen(true) }}>Keyboard shortcuts<kbd class="nav-menu-meta">?</kbd></button></Show>
          <a class="menu-item" data-testid="open-guides" href={GUIDES_URL} target="_blank" rel="noopener" onClick={() => close()}>{COPY.guides.open}</a>
          <button class="menu-item" data-testid="about" onClick={() => { close(); setAbout(true) }}>About &amp; credits</button>
          <button class="menu-item" data-testid="sign-out" onClick={() => { close(); void logout() }}>
            Sign out
          </button>
        </div>
      </Show>
      <Show when={about()}><AboutDialog onClose={() => { setAbout(false); trigger.focus() }} /></Show>
      <Show when={agents()}><AgentConnections onClose={() => { setAgents(false); trigger.focus() }} /></Show>
      <Show when={people()}>
        <AdminDashboard onClose={() => { setPeople(false); trigger.focus() }} />
      </Show>
    </div>
  )
}
