import { profileName } from '@doggynote/core'
import { ProfileEditor } from './ProfileEditor.tsx'
import { SheetGrip } from './SheetGrip.tsx'
import './navigation.css'
import { Show, createEffect, createSignal, createUniqueId, onCleanup } from 'solid-js'
import { showToast } from '../state/toast.ts'
import { api, ApiError } from '../state/api.ts'
import { Avatar } from './Avatar.tsx'
import { Popover } from './Popover.tsx'
import { AvatarEditor, PHOTO_TYPES } from './AvatarEditor.tsx'
import { logout, updateProfile, user, type User } from '../state/session.ts'
import { Icon } from './icons.tsx'
import { AdminDashboard } from './AdminDashboard.tsx'
import { AgentConnections } from './AgentConnections.tsx'
import { AboutDialog } from './AboutDialog.tsx'
import { ThemeToggle, type ThemeToggleProps } from '../ThemeToggle.tsx'
import { COPY } from '@doggynote/theme'
import { canPrompt, installed, isIOS, promptInstall } from '../state/install.ts'
import { isTauri } from '../state/platform.ts'
import { GUIDES_URL } from '../state/api.ts'
import { touch } from '../state/device.ts'

export { SyncStatus } from './SyncStatus.tsx'

export function AccountMenu(props: ThemeToggleProps) {
  const [photo, setPhoto] = createSignal<File>()
  const [photoBusy, setPhotoBusy] = createSignal(false)
  const [photoError, setPhotoError] = createSignal('')
  const [photoOptions, setPhotoOptions] = createSignal(false)
  let photoTrigger: HTMLButtonElement | undefined
  let photoMenu: HTMLDivElement | undefined
  const closePhotoOptions = (restoreFocus = false) => { setPhotoOptions(false); if (restoreFocus) photoTrigger?.focus({ preventScroll: true }) }
  const returnToAccount = () => { setPhoto(undefined); setOpen(true); queueMicrotask(() => photoTrigger?.focus({ preventScroll: true })) }
  let photoInput!: HTMLInputElement
  async function removePhoto() {
    if (photoBusy()) return
    closePhotoOptions(); setPhotoBusy(true); setPhotoError('')
    try { const result = await api<{ user: User }>('/api/me/avatar', { method: 'DELETE' }); updateProfile(result.user); showToast('Profile photo removed.') }
    catch (error) { setPhotoError(error instanceof ApiError ? error.message : 'Could not remove your photo. Check your connection and try again.') }
    finally { setPhotoBusy(false); photoTrigger?.focus({ preventScroll: true }) }
  }
  const [open, setOpen] = createSignal(false)
  const [profile, setProfile] = createSignal(false)
  const [people, setPeople] = createSignal(false)
  const [agents, setAgents] = createSignal(false)
  const [about, setAbout] = createSignal(false)
  const [installHelp, setInstallHelp] = createSignal(false)
  const offerInstall = () => !isTauri && !installed() && (canPrompt() || (touch() && isIOS))
  const menuId = createUniqueId()
  const photoMenuId = createUniqueId()
  let container!: HTMLDivElement
  let trigger!: HTMLButtonElement
  let menu: HTMLDivElement | undefined

  const close = (restoreFocus = false) => {
    setPhotoOptions(false)
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
      if (!(event.target instanceof Node)) return
      const inPhotoMenu = photoMenu?.parentElement?.contains(event.target)
      if (!container.contains(event.target) && !inPhotoMenu) close()
      else if (event.type === 'focusin' && photoOptions() && !inPhotoMenu && event.target !== photoTrigger) closePhotoOptions()
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
      event.stopPropagation()
      if (event.key === 'Escape' && open() && !event.defaultPrevented) { event.preventDefault(); close(true) }
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
        <Show when={user()?.avatarId} fallback={<Icon name="user" />}><Avatar userId={user()!.id} name={profileName(user()!)} avatarId={user()?.avatarId} class="account-trigger-avatar" /></Show>
      </button>
      <Show when={open()}>
        <div ref={menu} id={menuId} class="menu nav-menu account-popover" role="dialog" aria-label="Account"><SheetGrip onDismiss={() => close(true)} />
          <div class="account-menu-identity account-photo-identity">
            <button ref={photoTrigger} type="button" class="account-photo-button" classList={{ 'account-photo-empty': !user()?.avatarId }} data-testid="photo-options-trigger" aria-label={photoBusy() ? 'Removing profile photo' : 'Profile photo options'} aria-haspopup="menu" aria-expanded={photoOptions()} aria-controls={photoOptions() ? photoMenuId : undefined} disabled={photoBusy()} onClick={() => photoOptions() ? closePhotoOptions() : setPhotoOptions(true)} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setPhotoOptions(true) } }}>
              <Avatar userId={user()!.id} name={profileName(user()!)} avatarId={user()?.avatarId} class="account-photo-avatar" />
              <span class="account-photo-camera" aria-hidden="true"><Icon name="camera" size={16} /></span>
            </button>
            <div class="account-profile-text"><strong>{user() ? profileName(user()!) : ''}</strong><small>@{user()?.username}</small></div>
          </div>
          <Show when={photoBusy()}><span class="avatar-sr" role="status">Removing photo…</span></Show>
          <Show when={photoOptions()}>
            <Popover anchor={() => photoTrigger!} label="Profile photo options" testid="photo-options" class="account-photo-options" align="start" close={() => closePhotoOptions(true)}>
              <div ref={photoMenu} id={photoMenuId} role="menu" aria-label="Profile photo" onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault(); event.stopPropagation(); closePhotoOptions()
                  if (event.shiftKey) photoTrigger?.focus()
                  else menu?.querySelector<HTMLButtonElement>('[data-testid="edit-profile"]')?.focus()
                  return
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                event.preventDefault(); event.stopPropagation()
                const items = [...photoMenu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = items.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
                items[next]?.focus()
              }}>
                <button class="menu-item" role="menuitem" data-testid="choose-avatar" onClick={() => { setPhotoError(''); photoInput.click(); closePhotoOptions() }}><Icon name="image" size={18} />{user()?.avatarId ? 'Change photo' : 'Add photo'}</button>
                <Show when={user()?.avatarId}><button class="menu-item" role="menuitem" onClick={() => void removePhoto()}><Icon name="trash" size={18} />Remove photo</button></Show>
              </div>
            </Popover>
          </Show>
          <Show when={photoError()}><p class="form-error account-photo-error" role="alert">{photoError()}</p></Show>
          <button class="menu-item" data-testid="edit-profile" onClick={() => { close(); setProfile(true) }}>Edit profile</button>
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
          <a class="menu-item" data-testid="open-guides" href={GUIDES_URL} target="_blank" rel="noopener" onClick={() => close()}>{COPY.guides.open}</a>
          <button class="menu-item" data-testid="about" onClick={() => { close(); setAbout(true) }}>About &amp; credits</button>
          <button class="menu-item" data-testid="sign-out" onClick={() => { close(); void logout().catch((error) => showToast(error instanceof Error ? error.message : 'Could not stop local work. Try signing out again.')) }}>
            Sign out
          </button>
        </div>
      </Show>
      <input ref={photoInput} type="file" accept={PHOTO_TYPES} hidden data-testid="avatar-input" onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) { close(); setPhoto(file) } }} />
      <Show when={photo()}>{(file) => <AvatarEditor file={file()} onClose={returnToAccount} />}</Show>
      <Show when={profile()}><ProfileEditor onClose={() => { setProfile(false); setOpen(true); queueMicrotask(() => menu?.querySelector<HTMLButtonElement>('[data-testid="edit-profile"]')?.focus({ preventScroll: true })) }} /></Show>
      <Show when={about()}><AboutDialog onClose={() => { setAbout(false); trigger.focus() }} /></Show>
      <Show when={agents()}><AgentConnections onClose={() => { setAgents(false); trigger.focus() }} /></Show>
      <Show when={people()}>
        <AdminDashboard onClose={() => { setPeople(false); trigger.focus() }} />
      </Show>
    </div>
  )
}
