// Moving around a table grid by index. Pure, so the keyboard rules are unit
// tested without a DOM. Rows count from -1 (the header) to rows - 1; columns
// from 0 to cols - 1. The editor keeps its selection by row and column id and
// converts to indices only to move.

export type Cursor = { r: number; c: number }
export type Dir = 'up' | 'down' | 'left' | 'right'
export type Size = { rows: number; cols: number }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** One step. Stops at the edges. */
export function step(at: Cursor, dir: Dir, size: Size): Cursor {
  const dr = dir === 'up' ? -1 : dir === 'down' ? 1 : 0
  const dc = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
  return { r: clamp(at.r + dr, -1, size.rows - 1), c: clamp(at.c + dc, 0, size.cols - 1) }
}

/** ⌘/Ctrl+arrow: to the edge of the grid. The header is the top edge. */
export function edge(at: Cursor, dir: Dir, size: Size): Cursor {
  if (dir === 'up') return { r: -1, c: at.c }
  if (dir === 'down') return { r: size.rows - 1, c: at.c }
  if (dir === 'left') return { r: at.r, c: 0 }
  return { r: at.r, c: size.cols - 1 }
}

/** Home / End: the start or end of the row. With ⌘/Ctrl: the first or last cell of the body. */
export function homeEnd(at: Cursor, end: boolean, whole: boolean, size: Size): Cursor {
  const c = end ? size.cols - 1 : 0
  if (!whole) return { r: at.r, c }
  return { r: end ? size.rows - 1 : 0, c }
}

/**
 * Tab (or Shift+Tab): along the row, wrapping to the next (previous) row. Past
 * the last cell of the last row a new row is wanted; before the first cell stays.
 */
export function tab(at: Cursor, back: boolean, size: Size): { to: Cursor; addRow: boolean } {
  if (!back) {
    if (at.c < size.cols - 1) return { to: { r: at.r, c: at.c + 1 }, addRow: false }
    if (at.r < size.rows - 1) return { to: { r: at.r + 1, c: 0 }, addRow: false }
    return { to: { r: size.rows, c: 0 }, addRow: true }
  }
  if (at.c > 0) return { to: { r: at.r, c: at.c - 1 }, addRow: false }
  if (at.r > -1) return { to: { r: at.r - 1, c: size.cols - 1 }, addRow: false }
  return { to: at, addRow: false }
}

/** Enter after typing: down one row; on the last row a new one is wanted. */
export function enterDown(at: Cursor, size: Size): { to: Cursor; addRow: boolean } {
  if (at.r < size.rows - 1) return { to: { r: at.r + 1, c: at.c }, addRow: false }
  return { to: { r: size.rows, c: at.c }, addRow: at.r >= 0 || size.rows === 0 }
}

export type Range = { r0: number; r1: number; c0: number; c1: number }

/** The rectangle between two cursors. */
export function rangeOf(a: Cursor, b: Cursor): Range {
  return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) }
}

/** A range that started in the body never reaches the header; one in the header stays in it. */
export function confine(anchor: Cursor, focus: Cursor): Cursor {
  return anchor.r < 0 ? { r: -1, c: focus.c } : { r: Math.max(0, focus.r), c: focus.c }
}

/** The body rows a range covers (the header is not a data row). */
export function bodyRows(range: Range): number[] {
  const out: number[] = []
  for (let r = Math.max(0, range.r0); r <= range.r1; r++) out.push(r)
  return out
}
