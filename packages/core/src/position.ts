import type { Card, Id, Sticker } from './model.ts'
import { areaFamily, isArea, itemArea } from './areas.ts'
import { union, type Rect } from './geometry.ts'

/** Editor position locks protect explicit layout operations, not content reflow. */
export const POSITION_FIELDS = ['x', 'y', 'w', 'z', 'columnId', 'areaId', 'order', 'boardId', 'angle'] as const

/** A column is one layout family. A locked member also pins its parent/siblings. */
export function positionLocks(cards: readonly (Card | Sticker)[]): Set<Id> {
  const families = new Set<Id>()
  const locked = new Set<Id>()
  for (const c of cards) {
    if (c.deletedAt || c.purged || c.kind !== 'card' || c.positionLocked !== true) continue
    locked.add(c.id)
    families.add(c.columnId || c.id)
    if (isArea(c)) for (const member of areaFamily(c, cards)) locked.add(member.id)
  }
  for (const c of cards) if (families.has((c.kind === 'card' && c.columnId) || c.id)) locked.add(c.id)
  const byId = new Map(cards.map(c => [c.id, c]))
  for (const c of cards) if (locked.has(c.id)) { const area = itemArea(c, id => byId.get(id)); if (area) locked.add(area.id) }
  return locked
}

/** Selecting a member aligns its column as a unit; never extract/reorder it. */
export function alignmentUnits(cards: readonly Card[], selected: Iterable<Id>): Card[] {
  const byId = new Map(cards.filter((c) => !c.deletedAt && !c.purged).map((c) => [c.id, c]))
  const units = new Map<Id, Card>()
  for (const id of selected) {
    const c = byId.get(id)
    if (!c) continue
    const unit = (c.columnId && byId.get(c.columnId)) || c
    units.set(unit.id, unit)
  }
  return [...units.values()].filter(c => !c.areaId || !units.has(c.areaId))
}

export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
export const ALIGNMENTS: readonly { value: Alignment; label: string }[] = [
  { value: 'left', label: 'Align left' }, { value: 'center-x', label: 'Align horizontal centers' },
  { value: 'right', label: 'Align right' }, { value: 'top', label: 'Align top' },
  { value: 'center-y', label: 'Align vertical centers' }, { value: 'bottom', label: 'Align bottom' },
]

/** World-space envelope adapter keeps new card kinds independent of the editor. */
export function planAlignment(cards: readonly Card[], selected: Iterable<Id>, rectOf: (id: Id) => Rect | null, mode: Alignment) {
  const locked = positionLocks(cards)
  const units = alignmentUnits(cards, selected).flatMap((card) => {
    const rect = rectOf(card.id)
    return rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ? [{ card, rect }] : []
  })
  const bounds = union(units.map((u) => u.rect))
  const patches: Record<Id, Partial<Card>> = {}
  if (bounds && units.length > 1) for (const { card, rect } of units) {
    if (locked.has(card.id)) continue
    let x = rect.x, y = rect.y
    switch (mode) {
      case 'left': x = bounds.x; break
      case 'center-x': x = bounds.x + (bounds.w - rect.w) / 2; break
      case 'right': x = bounds.x + bounds.w - rect.w; break
      case 'top': y = bounds.y; break
      case 'center-y': y = bounds.y + (bounds.h - rect.h) / 2; break
      case 'bottom': y = bounds.y + bounds.h - rect.h; break
    }
    // Patch only the axis that moved. Concurrent edits to the other survive.
    if (x !== rect.x) patches[card.id] = { x: card.x + x - rect.x }
    if (y !== rect.y) patches[card.id] = { y: card.y + y - rect.y }
  }
  return { patches, units: units.length, locked: units.filter((u) => locked.has(u.card.id)).length }
}

export function changesPosition(current: Card | Sticker, patch: Partial<Card | Sticker>, includeHeight = false): boolean {
  const before = current as unknown as Record<string, unknown>, after = patch as Record<string, unknown>
  return ((includeHeight || isArea(current)) && 'h' in after && after.h !== before.h) || POSITION_FIELDS.some((key) => key in after && (after[key] ?? null) !== (before[key] ?? null))
}
