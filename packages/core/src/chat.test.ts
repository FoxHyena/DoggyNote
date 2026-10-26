import { describe, expect, it } from 'vitest'
import type { Card, Connection } from './model.ts'
import { assembleContext, branchHistory, providerInput, publicChatCard, CHAT_LIMITS, type ChatTurn } from './chat.ts'

const chat = { id: 'chat', kind: 'card', type: 'chat', boardId: 'board', content: { title: 'Test', provider: 'claude' } } as Card<'chat'>
const card = (id: string, type: string, content: unknown, extra = {}) => ({ id, kind: 'card', type, boardId: 'board', content, ...extra }) as Card
const link = (from: string, extra = {}) => ({ id: `link-${from}`, kind: 'connection', from, to: 'chat', boardId: 'board', purpose: 'context', ...extra }) as Connection
const records = (...cards: Card[]) => new Map(cards.map((card, i) => [card.id, { card, revision: i + 1 }]))
const turnBase = { id: 'm', ordinal: 0, provider: 'claude' as const, status: 'completed' as const, authorId: 'rex', createdAt: 1, finishedAt: 2, usage: null, error: null }
const empty = { sources: [], excluded: [], characters: 0, estimatedTokens: 0 }

describe('connected context', () => {
  it('captures exact Markdown and task states, deduplicating only direct explicit sources', () => {
    const a = card('a', 'note', { md: '# A\n**Exact** markdown' })
    const b = card('b', 'todo', { title: 'Kickoff', items: [{ text: 'Ask Sam', done: false }, { text: 'Book room', done: true }] })
    const snapshot = assembleContext(chat, [link('b'), link('a'), link('a'), link('decorative', { purpose: null }), link('recursive', { to: 'a' })], records(a, b, card('unlinked', 'note', { md: 'SECRET' })))
    expect(snapshot.sources.map((s) => [s.id, s.text])).toEqual([['a', '# A\n**Exact** markdown'], ['b', 'Kickoff\n- [ ] Ask Sam\n- [x] Book room']])
    expect(JSON.stringify(snapshot)).not.toContain('SECRET')
    expect(snapshot.estimatedTokens).toBe(Math.ceil(snapshot.characters / 4))
  })

  it('does not reveal unavailable labels and explains malformed and unsupported sources', () => {
    const snapshot = assembleContext(chat, [link('private'), link('bad'), link('file'), link('gone')], records(
      card('private', 'note', { md: 'SECRET' }, { boardId: 'other' }), card('bad', 'todo', { title: null, items: [] }), card('file', 'file', { name: 'secret.pdf' })))
    expect(snapshot.sources).toEqual([])
    expect(snapshot.excluded).toHaveLength(4)
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|secret.pdf/)
  })

  it('keeps old snapshots stable across edits and disconnects', () => {
    const a = card('a', 'note', { md: 'Before' }), map = records(a)
    const before = assembleContext(chat, [link('a')], map)
    a.content = { md: 'After' }
    map.get('a')!.revision = 3
    const after = assembleContext(chat, [link('a')], map)
    expect(before.sources[0]).toMatchObject({ text: 'Before', revision: 1 })
    expect(after.sources[0]).toMatchObject({ text: 'After', revision: 3 })
    expect(assembleContext(chat, [], map).sources).toEqual([])
  })

  it('rejects too many or oversized sources and serialized history instead of truncating', () => {
    expect(() => assembleContext(chat, Array.from({ length: 25 }, (_, i) => link(`n${i}`)), records())).toThrow('at most 24')
    expect(() => assembleContext(chat, [link('a')], records(card('a', 'note', { md: 'a'.repeat(CHAT_LIMITS.contextChars + 1) })))).toThrow('Nothing was sent')
    expect(() => providerInput([], 'x'.repeat(CHAT_LIMITS.promptChars + 1), empty)).toThrow('at most')
    expect(() => providerInput([{ ...turnBase, prompt: 'a', answer: 'a'.repeat(CHAT_LIMITS.inputChars), context: empty } as ChatTurn], 'Next', empty)).toThrow('Nothing was sent')
  })
})

it('branches through a completed answer without future parent leakage or mutable aliases', () => {
  const turns = [0, 1, 2].map((ordinal) => ({ ...turnBase, id: `m${ordinal}`, ordinal, status: 'completed', prompt: `User ${ordinal}`, answer: `Assistant ${ordinal}`, context: empty }) as ChatTurn)
  const branch = branchHistory(turns, 'm1')
  expect(branch).toHaveLength(2)
  turns[0]!.answer = 'Changed parent'
  expect(branch[0]!.answer).toBe('Assistant 0')
  const input = providerInput(branch, 'Alternative', empty)
  expect(input).toContain('Assistant 1')
  expect(input).not.toContain('Assistant 2')
  expect(() => branchHistory([{ ...turns[0]!, status: 'interrupted' }], 'm0')).toThrow('completed answer')
})

it('public chat allowlist drops all transcript, context, title and unknown synced fields', () => {
  const safe = publicChatCard({ ...chat, content: { title: 'Secret topic', transcript: 'private' }, context: { text: 'hidden' }, noteState: 'hidden', surprise: 'hidden' })
  expect(safe.content).toEqual({ title: 'Conversation', provider: 'claude' })
  expect(JSON.stringify(safe)).not.toMatch(/Secret topic|private|hidden|surprise/)
})
