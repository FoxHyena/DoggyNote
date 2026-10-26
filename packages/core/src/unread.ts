import type { Comment, Id } from './model.ts'

// Unread comments. The server keeps, per person, how far into each thread they
// have read (`threads`), plus `since`: when they first used a version with
// unread dots, so the backlog from before doesn't light up all at once.
// Unread is worked out from the comments a device already has. Sync only ever
// hands a device what that person may read, so nothing private can count.

export type Seen = { since: number; threads: Record<Id, number> }

/** When a comment arrived. Comments from before the server stamp fall back to createdAt. */
export const commentTime = (c: Pick<Comment, 'createdAt' | 'postedAt'>): number =>
  typeof c.postedAt === 'number' && Number.isFinite(c.postedAt) ? c.postedAt : Number(c.createdAt) || 0

export type UnreadThread = { cardId: Id; boardId: Id; count: number; latest: Comment; at: number }

/** Comments by someone else newer than the thread's read mark. Your own never count. */
export function unreadIn(cardId: Id, messages: readonly Comment[], seen: Seen, me: Id): UnreadThread | null {
  const mark = Math.max(seen.since, seen.threads[cardId] ?? 0)
  let count = 0
  let latest: Comment | null = null
  let at = 0
  for (const m of messages) {
    if (m.deletedAt || m.purged || m.authorId === me) continue
    const t = commentTime(m)
    if (t <= mark) continue
    count++
    if (!latest || t >= at) { latest = m; at = t }
  }
  return latest ? { cardId, boardId: latest.boardId, count, latest, at } : null
}

/** Every unread thread, newest first. `alive` says whether the card is still on a board. */
export function unreadThreads(threads: Iterable<[Id, readonly Comment[]]>, seen: Seen, me: Id, alive: (cardId: Id) => boolean = () => true): UnreadThread[] {
  const out: UnreadThread[] = []
  for (const [cardId, messages] of threads) {
    if (!alive(cardId)) continue
    const t = unreadIn(cardId, messages, seen, me)
    if (t) out.push(t)
  }
  return out.sort((a, b) => b.at - a.at)
}

/** The read mark covering everything someone else has said in a thread, or 0 if nobody has. */
export function readMark(messages: readonly Comment[], me: Id): number {
  let mark = 0
  for (const m of messages) if (m.authorId !== me && !m.deletedAt && !m.purged) mark = Math.max(mark, commentTime(m))
  return mark
}

/** Unread counts per board, added up through parent boards, so a board shows what's inside it. */
export function unreadByBoard(threads: readonly UnreadThread[], parentOf: (boardId: Id) => Id | null | undefined): Map<Id, number> {
  const out = new Map<Id, number>()
  for (const t of threads) {
    const seen = new Set<Id>()
    let b: Id | null | undefined = t.boardId
    while (b && !seen.has(b)) {
      seen.add(b)
      out.set(b, (out.get(b) ?? 0) + t.count)
      b = parentOf(b)
    }
  }
  return out
}
