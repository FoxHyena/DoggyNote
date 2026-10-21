import { CARD_COLORS, cardColor, type CardColor } from '@doggynote/theme'
import type { Board, Card } from './model.ts'

/** Identity belongs to a board, never to a spelling. Independent scalar fields
 * let two sessions apply different labels or rename/recolor without clobbering. */
export type LabelNames = { [key: `labelName${string}`]: string | null | undefined }
export type LabelColors = { [key: `labelColor${string}`]: CardColor | null | undefined }
export type LabelMembership = { [key: `label${string}`]: boolean | null | undefined }
export type Label = { id: string; name: string; color: CardColor }
export const LABEL_TOKEN = /^[a-f0-9]{32}$/
export const LABEL_FIELD = /^(labelName|labelColor|label)([a-f0-9]{32})$/
export const MAX_LABEL_NAME = 80
export const normalizeLabelName = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase('en-US')
export const labelToken = () => crypto.randomUUID().replaceAll('-', '')

/** null is a tombstone, including when Undo removes a formerly absent field. */
export function validLabelField(kind: unknown, key: string, value: unknown): boolean {
  const match = LABEL_FIELD.exec(key)
  if (!match) return false
  if (match[1] === 'label') return kind === 'card' && (value == null || typeof value === 'boolean')
  if (kind !== 'board') return false
  if (value == null) return true
  if (match[1] === 'labelName') return typeof value === 'string' && !!value.trim() && value.length <= MAX_LABEL_NAME
  return typeof value === 'string' && (CARD_COLORS as readonly string[]).includes(value)
}

export function boardLabels(board: Board | undefined): Label[] {
  if (!board || board.deletedAt || board.purged) return []
  const values = board as unknown as Record<string, unknown>
  return Object.entries(values).flatMap(([key, value]) => {
    const match = /^labelName([a-f0-9]{32})$/.exec(key)
    if (!match || !validLabelField('board', key, value) || typeof value !== 'string') return []
    return [{ id: match[1], name: value, color: cardColor(values[`labelColor${match[1]}`]) }]
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function cardLabels(card: Card, board: Board | undefined): Label[] {
  if (card.boardId !== board?.id) return []
  const values = card as unknown as Record<string, unknown>
  return boardLabels(board).filter((label) => values[`label${label.id}`] === true)
}

/** Copy/move selected cards to another board without retaining hidden source
 * metadata. Reuse destination names; otherwise create independent identities.
 * Caller commits returned board/card patches in the same transaction. */
export function remapCardLabels(cards: Card[], source: Board, destination: Board, newToken = labelToken): { board: LabelNames & LabelColors; cards: Record<string, LabelMembership> } {
  const available = boardLabels(destination)
  const metadata: LabelNames & LabelColors = {}
  const patches: Record<string, LabelMembership> = {}
  for (const card of cards) {
    const patch: LabelMembership = {}
    for (const key of Object.keys(card)) if (/^label[a-f0-9]{32}$/.test(key)) patch[key as keyof LabelMembership] = null
    for (const label of cardLabels(card, source)) {
      let target = available.find((item) => normalizeLabelName(item.name) === normalizeLabelName(label.name))
      if (!target) {
        target = { ...label, id: newToken() }
        available.push(target)
        metadata[`labelName${target.id}`] = target.name
        metadata[`labelColor${target.id}`] = target.color
      }
      patch[`label${target.id}`] = true
    }
    patches[card.id] = patch
  }
  return { board: metadata, cards: patches }
}
