// Copy, cut, paste and duplicate for cards. A clip is a self-contained set of
// objects: the picked cards, the cards inside picked columns, the connections
// between them, and for board cards the whole board inside (deep copy). Pasting
// gives everything new ids, keeps the layout around the paste point, and is
// ordered so every object arrives after the ones it refers to.

import type { Board, Card, Connection, Id, Obj } from './model.ts'
import type { Rect, Vec } from './geometry.ts'
import { cardText } from './cardtext.ts'
import { tmdbPage } from './movie.ts'

export const CLIP_MIME = 'application/x-doggynote+json'
export const CLIP_LIMIT = 500

export type ClipPayload = {
  v: 1
  app: 'doggynote'
  /** The board the clip came from. */
  boardId: Id
  /** The picked cards, in their world positions (cards from inside a column come out free). */
  roots: Id[]
  objects: Obj[]
  /** Set by cut: the burial stamp, so a paste can bring the very same cards back. */
  cut?: { at: number }
}

export type ClipSource = {
  get(id: Id): Obj | undefined
  /** Every live object (not purged, not buried), for walking boards. */
  all(): Iterable<Obj>
  /** World rect of a card (cards in a column have no x/y of their own). */
  rect(id: Id): Rect | null
}

const alive = (o: Obj | undefined) => !!o && !o.purged && !o.deletedAt && !(o as { hidden?: boolean }).hidden

/** Gather a clip for the picked card ids. Null if there's nothing to copy; 'too-big' past CLIP_LIMIT objects. */
export function collectClip(ids: Id[], src: ClipSource, opts: { allowBuried?: boolean } = {}): ClipPayload | 'too-big' | null {
  const ok = (o: Obj | undefined): o is Obj => (opts.allowBuried ? !!o && !o.purged : alive(o))
  const picked = ids.map((id) => src.get(id)).filter((o): o is Card => ok(o) && o.kind === 'card')
  if (!picked.length) return null
  const all = [...src.all()].filter((o) => alive(o))
  const objects = new Map<Id, Obj>()
  const add = (o: Obj) => objects.set(o.id, structuredClone(o))
  // Roots, flattened to world positions.
  for (const c of picked) {
    const r = src.rect(c.id)
    add({ ...c, ...(r && c.columnId && !ids.includes(c.columnId) ? { x: r.x, y: r.y, columnId: null } : {}) } as Card)
  }
  const boardsToCopy: Id[] = []
  const queue = [...picked]
  while (queue.length) {
    const c = queue.shift()!
    if (c.type === 'column') for (const k of all) if (k.kind === 'card' && k.columnId === c.id && !objects.has(k.id)) { add(k); queue.push(k as Card) }
    if (c.type === 'board') boardsToCopy.push((c as Card<'board'>).content.boardId)
  }
  // Board cards copy the board inside them, all the way down.
  for (let i = 0; i < boardsToCopy.length; i++) {
    const b = src.get(boardsToCopy[i])
    if (!b || b.kind !== 'board' || objects.has(b.id)) continue
    add(b)
    for (const o of all) {
      if (o.kind === 'comment') continue
      if (o.kind === 'board' && o.parentId === b.id) continue // reached through its board card
      if ('boardId' in o && o.boardId === b.id) {
        add(o)
        if (o.kind === 'card' && o.type === 'board') boardsToCopy.push((o as Card<'board'>).content.boardId)
      }
    }
    if (objects.size > CLIP_LIMIT) return 'too-big'
  }
  // Connections whose both ends came along.
  for (const o of all) if (o.kind === 'connection' && objects.has(o.from) && objects.has(o.to)) add(o)
  if (objects.size > CLIP_LIMIT) return 'too-big'
  return { v: 1, app: 'doggynote', boardId: picked[0].boardId, roots: picked.map((c) => c.id), objects: [...objects.values()] }
}

export type Materialised = { objects: Obj[]; roots: Id[] }

/**
 * New objects for pasting `clip` onto `boardId`, the picked cards' bounds
 * centred on `at` (or appended to `column`). Boards first, then columns, then
 * cards, then connections.
 */
