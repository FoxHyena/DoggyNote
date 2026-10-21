import type { Card, Id } from '@doggynote/core'

/** A selected column includes its members; a selected member can be exported alone. */
export function exportRootIds(cards: readonly Card[], scope: 'board' | 'selection', selection: ReadonlySet<Id>): Id[] {
  if (scope === 'board') return cards.filter((c) => !c.columnId).map((c) => c.id)
  return cards.filter((c) => selection.has(c.id) && (!c.columnId || !selection.has(c.columnId))).map((c) => c.id)
}

/** Connector endpoints can include visible members rendered within a selected column. */
export function exportCardIds(cards: readonly Card[], roots: readonly Id[]): Set<Id> {
  const ids = new Set(roots)
  const columns = new Set(cards.filter((c) => ids.has(c.id) && c.type === 'column').map((c) => c.id))
  for (const c of cards) if (c.columnId && columns.has(c.columnId)) ids.add(c.id)
  return ids
}
