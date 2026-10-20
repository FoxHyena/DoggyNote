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
  expect(agentObjectSchema.safeParse({ ...note, type: 'column', columnId: 'other-column', content: { title: 'Invalid nesting' } }).success).toBe(false)
})
it('requires revisions for replacements and caps atomic proposal size', () => {
  const base = { idempotencyKey: 'request-123', label: 'Organize the board' }
  expect(agentProposalSchema.safeParse({ ...base, operations: [{ action: 'replace', object: note }] }).success).toBe(false)
  expect(agentProposalSchema.safeParse({ ...base, operations: [{ action: 'replace', object: note, expectedRevision: 10 }] }).success).toBe(true)
  expect(agentProposalSchema.safeParse({ ...base, operations: Array.from({ length: 201 }, () => ({ action: 'create', object: note })) }).success).toBe(false)
})
