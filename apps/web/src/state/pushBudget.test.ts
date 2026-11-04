import { describe, expect, it } from 'vitest'
import { cellKey, rowKey } from '@doggynote/core'
import { budgetChanges } from './pushBudget.ts'

const cells = (n: number, offset = 0) => Object.fromEntries(Array.from({ length: n }, (_, i) => [cellKey(`2${(i + offset).toString(36).padStart(5, '0')}`, '1aaaaa'), `v${i}`]))

describe('budgetChanges', () => {
  it('sends everything that fits in one request', () => {
    const changes = [{ id: 'a', patch: { x: 1 } }, { id: 'b', patch: cells(1500) }]
    expect(budgetChanges(changes)).toEqual({ send: changes, complete: true })
  })
  it('caps the number of changes', () => {
    const changes = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, patch: { x: i } }))
    expect(budgetChanges(changes, 3)).toEqual({ send: changes.slice(0, 3), complete: false })
    expect(budgetChanges(changes, 5).complete).toBe(true)
  })
  it('leaves a change that does not fit beside the others for the next request', () => {
    const changes = [{ id: 'a', patch: cells(1500) }, { id: 'b', patch: cells(1500, 5000) }, { id: 'c', patch: { x: 1 } }]
    const first = budgetChanges(changes)
    expect(first.send).toEqual([changes[0]])
    expect(first.complete).toBe(false)
  })
  it('cuts one huge change: ordinary fields first with as many table fields as fit, then only table fields', () => {
    const patch = { id: 't', kind: 'card', type: 'table', ...cells(4500) }
    const first = budgetChanges([{ id: 't', patch }])
    expect(first.complete).toBe(false)
    const keys = Object.keys(first.send[0]!.patch)
    expect(keys).toHaveLength(2000)
    expect(keys).toEqual(expect.arrayContaining(['id', 'kind', 'type']))
    // Simulate acknowledging what was sent and asking again, until nothing is left.
    let rest: Record<string, unknown> = { ...patch }
    const sizes: number[] = []
    for (let guard = 0; guard < 10 && Object.keys(rest).length; guard++) {
      const { send, complete } = budgetChanges([{ id: 't', patch: rest }])
      sizes.push(Object.keys(send[0]!.patch).length)
      for (const key of Object.keys(send[0]!.patch)) delete rest[key]
      if (complete) break
    }
    expect(sizes).toEqual([2000, 2000, 503])
    expect(Object.keys(rest)).toHaveLength(0)
  })
  it('keeps removals (null) in the cut like any other table field', () => {
    const patch = { [rowKey('200000')]: null, ...cells(2100) }
    const { send } = budgetChanges([{ id: 't', patch }])
    expect(Object.keys(send[0]!.patch)).toHaveLength(2000)
  })
})
