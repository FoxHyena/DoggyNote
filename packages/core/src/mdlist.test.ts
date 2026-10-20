import { describe, expect, it } from 'vitest'
import { indentListItems } from './index.ts'

/** Apply Tab (1) or Shift-Tab (-1) to lines a..b and return the new text. */
function tab(text: string, a: number, b: number, dir: 1 | -1 = 1): string | null {
  const edits = indentListItems(text, a, b, dir)
  if (!edits) return null
  const lines = text.split('\n')
  for (const e of edits) lines[e.line] = lines[e.line].slice(0, e.from) + e.insert + lines[e.line].slice(e.to)
  return lines.join('\n')
}

describe('list indenting', () => {
  it('nests an item at the content column of the one above', () => {
    expect(tab('- a\n- b', 1, 1)).toBe('- a\n  - b')
    expect(tab('1. a\n2. b', 1, 1)).toBe('1. a\n   1. b')
    expect(tab('- [ ] a\n- [ ] b', 1, 1)).toBe('- [ ] a\n  - [ ] b')
    expect(tab('10. a\n11. b', 1, 1)).toBe('10. a\n    1. b')
  })

  it('does nothing to the first item, and is null outside a list', () => {
    expect(tab('- a\n- b', 0, 0)).toBe('- a\n- b')
    expect(tab('hello\nworld', 0, 1)).toBeNull()
  })

  it('carries sub-items along', () => {
    expect(tab('- a\n- b\n  - c\n- d', 1, 1)).toBe('- a\n  - b\n    - c\n- d')
  })

  it('outdents to the parent, renumbering what is left behind', () => {
    expect(tab('- a\n  - b', 1, 1, -1)).toBe('- a\n- b')
    expect(tab('1. a\n   1. b\n   2. c\n2. d', 1, 1, -1)).toBe('1. a\n2. b\n   1. c\n3. d')
    expect(tab('- a', 0, 0, -1)).toBe('- a')
  })

  it('indents a selection of items together and renumbers', () => {
    expect(tab('1. a\n2. b\n3. c\n4. d', 1, 2)).toBe('1. a\n   1. b\n   2. c\n2. d')
  })

  it('works from a wrapped continuation line', () => {
    expect(tab('- a\n- b\n  more of b', 2, 2)).toBe('- a\n  - b\n    more of b')
  })
})
