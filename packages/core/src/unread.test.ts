import { describe, expect, it } from 'vitest'
import type { Comment } from './model.ts'
import { commentTime, readMark, unreadByBoard, unreadThreads } from './unread.ts'

const c = (id: string, cardId: string, authorId: string, postedAt: number, extra: Partial<Comment> = {}): Comment =>
  ({ id, kind: 'comment', boardId: 'b', cardId, authorId, author: authorId, text: id, createdAt: 1, postedAt, ...extra }) as Comment

describe('unread comments', () => {
  const threads = new Map([
    ['card1', [c('a', 'card1', 'fido', 10), c('b', 'card1', 'rex', 20), c('c', 'card1', 'fido', 30)]],
    ['card2', [c('d', 'card2', 'rex', 40)]],
  ])

  it("counts other people's comments after the read mark, never your own", () => {
    expect(unreadThreads(threads, { since: 0, threads: {} }, 'rex').map((t) => [t.cardId, t.count])).toEqual([['card1', 2]])
    expect(unreadThreads(threads, { since: 0, threads: { card1: 10 } }, 'rex')[0]).toMatchObject({ count: 1, latest: { id: 'c' } })
    expect(unreadThreads(threads, { since: 0, threads: { card1: 30 } }, 'rex')).toEqual([])
    expect(unreadThreads(threads, { since: 0, threads: {} }, 'fido').map((t) => t.cardId).sort()).toEqual(['card1', 'card2'])
  })

  it('ignores the backlog from before unread existed, deleted comments and buried cards', () => {
    expect(unreadThreads(threads, { since: 30, threads: {} }, 'rex')).toEqual([])
    const gone = new Map([['card1', [c('a', 'card1', 'fido', 10, { deletedAt: 5 }), c('b', 'card1', 'fido', 11, { purged: true })]]])
    expect(unreadThreads(gone, { since: 0, threads: {} }, 'rex')).toEqual([])
    expect(unreadThreads(threads, { since: 0, threads: {} }, 'rex', (id) => id !== 'card1')).toEqual([])
  })

  it('marks a thread read up to the newest comment by someone else', () => {
    expect(readMark(threads.get('card1')!, 'rex')).toBe(30)
    expect(readMark(threads.get('card2')!, 'rex')).toBe(0)
  })

  it('uses the server stamp, falling back to createdAt for older comments', () => {
    expect(commentTime({ createdAt: 5, postedAt: 9 })).toBe(9)
    expect(commentTime({ createdAt: 5 })).toBe(5)
  })

  it('rolls counts up through parent boards and survives a cycle', () => {
    const parents: Record<string, string | null> = { b: 'p', p: 'root', root: null, x: 'y', y: 'x' }
    const unread = unreadThreads(threads, { since: 0, threads: {} }, 'rex')
    expect([...unreadByBoard(unread, (id) => parents[id])]).toEqual([['b', 2], ['p', 2], ['root', 2]])
    expect([...unreadByBoard([{ ...unread[0], boardId: 'x' }], (id) => parents[id])]).toEqual([['x', 2], ['y', 2]])
  })
})
