import type { Card, Obj } from './model.ts'

export function noteGroupId(object: Obj | undefined): string | null {
  return object?.kind === 'card' && object.type === 'note' && typeof object.noteGroupId === 'string' && /^[a-zA-Z0-9_:-]{1,64}$/.test(object.noteGroupId) ? object.noteGroupId : null
}

/** Includes trash: restoring an instance shows the current body. Purges leave the group. */
export function linkedNotes(objects: Iterable<Obj>, card: Card): Card<'note'>[] {
  const group = noteGroupId(card)
  if (!group || card.purged) return [card as Card<'note'>]
  return [...objects].filter((o): o is Card<'note'> => !o.purged && noteGroupId(o) === group)
}
