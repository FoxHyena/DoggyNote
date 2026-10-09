// Float ordering for cards inside columns. Insert between two neighbours by
// taking the midpoint; a few thousand inserts at one spot before precision
// matters is fine for a handful of users.

/** Order value for a slot between `before` and `after` (either may be missing). */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

/** `count` evenly spaced orders for inserting several items into one slot. */
export function ordersBetween(before: number | undefined, after: number | undefined, count: number): number[] {
  const lo = before ?? (after !== undefined ? after - count - 1 : 0)
  const hi = after ?? lo + count + 1
  const step = (hi - lo) / (count + 1)
  return Array.from({ length: count }, (_, i) => lo + step * (i + 1))
}
