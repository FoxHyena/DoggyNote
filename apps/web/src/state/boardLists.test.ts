import { describe, expect, it } from 'vitest'
import { favouriteIds, mergePrefs, recentIds } from './boardLists.ts'

const pref = (favoriteAt: number | null, openedAt: number | null = null) => ({ favoriteAt, openedAt })

describe('favouriteIds', () => {
  it('lists starred boards in the order they were starred', () => {
    expect(favouriteIds({ late: pref(30), none: pref(null, 99), early: pref(10) })).toEqual(['early', 'late'])
  })
})

describe('recentIds', () => {
  it('puts the latest open on any device first, then this device’s untimed list', () => {
    expect(recentIds({ a: pref(null, 5), b: pref(null, 9), starOnly: pref(3) }, ['old', 'a', 'starOnly'])).toEqual(['b', 'a', 'old', 'starOnly'])
  })
})

describe('mergePrefs', () => {
  it('takes favourites from the server, so an unstar elsewhere arrives', () => {
    expect(mergePrefs({ x: pref(5) }, { x: pref(null) }, {})).toEqual({ x: pref(null) })
  })
  it('keeps a star or unstar this device hasn’t sent yet', () => {
    expect(mergePrefs({ x: pref(5) }, {}, { x: { favorite: true } })).toEqual({ x: pref(5) })
    expect(mergePrefs({}, { y: pref(5) }, { y: { favorite: false } })).toEqual({ y: pref(null) })
  })
  it('keeps the server’s star time when it already has one', () => {
    expect(mergePrefs({ x: pref(50) }, { x: pref(10) }, { x: { favorite: true } })).toEqual({ x: pref(10) })
  })
  it('keeps the newest open time, counting an unsent local open', () => {
    expect(mergePrefs({ x: pref(null, 20) }, { x: pref(null, 10) }, { x: { opened: true } })).toEqual({ x: pref(null, 20) })
    expect(mergePrefs({ x: pref(null, 5) }, { x: pref(null, 10) }, { x: { opened: true } })).toEqual({ x: pref(null, 10) })
  })
  it('drops a board the server no longer returns once nothing is waiting to be sent', () => {
    expect(mergePrefs({ gone: pref(5, 5) }, {}, {})).toEqual({})
  })
})
