import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { decodeUpdate, noteDocument, noteState, presenceInput, replaceText } from './collaboration.ts'

describe('collaborative markdown', () => {
  it('merges disconnected inserts, deletes, duplicate and reordered updates without duplicating the seed', () => {
    const seed = noteDocument(); replaceText(seed.getText('markdown'), 'shared note')
    const a = noteDocument(noteState(seed)), b = noteDocument(noteState(seed))
    a.getText('markdown').insert(0, 'A ')
    b.getText('markdown').insert(11, ' B')
    b.getText('markdown').delete(0, 7)
    const fromA = noteState(a), fromB = noteState(b)
    for (const d of [seed, a, b]) {
      Y.applyUpdate(d, decodeUpdate(fromB)); Y.applyUpdate(d, decodeUpdate(fromA)); Y.applyUpdate(d, decodeUpdate(fromB))
      expect(d.getText('markdown').toString()).toBe('A note B')
    }
    const reloaded = noteDocument(noteState(seed))
    expect(reloaded.getText('markdown').toString()).toBe('A note B')
    ;[seed, a, b, reloaded].forEach((d) => d.destroy())
  })
  it('undoes only local text and preserves remote edits and formatting', () => {
    const seed = noteDocument(); replaceText(seed.getText('markdown'), 'hello')
    const a = noteDocument(noteState(seed)), b = noteDocument(noteState(seed)), origin = {}
    const undo = new Y.UndoManager(a.getText('markdown'), { trackedOrigins: new Set([origin]) })
    replaceText(a.getText('markdown'), '**hello**', origin)
    b.getText('markdown').insert(5, ' world')
    Y.applyUpdate(a, decodeUpdate(noteState(b)), 'remote')
    undo.undo()
    expect(a.getText('markdown').toString()).toBe('hello world')
    undo.redo()
    expect(a.getText('markdown').toString()).toContain('**')
    undo.destroy(); [seed, a, b].forEach((d) => d.destroy())
  })
})
it('validates bounded finite presence and ignores supplied identity', () => {
  const value = { pointer: null, selection: [], editing: null, camera: { x: 0, y: 0, zoom: 1 }, width: 800, height: 600, previews: [], caret: null, userId: 'forged', canEdit: true }
  expect(presenceInput(value)).not.toHaveProperty('userId')
  expect(presenceInput({ ...value, camera: { x: Infinity, y: 0, zoom: 1 } })).toBeNull()
  expect(presenceInput({ ...value, selection: Array(101).fill('id') })).toBeNull()
  expect(presenceInput({ ...value, caret: { anchor: 'a'.repeat(513), head: '' } })).toBeNull()
})

it('replaces emoji without splitting UTF-16 surrogate pairs in durable state', () => {
  const doc = noteDocument(), text = doc.getText('markdown')
  for (const next of ['A 🐶 dog', 'A 🐕 dog', 'A 🐶 dog', 'A 🐶🐕 dog', 'A 🐕 dog']) {
    replaceText(text, next)
    expect(text.toString()).toBe(next)
    const reloaded = noteDocument(noteState(doc))
    expect(reloaded.getText('markdown').toString()).toBe(next); reloaded.destroy()
  }
  doc.destroy()
})
