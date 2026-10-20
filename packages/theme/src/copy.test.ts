import { describe, expect, it } from 'vitest'
import { boardDisplayTitle, COPY } from './copy.ts'

describe('board display names across upgrades', () => {
  it('shows the current Inbox name for legacy reserved boards without changing their data', () => {
    const legacy = { id: 'toybox:existing-user', title: 'Toy box' }
    expect(COPY.unsorted).toBe('Inbox')
    expect(boardDisplayTitle(legacy)).toBe('Inbox')
    expect(legacy.title).toBe('Toy box')
  })

  it('preserves names of ordinary boards, including ones named Toy box', () => {
    expect(boardDisplayTitle({ id: 'custom-board', title: 'Toy box' })).toBe('Toy box')
    expect(boardDisplayTitle({ id: 'toybox-project', title: 'Research' })).toBe('Research')
  })

  it('keeps caller fallbacks for missing boards but recognizes an Inbox with no stored title', () => {
    expect(boardDisplayTitle(undefined, 'Shared board')).toBe('Shared board')
    expect(boardDisplayTitle({ id: 'toybox:new-user' })).toBe('Inbox')
  })
})
