import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('./access.ts', () => ({ canEditBoard: () => true }))
vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))
import type { Board, Card } from '@doggynote/core'
let doc: typeof import('./doc.ts')
const note = (id: string, boardId: string, extra: Partial<Card> = {}) => ({ id, kind: 'card', type: 'note', boardId, noteGroupId: 'g', x: 0, y: 0, w: 260, h: 60, z: 0, color: 'none', content: { md: 'Original' }, createdAt: 1, ...extra }) as Card<'note'>
beforeEach(async () => {
  vi.resetModules()
  doc = await import('./doc.ts')
  await doc.load({ persist: false, readOnly: false })
  doc.loadSnapshot([note('one', 'overview'), note('two', 'research')])
})
it('typing, committed edits and Undo/Redo share bodies without changing instance layout', () => {
  const before = Object.fromEntries(doc.noteBodyMembers(doc.getCard('one')!).map((n) => [n.id, doc.snapshot(n.id, ['content'])]))
  doc.transient('one', { content: { md: 'Typing' } } as Partial<Card>)
  expect(doc.getCard('two')?.content).toEqual({ md: 'Typing' })
  expect(doc.commitFrom(before)).toBe(true)
  doc.update({ two: { x: 72, color: 'gold' } })
  expect(doc.getCard('one')).toMatchObject({ x: 0, color: 'none' })
  doc.undo()
  doc.undo()
  expect(doc.getCard('one')?.content).toEqual({ md: 'Original' })
  expect(doc.getCard('two')?.content).toEqual({ md: 'Original' })
  doc.redo()
  expect(doc.getCard('two')?.content).toEqual({ md: 'Typing' })
  expect(doc.getCard('two')?.noteGroupId).toBe('g')
})
it('body undo follows current membership, so a remote unlink is not undone', () => {
  doc.update({ one: { content: { md: 'Edited' } } as Partial<Card> })
  doc.receiveRemote([note('two', 'research', { noteGroupId: null, content: { md: 'Independent' } } as Partial<Card>)])
  // Clear source outbox is unnecessary with persistence disabled.
  doc.undo()
  expect(doc.getCard('one')?.content).toEqual({ md: 'Original' })
  expect(doc.getCard('two')).toMatchObject({ noteGroupId: null, content: { md: 'Independent' } })
})
it('projected read-only body blocks typing and body updates while allowing local geometry and unlink', () => {
  doc.receiveRemote([note('one', 'overview', { noteBodyReadOnly: true })])
  doc.transient('one', { content: { md: 'Unauthorized' } } as Partial<Card>)
  doc.update({ one: { content: { md: 'Unauthorized' } } as Partial<Card> })
  expect(doc.getCard('two')?.content).toEqual({ md: 'Original' })
  doc.update({ one: { x: 42 } })
  expect(doc.getCard('one')?.x).toBe(42)
  doc.update({ one: { noteGroupId: null, noteBodyReadOnly: false, content: { md: 'Separate' } } as Partial<Card> })
  expect(doc.getCard('one')?.content).toEqual({ md: 'Separate' })
  expect(doc.getCard('two')?.content).toEqual({ md: 'Original' })
})

