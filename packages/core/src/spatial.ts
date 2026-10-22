// Moving between cards with the keyboard: which card is "next" in a direction,
// and which comes first in reading order. Pure geometry, so it's tested in Node.

import type { Rect } from './geometry.ts'

export type Direction = 'left' | 'right' | 'up' | 'down'
export type Placed<T> = { id: T; rect: Rect }

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/**
 * The card a person means by "the next one to the right" (or up, down, left):
 * ahead of the current card's centre, favouring cards in line over ones off to the side.
 */
export function nearestInDirection<T>(from: Rect, cards: Placed<T>[], dir: Direction): T | null {
  const a = centre(from)
  let best: T | null = null
  let bestScore = Infinity
  for (const c of cards) {
    const b = centre(c.rect)
    const along = dir === 'right' ? b.x - a.x : dir === 'left' ? a.x - b.x : dir === 'down' ? b.y - a.y : a.y - b.y
    const across = Math.abs(dir === 'left' || dir === 'right' ? b.y - a.y : b.x - a.x)
    // Behind or level with us, or further off to the side than ahead: not that way.
    if (along <= 0.5 || across > along * 2) continue
    const score = along + across * 3
    if (score < bestScore) { bestScore = score; best = c.id }
  }
  return best
}

/** Top to bottom, then left to right; cards whose tops are within a row's height read as one row. */
export function readingOrder<T>(cards: Placed<T>[], rowTolerance = 40): T[] {
  const byTop = [...cards].sort((p, q) => p.rect.y - q.rect.y || p.rect.x - q.rect.x)
  const rows: Placed<T>[][] = []
  for (const c of byTop) {
    const row = rows.at(-1)
    if (row && c.rect.y - row[0].rect.y <= rowTolerance) row.push(c)
    else rows.push([c])
  }
  return rows.flatMap((row) => row.sort((p, q) => p.rect.x - q.rect.x).map((c) => c.id))
}
