import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearProfiles, commentAuthorName, installProfiles, startProfiles } from './profiles.ts'

let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  clearProfiles()
})
afterEach(() => { clearProfiles(); vi.unstubAllGlobals() })

it('restores offline identities only for the same signed-in account', () => {
  startProfiles('alice')
  installProfiles([{ id: 'friend', username: 'friend', displayName: 'Friendly Pup 🐾' }])
  clearProfiles(false)
  startProfiles('alice')
  expect(commentAuthorName('friend', 'Saved author')).toBe('Friendly Pup 🐾')
  startProfiles('bob')
  expect(commentAuthorName('friend', 'Saved author')).toBe('Saved author')
  expect(values.has('doggynote.profiles')).toBe(false)
})

it('replaces revoked identities, preserves deleted-account fallback and never caches public viewers', () => {
  startProfiles('alice')
  installProfiles([{ id: 'friend', username: 'friend', displayName: 'New name' }])
  installProfiles([])
  expect(commentAuthorName('friend', 'Former name')).toBe('Former name')
  const previous = values.get('doggynote.profiles')
  clearProfiles(false)
  installProfiles([{ id: 'public', username: 'public', displayName: 'Public name' }], false)
  expect(commentAuthorName('public', 'Old name')).toBe('Public name')
  expect(values.get('doggynote.profiles')).toBe(previous)
  clearProfiles()
  expect(commentAuthorName('public', 'Old name')).toBe('Old name')
  expect(values.size).toBe(0)
})

it('keeps current identities usable if offline storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') }, removeItem() { throw new Error('denied') } })
  startProfiles('alice')
  installProfiles([{ id: 'friend', username: 'friend', displayName: null }])
  expect(commentAuthorName('friend', 'Old name')).toBe('friend')
  clearProfiles()
})
