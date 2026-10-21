import { MAX_LABELS, MAX_LABEL_NAME, boardLabels, cardLabels, colorKey, labelToken, memberKey, nameKey, normalizeLabelName, type Card, type Id, type Label, type LabelColor, type Obj } from '@doggynote/core'
import { canReadBoard } from './access.ts'
import * as doc from './doc.ts'

// Labels on a board (packages/core/src/labels.ts). Every write here touches
// only the label's own fields, so concurrent edits by others survive (rule 7).

const visible = (boardId: Id) => doc.isReadOnly() || canReadBoard(boardId)
export const labelsOn = (boardId: Id): Label[] => (visible(boardId) ? boardLabels(doc.getBoard(boardId)) : [])
export const labelsFor = (card: Card): Label[] => (visible(card.boardId) ? cardLabels(card, doc.getBoard(card.boardId)) : [])
export const hasLabel = (card: Card, id: string) => (card as unknown as Record<string, unknown>)[memberKey(id)] === true

const patch = (fields: Record<string, unknown>) => fields as Partial<Obj>
const writableBoard = (boardId: Id) => doc.canWriteObject(doc.getBoard(boardId))
const sameName = (a: string, b: string) => normalizeLabelName(a) === normalizeLabelName(b)

export const findLabel = (boardId: Id, name: string) => labelsOn(boardId).find((label) => sameName(label.name, name))

/** Why a name can't be used, or null. */
export function labelNameProblem(boardId: Id, name: string, except?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the label a name.'
  if (trimmed.length > MAX_LABEL_NAME) return `Keep it to ${MAX_LABEL_NAME} characters.`
  if (labelsOn(boardId).some((label) => label.id !== except && sameName(label.name, trimmed))) return 'There’s already a label with that name.'
  if (!except && labelsOn(boardId).length >= MAX_LABELS) return `A board holds up to ${MAX_LABELS} labels.`
  return null
}

/** Creates the label and puts it on `cards`, as one undo step. */
export function createLabel(boardId: Id, name: string, color: LabelColor, cards: Card[]): string | null {
  if (!writableBoard(boardId) || labelNameProblem(boardId, name)) return null
  const id = labelToken()
  const patches: Record<Id, Partial<Obj>> = { [boardId]: patch({ [nameKey(id)]: name.trim(), [colorKey(id)]: color }) }
  for (const card of cards) if (card.boardId === boardId && doc.canWriteObject(card)) patches[card.id] = patch({ [memberKey(id)]: true })
  doc.update(patches)
  return id
}

export function setLabelOn(boardId: Id, id: string, cards: Card[], on: boolean) {
  const patches: Record<Id, Partial<Obj>> = {}
  for (const card of cards) if (card.boardId === boardId && doc.canWriteObject(card) && hasLabel(card, id) !== on) patches[card.id] = patch({ [memberKey(id)]: on })
  if (Object.keys(patches).length) doc.update(patches)
}

export function renameLabel(boardId: Id, id: string, name: string): boolean {
  const current = labelsOn(boardId).find((label) => label.id === id)
  if (!current || !writableBoard(boardId) || labelNameProblem(boardId, name, id)) return false
  if (current.name !== name.trim()) doc.update({ [boardId]: patch({ [nameKey(id)]: name.trim() }) })
  return true
}

export function recolorLabel(boardId: Id, id: string, color: LabelColor) {
  const current = labelsOn(boardId).find((label) => label.id === id)
  if (current && current.color !== color && writableBoard(boardId)) doc.update({ [boardId]: patch({ [colorKey(id)]: color }) })
}

/** How many cards on the board carry the label. */
export const labelUsage = (boardId: Id, id: string) => doc.cardsOn(boardId).filter((card) => hasLabel(card, id)).length

/** Takes the label off the board. Cards keep their (now unused) flag, so restoring the name brings it all back. */
export function removeLabel(boardId: Id, id: string) {
  if (writableBoard(boardId)) doc.update({ [boardId]: patch({ [nameKey(id)]: null }) })
}

/** Undo for `removeLabel`, aimed at that label only, whatever else happened since. Keeps the name if someone reused it meanwhile. */
export function restoreLabel(boardId: Id, id: string, name: string) {
  if (!writableBoard(boardId) || labelsOn(boardId).some((label) => label.id === id)) return
  const clash = !!findLabel(boardId, name)
  doc.update({ [boardId]: patch({ [nameKey(id)]: clash ? `${name} (restored)`.slice(0, MAX_LABEL_NAME) : name }) })
}
