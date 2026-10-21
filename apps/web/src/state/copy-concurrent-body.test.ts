import { beforeEach, expect, it, vi } from 'vitest'
import { duplicateObjects, isAlive, noteMarkdown, type Card, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'

vi.mock('./idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))

const source: Obj[] = [
  { id: 'source', kind: 'board', parentId: null, title: 'Source brief', icon: 'paw', color: 'none', createdAt: 1 },
  ...['overview', 'research'].map((id) => ({ id, kind: 'card', type: 'note', boardId: 'source', x: 10, y: 20, w: 260, h: 80, z: 1, color: 'none', content: { md: 'Original project brief' }, noteGroupId: 'source-group', createdAt: 1 }) as Obj),
]

beforeEach(async () => {
  await doc.load({ persist: false, readOnly: false })
  doc.setWriteGuard(() => true)
  doc.loadSnapshot(structuredClone(source))
})

it.each(['independent selection', 'linked copied tree'] as const)('keeps a collaborator body through creation Undo/Redo of an %s', (mode) => {
  const copied = duplicateObjects(source, mode === 'independent selection'
    ? { selectionIds: ['overview'], targetBoardId: 'source' }
    : { rootBoardId: 'source' })
  doc.commit(copied.objects.map(doc.createChange))
  const notes = copied.objects.filter((object) => object.kind === 'card' && object.type === 'note')
  expect(notes).toHaveLength(mode === 'independent selection' ? 1 : 2)
  const peerBody = 'A collaborator continued this project brief'
  // The real shared-body server fans a revision out to every copied instance.
  doc.receiveRemote(notes.map((note) => ({ ...note, content: { md: peerBody } }) as Obj))
  for (const note of notes) expect(noteMarkdown(doc.getCard(note.id)! as Card<'note'>)).toBe(peerBody)
  doc.undo()
  doc.redo()
  for (const note of notes) {
    expect(isAlive(doc.get(note.id))).toBe(true)
    expect(noteMarkdown(doc.getCard(note.id)! as Card<'note'>)).toBe(peerBody)
  }
  for (const id of ['overview', 'research']) expect(noteMarkdown(doc.getCard(id)! as Card<'note'>)).toBe('Original project brief')
})


it.each(['independent selection', 'linked copied tree'] as const)('refuses the complete %s creation Undo and preserves its history after a peer body', (mode) => {
  const copied = duplicateObjects(source, mode === 'independent selection'
    ? { selectionIds: ['overview'], targetBoardId: 'source' }
    : { rootBoardId: 'source' })
  doc.commit(copied.objects.map(doc.createChange))
  const notes = copied.objects.filter((object) => object.kind === 'card' && object.type === 'note')
  const body = 'Peer text must survive a later measurement and refused Undo'
  doc.receiveRemote(notes.map((note) => ({ ...note, content: { md: body } }) as Obj))
  doc.amendOrSilent(notes[0]!.id, { h: 137 })
  doc.undo()
  expect(copied.objects.every((object) => isAlive(doc.get(object.id)))).toBe(true)
  expect(doc.canUndo()).toBe(true)
  expect(doc.canRedo()).toBe(false)
  doc.redo()
  expect(copied.objects.every((object) => isAlive(doc.get(object.id)))).toBe(true)
  for (const note of notes) expect(noteMarkdown(doc.getCard(note.id)! as Card<'note'>)).toBe(body)
})

it.each(['independent selection', 'linked copied tree'] as const)('keeps ordinary %s creation Undo/Redo usable after only height and background metadata changes', (mode) => {
  const copied = duplicateObjects(source, mode === 'independent selection'
    ? { selectionIds: ['overview'], targetBoardId: 'source' }
    : { rootBoardId: 'source' })
  doc.commit(copied.objects.map(doc.createChange))
  const notes = copied.objects.filter((object) => object.kind === 'card' && object.type === 'note')
  doc.receiveRemote(notes.map((note) => ({ ...note, h: 143, color: 'sky' }) as Obj))
  doc.amendOrSilent(notes[0]!.id, { h: 151 })
  doc.undo()
  expect(copied.objects.some((object) => isAlive(doc.get(object.id)))).toBe(false)
  doc.redo()
  expect(copied.objects.every((object) => isAlive(doc.get(object.id)))).toBe(true)
  for (const note of notes) expect(noteMarkdown(doc.getCard(note.id)! as Card<'note'>)).toBe('Original project brief')
})

it('uses the amended creation body for normal initial typing Undo/Redo', () => {
  const note = { ...source[1]!, id: 'initial-note', noteGroupId: null, content: { md: '' } } as Obj
  doc.commit([doc.createChange(note)])
  doc.transient(note.id, { content: { md: 'Initial typing folded into creation' } } as Partial<Obj>)
  doc.amendOrCommit(note.id, { content: { md: '' } } as Partial<Obj>)
  doc.undo()
  expect(isAlive(doc.get(note.id))).toBe(false)
  doc.redo()
  expect(noteMarkdown(doc.getCard(note.id)! as Card<'note'>)).toBe('Initial typing folded into creation')
})

it('permits body Undo followed by creation Undo after the local edit is reversed', () => {
  const copied = duplicateObjects(source, { selectionIds: ['overview'], targetBoardId: 'source' })
  doc.commit(copied.objects.map(doc.createChange))
  const note = copied.objects.find((object) => object.kind === 'card' && object.type === 'note')!
  doc.update({ [note.id]: { content: { md: 'Later local edit' } } as Partial<Obj> })
  doc.undo()
  expect(noteMarkdown(doc.getCard(note.id)! as Card<'note'>)).toBe('Original project brief')
  doc.undo()
  expect(isAlive(doc.get(note.id))).toBe(false)
  doc.redo(); doc.redo()
  expect(noteMarkdown(doc.getCard(note.id)! as Card<'note'>)).toBe('Later local edit')
})

it('compares semantic Markdown when a legacy copied body is converted without changing its text', () => {
  const legacy = source.map((object) => object.kind === 'card' && object.type === 'note'
    ? { ...object, content: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original project brief' }] }] } } } as Obj : object)
  const copied = duplicateObjects(legacy, { selectionIds: ['overview'], targetBoardId: 'source' })
  doc.commit(copied.objects.map(doc.createChange))
  const note = copied.objects.find((object) => object.kind === 'card' && object.type === 'note')!
  doc.receiveRemote([{ ...note, content: { md: 'Original project brief' } } as Obj])
  doc.undo()
  expect(isAlive(doc.get(note.id))).toBe(false)
})
