// Tab / Shift-Tab for markdown lists, as plain text edits so the editor and
// tests share them. Indenting nests an item under the one above it (at that
// item's content column: 2 spaces under "- ", 3 under "1. "); its sub-items move
// with it. Ordered lists that the move touches are renumbered.

export type LineEdit = { line: number; from: number; to: number; insert: string }

type Item = { indent: number; marker: string; ordered: boolean; num: number; delim: string; content: number }

const ITEM = /^( *)([-*+]|(\d{1,9})([.)]))( {1,4}|$)/

export function parseItem(text: string): Item | null {
  const m = ITEM.exec(text.replace(/\t/g, '    '))
  if (!m) return null
  const indent = m[1].length
  return { indent, marker: m[2], ordered: !!m[3], num: m[3] ? Number(m[3]) : 0, delim: m[4] ?? '', content: indent + m[2].length + Math.max(1, m[5].length) }
}

const indentOf = (text: string) => /^ */.exec(text)![0].length
const blank = (text: string) => !text.trim()

/** The list item a line belongs to (itself, or the item whose continuation it is). */
function ownerOf(lines: string[], n: number): number | null {
  for (let i = n; i >= 0; i--) {
    if (blank(lines[i])) return null
    const item = parseItem(lines[i])
    if (item && (i === n || indentOf(lines[n]) >= item.content)) return i
    if (!item && indentOf(lines[i]) === 0 && i !== n) return null
  }
  return null
}

/** Lines after item `i` that belong to it: deeper lines, and blank lines followed by deeper ones. */
function subtreeEnd(lines: string[], i: number): number {
  const base = indentOf(lines[i])
  let end = i
  for (let j = i + 1; j < lines.length; j++) {
    if (blank(lines[j])) continue
    if (indentOf(lines[j]) > base) end = j
    else break
  }
  return end
}

function shift(text: string, by: number): string {
  if (blank(text)) return text
  return by >= 0 ? ' '.repeat(by) + text : text.slice(Math.min(-by, indentOf(text)))
}

/**
 * Edits that indent (dir 1) or outdent (dir -1) the list items on lines
 * `from`..`to` (0-based). Null when none of those lines is in a list.
 */
export function indentListItems(source: string, from: number, to: number, dir: 1 | -1): LineEdit[] | null {
  const before = source.split('\n')
  const lines = [...before]
  const owners: number[] = []
  for (let n = from; n <= to; n++) {
    const o = ownerOf(lines, n)
    if (o !== null && !owners.includes(o)) owners.push(o)
  }
  if (!owners.length) return null
  let lo = Infinity
  let hi = -Infinity
  const moved = new Set<number>()
  for (const i of owners) {
    // A sub-item already moved along with its parent.
    if (moved.has(i)) continue
    const item = parseItem(lines[i])!
    let target: number | null = null
    if (dir === 1) {
      for (let j = i - 1; j >= 0; j--) {
        if (blank(lines[j])) continue
        const sib = parseItem(lines[j])
        const ind = indentOf(lines[j])
        if (ind > item.indent) continue
        if (sib && ind === item.indent) target = sib.content
        break
      }
    } else if (item.indent > 0) {
      target = 0
      for (let j = i - 1; j >= 0; j--) {
        const parent = parseItem(lines[j])
        if (parent && parent.indent < item.indent) { target = parent.indent; break }
        if (!blank(lines[j]) && !parent && indentOf(lines[j]) === 0) break
      }
    }
    if (target === null || target === item.indent) continue
    const end = subtreeEnd(lines, i)
    for (let j = i; j <= end; j++) {
      lines[j] = shift(lines[j], target - item.indent)
      moved.add(j)
    }
    lo = Math.min(lo, i)
    hi = Math.max(hi, end)
  }
  if (lo > hi) return []
  renumber(lines, lo, hi, moved, runStarts(before))
  const edits: LineEdit[] = []
  for (let n = 0; n < lines.length; n++) {
    const a = before[n]
    const b = lines[n]
    if (a === b) continue
    // Only the start of a line changes: keep the shared tail out of the edit.
    let tail = 0
    while (tail < a.length && tail < b.length && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
    edits.push({ line: n, from: 0, to: a.length - tail, insert: b.slice(0, b.length - tail) })
  }
  return edits
}

/** Lines that start an ordered run (no earlier item at their depth in the same list). */
function runStarts(lines: string[]): Set<number> {
  const starts = new Set<number>()
  const open = new Set<number>()
  lines.forEach((text, n) => {
    if (blank(text)) return
    const item = parseItem(text)
    if (!item) {
      if (indentOf(text) === 0) open.clear()
      return
    }
    for (const d of [...open]) if (d > item.indent) open.delete(d)
    if (item.ordered && !open.has(item.indent)) starts.add(n)
    if (item.ordered) open.add(item.indent)
    else open.delete(item.indent)
  })
  return starts
}

/**
 * Renumber the ordered runs in the list block around lines lo..hi. A run keeps
 * its first number unless its first item moved or only now starts a run.
 */
function renumber(lines: string[], lo: number, hi: number, moved: Set<number>, wasStart: Set<number>) {
  let start = lo
  while (start > 0 && !blank(lines[start - 1]) && (parseItem(lines[start - 1]) || indentOf(lines[start - 1]) > 0)) start--
  let end = hi
  while (end < lines.length - 1 && !blank(lines[end + 1]) && (parseItem(lines[end + 1]) || indentOf(lines[end + 1]) > 0)) end++
  // Open runs by indent: the last number used at that depth.
  const runs = new Map<number, number>()
  for (let n = start; n <= end; n++) {
    const item = parseItem(lines[n])
    if (!item) continue
    for (const d of [...runs.keys()]) if (d > item.indent) runs.delete(d)
    if (!item.ordered) { runs.delete(item.indent); continue }
    const prev = runs.get(item.indent)
    const num = prev === undefined ? (moved.has(n) || !wasStart.has(n) ? 1 : item.num) : prev + 1
    runs.set(item.indent, num)
    if (num !== item.num) lines[n] = lines[n].replace(/^( *)\d+/, `$1${num}`)
  }
}
