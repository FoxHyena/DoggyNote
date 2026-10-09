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

/** Compare dotted versions ("0.1.42"): negative if a < b, 0 if equal, positive if a > b. Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}
