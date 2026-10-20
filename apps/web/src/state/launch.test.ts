import { describe, expect, it } from 'vitest'
import { sharedText } from './launch.ts'

describe('sharedText', () => {
  it('keeps the link from a shared page', () => {
    expect(sharedText('Trail guide', '', 'https://example.com/trail')).toBe('https://example.com/trail')
  })
  it('finds a link inside shared text (Chrome on Android shares it there)', () => {
    expect(sharedText('Page', 'https://example.com/a?b=1', '')).toBe('https://example.com/a?b=1')
    expect(sharedText('Page title', 'Page title https://example.com/a', '')).toBe('https://example.com/a')
  })
  it('keeps your own words with the link', () => {
    expect(sharedText('', 'Look at this https://example.com/a?b=1 so good', '')).toBe('Look at this https://example.com/a?b=1 so good')
    expect(sharedText('', 'For Saturday', 'https://example.com/park')).toBe('For Saturday https://example.com/park')
  })
  it('keeps plain words as a note', () => {
    expect(sharedText('Groceries', '  eggs, milk  ', '')).toBe('Groceries\neggs, milk')
  })
})