it('queues shared edits atomically with expected membership and retains later typing during acknowledgement', async () => {
  await doc.load({ persist: true, readOnly: false })
  doc.loadSnapshot([note('one', 'overview'), note('two', 'research')])
  doc.update({ one: { content: { md: 'First edit' } } as Partial<Card> })
  const sent = doc.pendingOutbox()
  expect(sent.find((ch) => ch.id === 'one')?.patch).toMatchObject({ noteBodyEdit: { groupId: 'g', md: 'First edit' } })
  expect(sent.find((ch) => ch.id === 'one')?.patch).not.toHaveProperty('content')
  doc.update({ one: { content: { md: 'Later typing' } } as Partial<Card> })
  doc.ackOutbox(sent)
  expect(doc.pendingOutbox().find((ch) => ch.id === 'one')?.patch).toMatchObject({ noteBodyEdit: { groupId: 'g', md: 'Later typing' } })
  doc.receiveRemote([note('two', 'research', { noteGroupId: null, content: { md: 'Independent remote text' } } as Partial<Card>)])
  expect(doc.getCard('two')?.content).toEqual({ md: 'Independent remote text' })
  await doc.flush()
})
it('unlink replaces queued group intent with a local body snapshot', async () => {
  await doc.load({ persist: true, readOnly: false })
  doc.loadSnapshot([note('one', 'overview'), note('two', 'research')])
  doc.update({ one: { content: { md: 'Typing before unlink' } } as Partial<Card> })
  doc.update({ one: { noteGroupId: null, content: { md: 'My independent version' } } as Partial<Card> })
  const patch = doc.pendingOutbox().find((ch) => ch.id === 'one')!.patch
  expect(patch).toMatchObject({ noteGroupId: null, content: { md: 'My independent version' } })
  expect(patch).not.toHaveProperty('noteBodyEdit')
  await doc.flush()
})

it('a read-only shared body remains selectable for local style, unlink and focused reading', async () => {
  vi.stubGlobal('location', { pathname: '/', hash: '' })
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  try {
    const ui = await import('./ui.ts')
    doc.receiveRemote([note('one', 'overview', { noteBodyReadOnly: true })])
    ui.beginEdit('one')
    expect(ui.editingId()).toBeNull()
    expect([...ui.selection()]).toEqual(['one'])
    ui.focusNote('one')
    expect(ui.focusedNoteId()).toBe('one')
    expect(ui.editingId()).toBeNull()
    expect(doc.getCard('one')?.content).toEqual({ md: 'Original' })
  } finally { vi.unstubAllGlobals() }
})

it('redoing synced-copy creation uses a source body changed by another session while unlinked', () => {
  doc.loadSnapshot([note('one', 'overview', { noteGroupId: null })])
  doc.commit([...doc.changesFor({ one: { noteGroupId: 'g' } }), doc.createChange(note('copy', 'research'))])
  doc.undo()
  doc.receiveRemote([note('one', 'overview', { noteGroupId: null, content: { md: 'Remote independent revision' } } as Partial<Card>)])
  doc.redo()
  expect(doc.getCard('one')?.content).toEqual({ md: 'Remote independent revision' })
  expect(doc.getCard('copy')).toMatchObject({ noteGroupId: 'g', purged: false, content: { md: 'Remote independent revision' } })
})

it('undo of an old synced-copy action does not detach an instance regrouped by another session', () => {
  doc.loadSnapshot([note('one', 'overview', { noteGroupId: null })])
  doc.commit([...doc.changesFor({ one: { noteGroupId: 'g' } }), doc.createChange(note('copy', 'research'))])
  doc.receiveRemote([note('one', 'overview', { noteGroupId: 'another-group', content: { md: 'New shared brief' } } as Partial<Card>)])
  doc.undo()
  expect(doc.getCard('one')).toMatchObject({ noteGroupId: 'another-group', content: { md: 'New shared brief' } })
  expect(doc.getCard('copy')?.purged).toBe(false)
})

it('creating the first synced copy converts a legacy rich note without losing its text', async () => {
  vi.stubGlobal('location', { pathname: '/', hash: '' })
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  try {
    doc.loadSnapshot([note('one', 'overview', { noteGroupId: null, content: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Legacy project brief' }] }] } } } as Partial<Card>)])
    doc.receiveRemote(['overview', 'research'].map((id) => ({ id, kind: 'board', title: id, parentId: null, icon: 'paw', color: 'none', createdAt: 1 }) as Board))
    const { copyNote } = await import('./synced-notes.ts')
    const copy = copyNote('one', 'research', true)
    expect(copy).toBeTruthy()
    expect(doc.getCard('one')?.content).toEqual({ md: 'Legacy project brief' })
    expect(doc.getCard(copy)?.content).toEqual({ md: 'Legacy project brief' })
    expect(doc.getCard('one')?.noteGroupId).toBe(doc.getCard(copy)?.noteGroupId)
  } finally { vi.unstubAllGlobals() }
})
