import { describe, expect, it } from 'vitest'
import { clearDone, doneLabel, settleItems, toggleItem, type TodoItem } from './index.ts'

const list = (...spec: string[]): TodoItem[] => spec.map((s) => ({ id: s.replace('*', ''), text: s, done: s.endsWith('*') }))
const ids = (items: TodoItem[]) => items.map((i) => i.id)

describe('to-do rules', () => {
  it('stamps ticks and clears the stamp on untick', () => {
    const ticked = toggleItem(list('a', 'b'), 'b', 1000)
    expect(ticked[1]).toMatchObject({ done: true, doneAt: 1000 })
    expect(toggleItem(ticked, 'b', 2000)[1]).toMatchObject({ done: false, doneAt: null })
  })

  it('sinks a ticked task to the top of the done section', () => {
    const items = toggleItem(list('a', 'b', 'c', 'x*', 'y*'), 'b', 1)
    expect(ids(settleItems(items))).toEqual(['a', 'c', 'b', 'x', 'y'])
  })

  it('raises an unticked task to the end of the open tasks', () => {
    const items = toggleItem(list('a', 'c', 'b*', 'x*', 'y*'), 'x', 1)
    expect(ids(settleItems(items))).toEqual(['a', 'c', 'x', 'b', 'y'])
  })

  it('leaves a settled list alone, and tidies a mixed one', () => {
    expect(ids(settleItems(list('a', 'b*')))).toEqual(['a', 'b'])
    expect(ids(settleItems(list('a*', 'b', 'c*', 'd')))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('clears done tasks', () => {
    expect(ids(clearDone(list('a', 'b*', 'c')))).toEqual(['a', 'c'])
  })

  it('labels when a task was done', () => {
    const now = new Date(2026, 9, 20, 15, 0).getTime()
    expect(doneLabel(new Date(2026, 9, 20, 1, 0).getTime(), now, 'en-US')).toBe('today')
    expect(doneLabel(new Date(2026, 9, 19, 23, 59).getTime(), now, 'en-US')).toBe('yesterday')
    expect(doneLabel(new Date(2026, 8, 3).getTime(), now, 'en-US')).toBe('Sep 3')
    expect(doneLabel(new Date(2025, 11, 31).getTime(), now, 'en-US')).toBe('Dec 31, 2025')
  })
})
