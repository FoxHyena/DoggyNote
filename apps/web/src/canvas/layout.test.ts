import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'

// Layout's combined column dependency also imports the live canvas UI. Use
// the core collapsed predicate for this isolated ResizeObserver regression.
vi.mock('../state/columns.ts', async () => {
  const { isColumnCollapsed } = await import('@doggynote/core')
  return { columnCollapsed: isColumnCollapsed }
})

vi.mock('../state/idb.ts', () => ({ getAll: async () => new Map(), putDocument: async () => {}, clearAll: async () => {} }))

let resize: (entries: { target: HTMLElement }[]) => void
vi.stubGlobal('ResizeObserver', class {
  constructor(callback: typeof resize) { resize = callback }
  observe() {}
  unobserve() {}
})
const layout = await import('./layout.ts')
const card: Card<'todo'> = { id: 'paper', kind: 'card', type: 'todo', boardId: 'qa', x: 10, y: 20, w: 320, h: 240, z: 1, color: 'none', createdAt: 1, content: { title: '', items: [] } }

beforeEach(async () => {
  vi.useFakeTimers()
  await doc.load({ persist: false, readOnly: false })
  doc.setWriteGuard(() => true)
  doc.loadSnapshot([card])
})
afterEach(() => { vi.useRealTimers() })

it('preserves cached and synced height while a loading boundary hides a card', () => {
  const element = { offsetHeight: 240 } as HTMLElement
  const release = layout.registerCardEl(card.id, element)
  try {
    resize([{ target: element }])
    expect(layout.cardHeight(card)).toBe(240)
    Object.assign(element, { offsetHeight: 0 })
    resize([{ target: element }])
    vi.advanceTimersByTime(400)
    expect(layout.cardHeight(card)).toBe(240)
    expect(doc.getCard(card.id)?.h).toBe(240)
    // A later visible measurement still updates natural card geometry.
    Object.assign(element, { offsetHeight: 300 })
    resize([{ target: element }])
    vi.advanceTimersByTime(400)
    expect(layout.cardHeight(card)).toBe(300)
    expect(doc.getCard(card.id)?.h).toBe(300)
  } finally { release() }
})
