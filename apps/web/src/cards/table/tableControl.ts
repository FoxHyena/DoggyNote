import { createSignal } from 'solid-js'
import type { Id } from '@doggynote/core'

/**
 * The table being edited, for the controls that live outside the card: the
 * selection bar on a desktop, the dock on a phone. Same idea as activeNoteEditor.
 * The numbers are reactive (they follow the selection); the actions work on it.
 */
export type SelectionKind = 'cells' | 'rows' | 'cols'

export type TableControl = {
  cardId: Id
  /** What is selected: cells, whole rows (a row grip) or whole columns (a column grip or header). It picks the bar's buttons. */
  kind: () => SelectionKind
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
  /** Rows or columns only: move the selection one step (-1 up or left, 1 down or right). */
  canMove: (step: -1 | 1) => boolean
  move: (step: -1 | 1) => void
  duplicateRows: () => void
  canDuplicateRows: () => boolean
  /** Type a new name for the selected column (its header goes into edit). */
  renameColumn: () => void
  /** Put the keyboard focus back in the grid (after a menu closes). */
  refocus: () => void
}

export const [activeTable, setActiveTable] = createSignal<TableControl | null>(null)