export function materialise(
  clip: ClipPayload,
  opts: { at: Vec; boardId: Id; maxZ: number; now: number; newId: () => Id; column?: { id: Id; orders: number[] } },
): Materialised {
  const ids = new Map<Id, Id>()
  for (const o of clip.objects) ids.set(o.id, opts.newId())
  const map = (id: Id | null | undefined) => (id ? (ids.get(id) ?? id) : id)
  const rootSet = new Set(clip.roots)
  const roots = clip.objects.filter((o): o is Card => rootSet.has(o.id) && o.kind === 'card')
  // Layout: the roots' bounding box, centred on the paste point.
  const minX = Math.min(...roots.map((c) => c.x))
  const minY = Math.min(...roots.map((c) => c.y))
  const maxX = Math.max(...roots.map((c) => c.x + c.w))
  const maxY = Math.max(...roots.map((c) => c.y + (c.h || 0)))
  const dx = Math.round(opts.at.x - (minX + maxX) / 2)
  const dy = Math.round(opts.at.y - (minY + maxY) / 2)
  // Stacking keeps its order, above everything already there.
  const zRank = new Map([...roots].sort((a, b) => a.z - b.z).map((c, i) => [c.id, i + 1]))
  // Into a column: free cards (not columns) stack in reading order.
  const intoColumn = opts.column ? [...roots].filter((c) => c.type !== 'column').sort((a, b) => a.y - b.y || a.x - b.x) : []
  const out: Obj[] = []
  for (const o of clip.objects) {
    const base = { ...structuredClone(o), id: ids.get(o.id)!, createdAt: opts.now, deletedAt: null, purged: false } as Obj & { hidden?: unknown }
    delete base.hidden
    if (base.kind === 'board') {
      // Copied boards inside copied boards keep their nesting; the top ones hang under the paste board.
      const parent = (o as Board).parentId
      ;(base as Board).parentId = clip.objects.some((x) => x.id === parent) ? map(parent)! : opts.boardId
    } else if (base.kind === 'card') {
      const c = base as Card
      const orig = o as Card
      const onSource = orig.boardId === clip.boardId
      c.boardId = onSource ? opts.boardId : map(orig.boardId)!
      if (rootSet.has(o.id)) {
        const slot = intoColumn.findIndex((r) => r.id === o.id)
        if (opts.column && slot >= 0) Object.assign(c, { columnId: opts.column.id, order: opts.column.orders[slot], x: 0, y: 0 })
        else Object.assign(c, { columnId: null, x: orig.x + dx, y: orig.y + dy, z: opts.maxZ + zRank.get(o.id)! })
      } else if (orig.columnId) c.columnId = map(orig.columnId)
      if (c.type === 'board') (c as Card<'board'>).content = { ...(c as Card<'board'>).content, boardId: map((orig as Card<'board'>).content.boardId)! }
    } else if (base.kind === 'connection') {
      const c = base as Connection
      const orig = o as Connection
      c.boardId = orig.boardId === clip.boardId ? opts.boardId : map(orig.boardId)!
      c.from = map(orig.from)!
      c.to = map(orig.to)!
    }
    out.push(base)
  }
  const rank = (o: Obj) => (o.kind === 'board' ? 0 : o.kind === 'card' ? ((o as Card).type === 'column' ? 1 : 2) : 3)
  // Boards nest: a parent before its children.
  const boards = out.filter((o) => o.kind === 'board') as Board[]
  const depth = (b: Board): number => { const p = boards.find((x) => x.id === b.parentId); return p ? 1 + depth(p) : 0 }
  out.sort((a, b) => rank(a) - rank(b) || (a.kind === 'board' && b.kind === 'board' ? depth(a as Board) - depth(b as Board) : 0))
  return { objects: out, roots: roots.map((c) => ids.get(c.id)!) }
}

/** The clip as readable markdown, in reading order: what other apps get. */
export function clipText(clip: ClipPayload, boardTitle: (id: Id) => string = () => 'Board'): string {
  const byId = new Map(clip.objects.map((o) => [o.id, o]))
  const roots = clip.roots.map((id) => byId.get(id)).filter((o): o is Card => o?.kind === 'card').sort((a, b) => a.y - b.y || a.x - b.x)
  const text = (c: Card): string => {
    switch (c.type) {
      case 'note':
        return (c as Card<'note'>).content.md ?? ''
      case 'todo': {
        const t = (c as Card<'todo'>).content
        return [t.title, ...t.items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`)].filter(Boolean).join('\n')
      }
      case 'link': {
        const l = (c as Card<'link'>).content
        return l.title ? `[${l.title}](${l.url})` : l.url
      }
      case 'column': {
        const kids = clip.objects.filter((k): k is Card => k.kind === 'card' && k.columnId === c.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        return [`## ${(c as Card<'column'>).content.title || 'Column'}`, ...kids.map(text)].join('\n\n')
      }
      case 'board': {
        const b = byId.get((c as Card<'board'>).content.boardId) as Board | undefined
        return b?.title || boardTitle((c as Card<'board'>).content.boardId)
      }
      case 'movie': {
        const m = (c as Card<'movie'>).content
        if (!m.title) return ''
        const name = m.year ? `${m.title} (${m.year})` : m.title
        const page = tmdbPage(m)
        return `${page ? `[${name}](${page})` : name}${m.watched ? ' ✓ watched' : ''}`
      }
      default:
        return cardText(c)
    }
  }
  return roots.map(text).filter(Boolean).join('\n\n')
}

/** A light shape check for clips read back from the clipboard (other tabs, other apps). */
export function parseClip(raw: string | null | undefined): ClipPayload | null {
  if (!raw) return null
  try {
    const c = JSON.parse(raw)
    if (c?.app !== 'doggynote' || c.v !== 1 || !Array.isArray(c.roots) || !Array.isArray(c.objects) || typeof c.boardId !== 'string') return null
    if (c.objects.length > CLIP_LIMIT || !c.objects.every((o: Obj) => o && typeof o.id === 'string' && ['card', 'board', 'connection'].includes(o.kind))) return null
    return c as ClipPayload
  } catch {
    return null
  }
}
