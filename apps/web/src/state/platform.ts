// Desktop (Tauri) integration. Everything here degrades to plain browser
// behaviour when not running inside the app.

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__
export const isTauri = !!internals

const invoke: Invoke = (cmd, args) => (internals ? internals.invoke(cmd, args) : Promise.reject(new Error('not in Tauri')))

// Local test builds (VITE_TOKEN_STORE=web) keep the token in web storage instead:
// each unsigned rebuild is a "new app" to macOS, which would ask for the login
// password before every Keychain read.
const webTokenStore = {
  async get(): Promise<string | null> {
    try {
      return localStorage.getItem('doggynote.token')
    } catch {
      return null
    }
  },
  async set(token: string) {
    localStorage.setItem('doggynote.token', token)
  },
  async clear() {
    localStorage.removeItem('doggynote.token')
  },
}

/** Session token for the desktop app, kept in the macOS Keychain. */
const keychainTokenStore = {
  async get(): Promise<string | null> {
    if (!isTauri) return null
    try {
      return ((await invoke('get_token')) as string | null) ?? null
    } catch {
      return null
    }
  },
  async set(token: string) {
    if (isTauri) await invoke('set_token', { token })
  },
  async clear() {
    if (isTauri) await invoke('clear_token').catch(() => undefined)
  },
}

export const tokenStore = isTauri && import.meta.env.VITE_TOKEN_STORE === 'web' ? webTokenStore : keychainTokenStore

/** Open external links in the system browser (a Tauri webview ignores target=_blank). */
export function installLinkHandler() {
  if (!isTauri) return
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || !/^(https?:|mailto:)/.test(a.href)) return
      e.preventDefault()
      void invoke('plugin:opener|open_url', { url: a.href })
    },
    true,
  )
}
