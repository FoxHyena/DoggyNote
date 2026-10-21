import { boardLabels, cardLabels, labelToken, MAX_LABEL_NAME, normalizeLabelName, type Card, type Id, type Label, type Obj } from '@doggynote/core'
import type { CardColor } from '@doggynote/theme'
import { canReadBoard } from './access.ts'
import * as doc from './doc.ts'

export const labelsOn = (boardId: Id) => doc.isReadOnly() || canReadBoard(boardId) ? boardLabels(doc.getBoard(boardId)) : []
export const labelsFor = (card: Card) => doc.isReadOnly() || canReadBoard(card.boardId) ? cardLabels(card, doc.getBoard(card.boardId)) : []
export const labelUsage = (boardId: Id, id: string) => (doc.isReadOnly() || canReadBoard(boardId) ? doc.cardsOn(boardId) : []).filter((c) => c[`label${id}`] === true).length

export function labelNameError(boardId: Id, name: string, except?: string): string | null {
  if (!name.trim()) return 'Enter a label name.'
  if (name.trim().length > MAX_LABEL_NAME) return `Use ${MAX_LABEL_NAME} characters or fewer.`
  if (labelsOn(boardId).some((label) => label.id !== except && normalizeLabelName(label.name) === normalizeLabelName(name))) return 'This label already exists. Reuse it from the list.'
  return null
}

export function createLabel(boardId: Id, name: string, color: CardColor, cards: Card[]): string | null {
  if (!doc.canWriteObject(doc.getBoard(boardId)) || labelNameError(boardId, name)) return null
  const id = labelToken()
  const patches: Record<Id, Partial<Obj>> = { [boardId]: { [`labelName${id}`]: name.trim(), [`labelColor${id}`]: color } }
  for (const card of cards) if (card.boardId === boardId && doc.canWriteObject(card)) patches[card.id] = { [`label${id}`]: true }
  doc.update(patches)
  return id
}

export function applyLabel(boardId: Id, label: Label, cards: Card[], applied: boolean) {
  if (!labelsOn(boardId).some((item) => item.id === label.id)) return
  const patches: Record<Id, Partial<Obj>> = {}
  for (const card of cards) if (card.boardId === boardId && doc.canWriteObject(card)) patches[card.id] = { [`label${label.id}`]: applied }
  doc.update(patches)
}
export function renameLabel(boardId: Id, id: string, name: string): boolean {
  if (!doc.canWriteObject(doc.getBoard(boardId)) || !labelsOn(boardId).some((l) => l.id === id) || labelNameError(boardId, name, id)) return false
  doc.update({ [boardId]: { [`labelName${id}`]: name.trim() } })
  return true
}
export function recolorLabel(boardId: Id, id: string, color: CardColor) {
  if (doc.canWriteObject(doc.getBoard(boardId)) && labelsOn(boardId).some((l) => l.id === id)) doc.update({ [boardId]: { [`labelColor${id}`]: color } })
}
export function removeLabel(boardId: Id, id: string) {
  if (doc.canWriteObject(doc.getBoard(boardId))) doc.update({ [boardId]: { [`labelName${id}`]: null } })
}
