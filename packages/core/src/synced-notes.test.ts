import { expect, it } from 'vitest'
import { linkedNotes, noteGroupId } from './synced-notes.ts'
import type { Card } from './model.ts'

const note = (id: string, extra: Partial<Card> = {}) => ({ id, kind: 'card', type: 'note', boardId: 'overview', content: { md: 'Brief' }, noteGroupId: 'brief', ...extra }) as Card<'note'>
it('shared body membership spans boards and trash, excludes purges, and does not match non-notes', () => {
  const first = note('first'), second = note('second', { boardId: 'research' }), trash = note('trash', { deletedAt: 1 })
  expect(linkedNotes([first, second, trash, note('purged', { purged: true }), note('todo', { type: 'todo' }), note('other', { noteGroupId: 'another' })], first).map((o) => o.id)).toEqual(['first', 'second', 'trash'])
  expect(linkedNotes([first], note('independent', { noteGroupId: null })).map((o) => o.id)).toEqual(['independent'])
})
it('malformed synced values are not interpreted as identities', () => {
  for (const value of ['', 23, {}, ['brief'], 'bad.group']) expect(noteGroupId(note('bad', { noteGroupId: value as string }))).toBeNull()
})
