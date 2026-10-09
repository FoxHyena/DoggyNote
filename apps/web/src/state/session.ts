import { createSignal } from 'solid-js'
import { ApiError, api, setBearer } from './api.ts'
import * as doc from './doc.ts'
import { isTauri, tokenStore } from './platform.ts'

export type User = { id: string; username: string; isAdmin: boolean }

const USER_KEY = 'doggynote.user'
/** Survives sign-out and expired sessions, so signing in as someone else clears the local copy. */
const LAST_USER_KEY = 'doggynote.lastUserId'

export const [user, setUser] = createSignal<User | null>(null)

function cachedUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null')
  } catch {
    return null
  }
}

function cacheUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u))
    else localStorage.removeItem(USER_KEY)
  } catch {
    // ignore
  }
}

/**
 * 'ok': signed in. 'offline': server unreachable but this device was signed in,
 * so open the local copy. 'anon': show the login screen.
 */
export async function checkSession(): Promise<'ok' | 'offline' | 'anon'> {
  if (isTauri) setBearer(await tokenStore.get())
  try {
    const { user: u } = await api<{ user: User }>('/api/me')
    setUser(u)
    cacheUser(u)
    return 'ok'
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      cacheUser(null)
      return 'anon'
    }
    const u = cachedUser()
    if (u) {
      setUser(u)
      return 'offline'
    }
    return 'anon'
  }
}

export async function login(username: string, password: string): Promise<User> {
  const res = await api<{ user: User; token?: string }>('/api/auth/login', { method: 'POST', json: { username, password, bearer: isTauri } })
  if (res.token) {
    await tokenStore.set(res.token)
    setBearer(res.token)
  }
  // Another account's local copy must not leak into this one.
  let last: string | null = null
  try {
    last = localStorage.getItem(LAST_USER_KEY)
    localStorage.setItem(LAST_USER_KEY, res.user.id)
  } catch {
    last = null
  }
  if (last && last !== res.user.id) await doc.resetLocal()
  setUser(res.user)
  cacheUser(res.user)
  return res.user
}

export async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST', json: {} })
  } catch {
    // offline: still forget locally
  }
  await tokenStore.clear()
  setBearer(null)
  cacheUser(null)
  await doc.resetLocal()
  location.hash = ''
  location.reload()
}
