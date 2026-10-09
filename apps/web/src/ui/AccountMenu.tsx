import { For, Show, createResource, createSignal } from 'solid-js'
import { api, ApiError } from '../state/api.ts'
import { logout, user, type User } from '../state/session.ts'
import { lastError, pendingCount, syncNow, syncState } from '../state/sync.ts'
import { Icon, ToolIcons } from './icons.tsx'

export function SyncStatus() {
  const label = () => {
    switch (syncState()) {
      case 'syncing':
        return 'Syncing…'
      case 'offline':
        return pendingCount() ? `Offline · ${pendingCount()} waiting` : 'Offline'
      case 'error':
        return 'Sync problem'
      case 'signed-out':
        return 'Signed out'
      default:
        return pendingCount() ? `${pendingCount()} waiting` : 'Synced'
    }
  }
  return (
    <button
      class="sync-status"
      data-testid="sync-status"
      data-state={syncState()}
      title={lastError() ?? 'Click to sync now'}
      onClick={() => void syncNow()}
    >
      <span class="sync-dot" />
      {label()}
    </button>
  )
}

export function AccountMenu() {
  const [open, setOpen] = createSignal(false)
  const [people, setPeople] = createSignal(false)
  return (
    <div class="zoom">
      <button class="icon-btn" data-testid="account" onClick={() => setOpen(!open())} title="Account">
        <Icon>{ToolIcons.user()}</Icon>
        <span class="icon-btn-label">{user()?.username}</span>
      </button>
      <Show when={open()}>
        <div class="menu" onPointerLeave={() => setOpen(false)}>
          <Show when={user()?.isAdmin}>
            <button
              class="menu-item"
              data-testid="manage-people"
              onClick={() => {
                setOpen(false)
                setPeople(true)
              }}
            >
              Manage people
            </button>
          </Show>
          <button class="menu-item" data-testid="sign-out" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </Show>
      <Show when={people()}>
        <PeopleDialog onClose={() => setPeople(false)} />
      </Show>
    </div>
  )
}

function PeopleDialog(props: { onClose: () => void }) {
  const [list, { refetch }] = createResource(() => api<{ users: User[] }>('/api/users').then((r) => r.users))
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [isAdmin, setIsAdmin] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  async function add(e: SubmitEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api('/api/users', { method: 'POST', json: { username: username().trim(), password: password(), isAdmin: isAdmin() } })
      setUsername('')
      setPassword('')
      setIsAdmin(false)
      void refetch()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that person')
    }
  }

  async function remove(u: User) {
    await api(`/api/users/${u.id}`, { method: 'DELETE' })
    void refetch()
  }

  return (
    <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="dialog" role="dialog" aria-label="People" data-testid="people-dialog">
        <header class="dialog-head">
          <h2>People</h2>
          <button class="icon-btn" title="Close" onClick={props.onClose}>
            <Icon>{ToolIcons.close()}</Icon>
          </button>
        </header>
        <ul class="people">
          <For each={list() ?? []}>
            {(u) => (
              <li>
                <span>
                  {u.username}
                  <Show when={u.isAdmin}>
                    <span class="tag">admin</span>
                  </Show>
                </span>
                <Show when={u.id !== user()?.id}>
                  <button class="bar-btn" onClick={() => void remove(u)}>
                    Remove
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <form class="add-person" onSubmit={add}>
          <input placeholder="username" data-testid="new-username" value={username()} onInput={(e) => setUsername(e.currentTarget.value)} required />
          <input placeholder="password (8+)" type="password" data-testid="new-password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} required />
          <label class="check">
            <input type="checkbox" checked={isAdmin()} onChange={(e) => setIsAdmin(e.currentTarget.checked)} /> admin
          </label>
          <button class="primary-btn" type="submit" data-testid="add-person">
            Add
          </button>
        </form>
        <Show when={error()}>
          <p class="form-error">{error()}</p>
        </Show>
      </div>
    </div>
  )
}
