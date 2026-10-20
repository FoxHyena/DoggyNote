import { describe, expect, it } from 'vitest'
import { sharedText } from './launch.ts'

describe('sharedText', () => {
  it('keeps the link from a shared page', () => {
    expect(sharedText('Trail guide', '', 'https://example.com/trail')).toBe('https://example.com/trail')
  })
  it('finds a link inside shared text (Chrome on Android shares it there)', () => {
    expect(sharedText('', 'Look at this https://example.com/a?b=1 so good', '')).toBe('https://example.com/a?b=1')
  })
  it('keeps plain words as a note', () => {
    expect(sharedText('Groceries', '  eggs, milk  ', '')).toBe('Groceries\neggs, milk')
  })
})
