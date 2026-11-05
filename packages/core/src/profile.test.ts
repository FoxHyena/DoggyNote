import { describe, expect, it } from 'vitest'
import { normalizeDisplayName, profileName } from './profile.ts'

describe('display names', () => {
  it('trims names, accepts spaces and emoji, and clears empty names', () => {
    expect(normalizeDisplayName('  Oreo 🐺  ')).toBe('Oreo 🐺')
    expect(normalizeDisplayName('名字')).toBe('名字')
    expect(normalizeDisplayName('   ')).toBeNull()
    expect(normalizeDisplayName(null)).toBeNull()
    expect(normalizeDisplayName('a'.repeat(64))).toHaveLength(64)
  })
  it.each([undefined, 5, {}, [], true, 'a'.repeat(65), 'two\nlines', 'two\rlines', '\tname', 'name\u0000', 'name\u2028line'])('rejects invalid input %j', value => {
    expect(normalizeDisplayName(value)).toBeUndefined()
  })
  it('uses usernames for existing accounts and cleared names', () => {
    expect(profileName({ username: 'hyenafox', displayName: 'Oreo 🐺' })).toBe('Oreo 🐺')
    expect(profileName({ username: 'hyenafox', displayName: ' ' })).toBe('hyenafox')
    expect(profileName({ username: 'hyenafox' })).toBe('hyenafox')
  })
})
