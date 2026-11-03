import { describe, expect, it } from 'vitest'
import { bodyRows, confine, edge, enterDown, homeEnd, rangeOf, step, tab } from './tableNav.ts'

const size = { rows: 3, cols: 3 }

describe('table navigation', () => {
  it('steps and stops at the edges, header included', () => {
    expect(step({ r: 0, c: 0 }, 'up', size)).toEqual({ r: -1, c: 0 })
    expect(step({ r: -1, c: 1 }, 'up', size)).toEqual({ r: -1, c: 1 })
    expect(step({ r: 2, c: 2 }, 'down', size)).toEqual({ r: 2, c: 2 })
    expect(step({ r: 1, c: 0 }, 'left', size)).toEqual({ r: 1, c: 0 })
    expect(step({ r: 1, c: 1 }, 'right', size)).toEqual({ r: 1, c: 2 })
  })
  it('jumps to the edge of the grid', () => {
    expect(edge({ r: 1, c: 1 }, 'up', size)).toEqual({ r: -1, c: 1 })
    expect(edge({ r: 1, c: 1 }, 'down', size)).toEqual({ r: 2, c: 1 })
    expect(edge({ r: 1, c: 1 }, 'left', size)).toEqual({ r: 1, c: 0 })
    expect(edge({ r: 1, c: 1 }, 'right', size)).toEqual({ r: 1, c: 2 })
  })
  it('Home and End stay in the row, with the modifier go to the first or last body cell', () => {
    expect(homeEnd({ r: 1, c: 1 }, false, false, size)).toEqual({ r: 1, c: 0 })
    expect(homeEnd({ r: 1, c: 1 }, true, false, size)).toEqual({ r: 1, c: 2 })
    expect(homeEnd({ r: 1, c: 1 }, false, true, size)).toEqual({ r: 0, c: 0 })
    expect(homeEnd({ r: 1, c: 1 }, true, true, size)).toEqual({ r: 2, c: 2 })
  })
  it('Tab wraps, adds a row after the last cell and stays before the first', () => {
    expect(tab({ r: 0, c: 0 }, false, size)).toEqual({ to: { r: 0, c: 1 }, addRow: false })
    expect(tab({ r: 0, c: 2 }, false, size)).toEqual({ to: { r: 1, c: 0 }, addRow: false })
    expect(tab({ r: 2, c: 2 }, false, size)).toEqual({ to: { r: 3, c: 0 }, addRow: true })
    expect(tab({ r: -1, c: 2 }, false, size)).toEqual({ to: { r: 0, c: 0 }, addRow: false })
    expect(tab({ r: 1, c: 0 }, true, size)).toEqual({ to: { r: 0, c: 2 }, addRow: false })
    expect(tab({ r: 0, c: 0 }, true, size)).toEqual({ to: { r: -1, c: 2 }, addRow: false })
    expect(tab({ r: -1, c: 0 }, true, size)).toEqual({ to: { r: -1, c: 0 }, addRow: false })
  })
  it('Enter goes down, and wants a new row only from the last body row', () => {
    expect(enterDown({ r: 0, c: 1 }, size)).toEqual({ to: { r: 1, c: 1 }, addRow: false })
    expect(enterDown({ r: 2, c: 1 }, size)).toEqual({ to: { r: 3, c: 1 }, addRow: true })
    expect(enterDown({ r: -1, c: 1 }, { rows: 0, cols: 3 })).toEqual({ to: { r: 0, c: 1 }, addRow: true })
  })
  it('keeps a range out of or inside the header', () => {
    expect(confine({ r: 1, c: 0 }, { r: -1, c: 2 })).toEqual({ r: 0, c: 2 })
    expect(confine({ r: -1, c: 0 }, { r: 2, c: 2 })).toEqual({ r: -1, c: 2 })
    expect(rangeOf({ r: 2, c: 2 }, { r: 0, c: 1 })).toEqual({ r0: 0, r1: 2, c0: 1, c1: 2 })
    expect(bodyRows({ r0: -1, r1: 1, c0: 0, c1: 0 })).toEqual([0, 1])
  })
})
