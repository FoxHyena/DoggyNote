import { GRID, canSyncNote, itemArea, newId, type Card, type Id } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import { unwrap } from 'solid-js/store'
import * as doc from './doc.ts'
import { canEditBoard, canReadBoard } from './access.ts'
import { revealCard } from './columns.ts'
import { boardId, openBoard, select } from './ui.ts'
import { showToast } from './toast.ts'
import { rectOf, worldPosition } from '../canvas/layout.ts'
import { areaPlacement } from './areas.ts'

// Synced copies of a note (packages/core/src/synced.ts, apps/server/src/synced.ts).
// A copy is made beside the original, never on top of it; cut and paste moves it to any board and
// keeps it synced, because a cut-and-paste moves the very same card.

/** A note you can edit, outside a Toy box, with its shared text loaded. */
export const canMakeSyncedCopy = (card: Card | undefined): card is Card<'note'> =>
  !!card && card.type === 'note' && canSyncNote(card) && !!card.noteState && doc.canWriteObject(card) && canEditBoard(card.boardId)

export function makeSyncedCopy(id: Id): Id | null {
  const source = doc.getCard(id)
  if (!canMakeSyncedCopy(source)) return null
  const group = source.syncId ?? source.id
  // The copy starts as a clone of the same CRDT document, so merging never doubles text.
  const copy = structuredClone(unwrap(source)) as Card<'note'>
  delete copy.positionLocked
  const column = source.columnId ? rectOf(source.columnId) : null
  const origin = worldPosition(source)
  const at = column ? { x: column.x + column.w + GRID, y: column.y } : { x: origin.x + source.w + GRID, y: origin.y }
  Object.assign(copy, {
    id: newId(), syncId: group, createdAt: Date.now(), deletedAt: null, burialId: null, purged: false, z: doc.maxZ(source.boardId) + 1,
    columnId: null, ...areaPlacement(at, itemArea(source, doc.get)),
  })
  doc.commit([...(source.syncId ? [] : doc.changesFor({ [id]: { syncId: group } as Partial<Card> })), doc.createChange(copy)])
  if (!doc.getCard(copy.id)) return null
  select([copy.id])
  showToast(COPY.synced.made, 7000, { label: 'Undo', run: () => doc.undo() })
  return copy.id
}

/** Unsync this card. It keeps its text; the other copies stay in sync. */
export function makeIndependent(id: Id) {
  const card = doc.getCard(id)
  if (!card?.syncId || !doc.canWriteObject(card)) return
  doc.update({ [id]: { syncId: null } as Partial<Card> })
  showToast(COPY.synced.madeIndependent, 5000, { label: 'Undo', run: () => doc.undo() })
}

/** Every live copy you can see, this one first, then by board. */
export function copiesOf(id: Id): Card<'note'>[] {
  const card = doc.getCard(id)
  if (!card) return []
  const others = doc.syncedCopies(id).filter((c) => canReadBoard(c.boardId) || c.boardId === boardId())
  return others.length ? [card as Card<'note'>, ...others] : []
}

export function goToCopy(id: Id) {
  const card = doc.getCard(id)
  if (!card || card.deletedAt || card.purged) { showToast(COPY.synced.gone); return }
  if (card.boardId !== boardId()) openBoard(card.boardId)
  revealCard(id)
}
