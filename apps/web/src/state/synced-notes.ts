import { newId, noteMarkdown, remapCardLabels, type Card } from '@doggynote/core'
import { unwrap } from 'solid-js/store'
import * as doc from './doc.ts'
import { canEditBoard } from './access.ts'
import { endEdit, openBoard, select } from './ui.ts'

/** Explicit linked copy, deliberately separate from ordinary duplication. */
export function copyNote(id: string, destination: string, synced: boolean): string | null {
  endEdit()
  const source = doc.getCard(id)
  if (source?.type !== 'note' || !doc.canWriteObject(source) || !canEditBoard(destination) || (synced && !doc.canEditNoteBody(source))) return null
  const group = synced ? source.noteGroupId || newId() : null
  const copy: Card<'note'> = {
    ...structuredClone(unwrap(source)), id: newId(), boardId: destination,
    x: source.boardId === destination ? source.x + 32 : 80,
    y: source.boardId === destination ? source.y + source.h + 32 : 80,
    columnId: null, order: 0, z: doc.maxZ(destination) + 1,
    createdAt: Date.now(), deletedAt: null, purged: false,
    content: { md: noteMarkdown(source as Card<'note'>) }, noteGroupId: group,
  } as Card<'note'>
  delete copy.noteBodyReadOnly
  const labelChanges = []
  if (source.boardId !== destination) {
    const sourceBoard = doc.getBoard(source.boardId), destinationBoard = doc.getBoard(destination)
    if (!sourceBoard || !destinationBoard) return null
    const labels = remapCardLabels([source], sourceBoard, destinationBoard)
    Object.assign(copy, labels.cards[source.id])
    labelChanges.push(...doc.changesFor({ [destination]: labels.board }))
  }
  const tx = [...labelChanges, doc.createChange(copy)]
  if (synced && !source.noteGroupId) {
    const fields: Partial<Card> = { noteGroupId: group }
    if (typeof (source.content as { md?: unknown }).md !== 'string') fields.content = { md: noteMarkdown(source as Card<'note'>) }
    tx.unshift(...doc.changesFor({ [id]: fields }))
  }
  doc.commit(tx)
  if (!doc.getCard(copy.id)) return null
  openBoard(destination)
  select([copy.id])
  return copy.id
}

/** Detaching snapshots the current body; other instances keep their identity. */
export function unlinkNote(id: string) {
  endEdit()
  const card = doc.getCard(id)
  if (card?.type !== 'note' || !card.noteGroupId || !doc.canWriteObject(card)) return
  doc.update({ [id]: { noteGroupId: null, noteBodyReadOnly: false, content: { md: noteMarkdown(card as Card<'note'>) } } as Partial<Card> })
}
