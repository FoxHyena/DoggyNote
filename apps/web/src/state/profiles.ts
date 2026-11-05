import { createSignal } from 'solid-js'
import { profileName, type Profile } from '@doggynote/core'

const KEY = 'doggynote.profiles'
const [profiles, setProfiles] = createSignal<Profile[]>([])
let owner: string | null = null

/** This single cache belongs to the signed-in account, never a share viewer. */
export function startProfiles(userId: string) {
  owner = userId
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    setProfiles(cached?.owner === userId && Array.isArray(cached.profiles) ? cached.profiles : [])
    if (cached?.owner !== userId) localStorage.removeItem(KEY)
  } catch { setProfiles([]) }
}
export function clearProfiles(removeCache = true) {
  owner = null; setProfiles([])
  if (removeCache) { try { localStorage.removeItem(KEY) } catch { /* storage denied */ } }
}
export function installProfiles(next: Profile[], persist = true) {
  setProfiles(next)
  if (persist && owner) {
    try { localStorage.setItem(KEY, JSON.stringify({ owner, profiles: next })) } catch { /* offline fallback uses saved comment author */ }
  }
}
export function commentAuthorName(id: string, fallback: string) {
  const profile = profiles().find(p => p.id === id)
  return profile ? profileName(profile) : fallback
}
