import { describe, expect, it } from 'vitest'
import { sharedRoots } from './sharedBoards.ts'

const board = (id: string, parentId: string | null, ownerId: string | null, extra: { legacy?: boolean; sharedAt?: number } = {}) => ({ id, parentId, ownerId, legacy: false, ...extra })
const ids = (boards: { id: string }[]) => boards.map((b) => b.id)
const roots = (boards: ReturnType<typeof board>[]) => ids(sharedRoots(boards, 'me', (b) => b.id))

describe('sharedRoots', () => {
  it('hides a friend’s board made inside one of mine', () => {
    expect(roots([board('home:me', null, 'me'), board('mine', 'home:me', 'me'), board('theirs', 'mine', 'fido')])).toEqual([])
  })
  it('hides boards friends made inside Shared space', () => {
    expect(roots([board('home', null, null, { legacy: true }), board('van', 'home', 'fido')])).toEqual([])
  })
  it('lists only the top of a tree shared with me', () => {
    expect(roots([board('root', 'home:fido', 'fido', { sharedAt: 1 }), board('child', 'root', 'fido'), board('grandchild', 'child', 'rex')])).toEqual(['root'])
  })
  it('lists a sub-board shared on its own when its parent stays private', () => {
    expect(roots([board('inner', 'private', 'fido', { sharedAt: 1 })])).toEqual(['inner'])
  })
  it('puts the newest share first, then sorts by title', () => {
    expect(roots([board('b', 'x', 'fido'), board('old', 'y', 'fido', { sharedAt: 1 }), board('new', 'z', 'rex', { sharedAt: 5 }), board('a', 'w', 'fido')])).toEqual(['new', 'old', 'a', 'b'])
  })
  it('never lists my own homes or Inbox', () => {
    expect(roots([board('home:fido', null, 'fido'), board('toybox:fido', null, 'fido')])).toEqual([])
  })
})
