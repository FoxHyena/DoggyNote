import { createSignal } from 'solid-js'
import type { Align, ColumnType, Id } from '@doggynote/core'
import type { PresetColor } from '@doggynote/theme'

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

  // ---- formatting: cells and rows (columns for the default alignment) ----
  /** There are body cells to style (a header alone has none). */
  canFormat: () => boolean
  /** Every selected cell is bold. */
  bold: () => boolean
  toggleBold: () => void
  /** The choice shared by the selection: a cell's own alignment (cells), or the column's default (columns). Null when none, or when they differ. */
  align: () => Align | null
  setAlign: (align: Align | null) => void
  /** The fill the selection shares (a cell's, or a row's when whole rows are picked), or null. */
  fill: () => PresetColor | null
  setFill: (color: PresetColor | null) => void

  // ---- columns ----
  /** The type of the selected columns, or null when they differ. */
  columnType: () => ColumnType | null
  setType: (type: ColumnType) => void
  /** Sorting is for exactly one column. */
  canSort: () => boolean
  sort: (dir: 'asc' | 'desc') => void
  /** The one selected column is a tag column: its options can be edited. */
  canEditOptions: () => boolean
  editOptions: () => void
}

export const [activeTable, setActiveTable] = createSignal<TableControl | null>(null)
