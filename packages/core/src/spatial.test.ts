import { describe, expect, it } from 'vitest'
import { nearestInDirection, readingOrder } from './index.ts'

const at = (id: string, x: number, y: number, w = 100, h = 60) => ({ id, rect: { x, y, w, h } })

describe('nearestInDirection', () => {
  const from = { x: 0, y: 0, w: 100, h: 60 }
  const cards = [at('right', 200, 0), at('farRight', 500, 0), at('rightLow', 200, 140), at('below', 0, 120), at('left', -200, 10), at('above', 10, -150)]

  it('picks the card in line before one off to the side', () => {
    expect(nearestInDirection(from, cards, 'right')).toBe('right')
    expect(nearestInDirection(from, cards.filter((c) => c.id !== 'right'), 'right')).toBe('farRight')
  })

  it('goes each way', () => {
    expect(nearestInDirection(from, cards, 'down')).toBe('below')
    expect(nearestInDirection(from, cards, 'left')).toBe('left')
    expect(nearestInDirection(from, cards, 'up')).toBe('above')
  })

  it('finds nothing past the edge, and ignores cards mostly to the side', () => {
    expect(nearestInDirection(from, [at('steep', 50, 400)], 'right')).toBeNull()
    expect(nearestInDirection(from, [], 'left')).toBeNull()
  })
})

describe('readingOrder', () => {
  it('reads rows top to bottom, each left to right, tolerating ragged tops', () => {
    expect(readingOrder([at('c', 300, 5), at('a', 0, 0), at('d', 0, 200), at('b', 150, 30)])).toEqual(['a', 'b', 'c', 'd'])
  })
})
