import { expect, it } from 'vitest'
import { agentObjectSchema, agentProposalSchema } from './agent.ts'
const note = { id: 'note-1', kind: 'card', type: 'note', boardId: 'board-1', x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', content: { md: '# Hello' }, createdAt: 1 }
it('accepts complete typed note, file and image objects', () => {
  expect(agentObjectSchema.safeParse(note).success).toBe(true)
  expect(agentObjectSchema.safeParse({ ...note, type: 'file', content: { assetId: 'existing-asset', name: 'notes.pdf', size: 1024, mime: 'application/pdf', status: 'ok' } }).success).toBe(true)
  expect(agentObjectSchema.safeParse({ ...note, type: 'image', content: { assetId: 'existing-asset', width: 600, height: 400, sizes: ['thumb', 'full'] } }).success).toBe(true)
})
it('rejects unknown metadata, malformed nested contents and unsafe link schemes', () => {
  expect(agentObjectSchema.safeParse({ ...note, owner_id: 'someone' }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...note, content: { md: 'text', html: '<script>' } }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...note, type: 'todo', content: { title: '', items: [{ id: 'task', text: 'bad', done: 'yes' }] } }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...note, type: 'link', content: { url: 'javascript:alert(1)' } }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...note, x: Infinity }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...note, id: 'constructor' }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...note, boardId: '__proto__' }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...note, type: 'column', columnId: 'other-column', content: { title: 'Invalid nesting' } }).success).toBe(false)
})
it('requires revisions for replacements and caps atomic proposal size', () => {
  const base = { idempotencyKey: 'request-123', label: 'Organize the board' }
  expect(agentProposalSchema.safeParse({ ...base, operations: [{ action: 'replace', object: note }] }).success).toBe(false)
  expect(agentProposalSchema.safeParse({ ...base, operations: [{ action: 'replace', object: note, expectedRevision: 10 }] }).success).toBe(true)
  expect(agentProposalSchema.safeParse({ ...base, operations: Array.from({ length: 201 }, () => ({ action: 'create', object: note })) }).success).toBe(false)
})
it('round-trips to-do lists with done times and list options', () => {
  const todo = { ...note, type: 'todo', content: { title: 'Chores', sortDone: false, hideDone: true, items: [{ id: 'a', text: 'Walk', done: true, doneAt: 1_700_000_000_000 }, { id: 'b', text: 'Feed', done: false, doneAt: null }, { id: 'c', text: 'Old', done: true }] } }
  expect(agentObjectSchema.safeParse(todo).success).toBe(true)
  expect(agentObjectSchema.safeParse({ ...todo, content: { ...todo.content, items: [{ id: 'a', text: 'Walk', done: true, doneAt: 'yesterday' }] } }).success).toBe(false)
})

it('takes movie cards that name their title, with or without fetched details', () => {
  const card = { id: 'film-1', kind: 'card', type: 'movie', boardId: 'board-1', x: 0, y: 0, w: 300, h: 162, z: 1, color: 'none', createdAt: 1 }
  expect(agentObjectSchema.safeParse({ ...card, content: { kind: 'movie', tmdbId: 157336, title: 'Interstellar', status: 'pending' } }).success).toBe(true)
  expect(agentObjectSchema.safeParse({ ...card, content: { kind: 'tv', title: 'Severance', imdbId: 'tt11280740', status: 'pending' } }).success).toBe(true)
  // A full card read back from a board (poster, details) can be replaced as is.
  const full = { kind: 'movie', tmdbId: 157336, title: 'Interstellar', year: 2014, assetId: 'poster-1', watched: true, watchedAt: 5, details: true, status: 'ok',
    info: { runtime: 169, genres: ['Drama'], overview: 'Space.', providers: { region: 'US', link: 'https://www.themoviedb.org/watch', stream: ['Paramount Plus'] }, fetchedAt: 4 } }
  expect(agentObjectSchema.safeParse({ ...card, content: full }).success).toBe(true)
  // No id to look it up by; a bad IMDb id; a script link; extra fields.
  for (const content of [{ kind: 'movie', title: 'Something good' }, { kind: 'movie', title: 'x', imdbId: 'nm0000190' }, { ...full, info: { ...full.info, providers: { region: 'US', link: 'javascript:alert(1)' } } }, { ...full, poster: 'https://example.com/p.jpg' }])
    expect(agentObjectSchema.safeParse({ ...card, content }).success).toBe(false)
})
