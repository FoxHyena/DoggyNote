import { createSignal } from 'solid-js'
import type { Id } from '@doggynote/core'

/**
 * The table being edited, for the controls that live outside the card: the
 * selection bar on a desktop, the dock on a phone. Same idea as activeNoteEditor.
 * The numbers are reactive (they follow the selection); the actions work on it.
 */
export type TableControl = {
  cardId: Id
  /** Body rows covered by the selection. */
  rowSpan: () => number
  /** Columns covered by the selection (0 when the title is active). */
  colSpan: () => number
  /** The selection is in the header row. */
  inHeader: () => boolean
  canAddRow: () => boolean
  canAddColumn: () => boolean
  canRemoveColumns: () => boolean
  /** Like Tab and Shift+Tab: the next cell, adding a row after the last. */
  next: () => void
  prev: () => void
  insertRow: (where: 'above' | 'below') => void
  insertColumn: (where: 'left' | 'right') => void
  removeRows: () => void
  removeColumns: () => void
  clear: () => void
  /** Put the keyboard focus back in the grid (after a menu closes). */
  refocus: () => void
}

export const [activeTable, setActiveTable] = createSignal<TableControl | null>(null)
