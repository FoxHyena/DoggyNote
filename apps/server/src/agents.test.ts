import { expect, it } from 'vitest'
import type { AgentObject } from '@doggynote/core/agent'
import type { Access } from './access.ts'
import { inAgentScope, prepareAgentChanges, sameAgentState } from './agents.ts'
const note: AgentObject = { id: 'note-1', kind: 'card', type: 'note', boardId: 'board-1', x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', content: { md: 'Hello' }, createdAt: 1 }
const access: Access = { boards: new Map([['board-1', { id: 'board-1', parentId: null, ownerId: 'rex', legacy: false }], ['child', { id: 'child', parentId: 'board-1', ownerId: 'rex', legacy: false }]]), canRead: () => true, canEdit: () => true, canManage: () => true, revision: '1', homeBoardId: 'board-1', legacyShared: false }
const credential = { id: 'credential', user_id: 'rex', name: 'Test', mode: 'propose' as const, board_ids: '["board-1"]', expires_at: Date.now() + 10000, revoked_at: null }
it('scopes include canonical descendants and exclude other private boards', () => {
  expect(inAgentScope(access, credential, 'board-1')).toBe(true)
  expect(inAgentScope(access, credential, 'child')).toBe(true)
  expect(inAgentScope(access, credential, 'toybox:rex')).toBe(false)
})
it('reversal equality ignores only measured card height', () => {
  expect(sameAgentState(note, { ...note, h: 150 })).toBe(true)
  expect(sameAgentState(note, { ...note, x: 1 })).toBe(false)
  expect(sameAgentState(note, { ...note, content: { md: 'Human edit' } })).toBe(false)
  expect(sameAgentState(note, { ...note, deletedAt: 10 })).toBe(false)
})
it('rejects stale proposals before writing anything', async () => {
  const db = { prepare: () => ({ all: async () => ({ results: [{ id: note.id, data: JSON.stringify(note), seq: 10, owner_id: null }] }) }) } as unknown as D1Database
  await expect(prepareAgentChanges(db, access, credential, { id: 'rex', username: 'rex', isAdmin: false }, { idempotencyKey: 'request-123', label: 'Change text', operations: [{ action: 'replace', object: note, expectedRevision: 9 }] })).rejects.toThrow('Revision conflict')
})
it('rejects permanent deletion and duplicate object operations', async () => {
  const db = { prepare: () => ({ all: async () => ({ results: [{ id: note.id, data: JSON.stringify(note), seq: 10, owner_id: null }] }) }) } as unknown as D1Database
  const base = { idempotencyKey: 'request-123', label: 'Change text' }
  await expect(prepareAgentChanges(db, access, credential, { id: 'rex', username: 'rex', isAdmin: false }, { ...base, operations: [{ action: 'replace', object: { ...note, purged: true }, expectedRevision: 10 }] })).rejects.toThrow('Permanent deletion')
  await expect(prepareAgentChanges(db, access, credential, { id: 'rex', username: 'rex', isAdmin: false }, { ...base, operations: [{ action: 'trash', id: note.id, expectedRevision: 10 }, { action: 'restore', id: note.id, expectedRevision: 10 }] })).rejects.toThrow('Only one operation')
})
it('area height is a manually chosen dimension, not an ignorable measurement',()=>{
  const area={...note,type:'area' as const,content:{title:'Project'}}
  expect(sameAgentState(area,{...area,h:600})).toBe(false)
})
