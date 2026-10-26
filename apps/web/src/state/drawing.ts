import { createSignal } from 'solid-js'
import { INK_PALETTE, INK_WIDTHS, type InkTool } from '@doggynote/core'
import * as doc from './doc.ts'
import { boardId, clearSelection, endEdit, setConnectMode } from './ui.ts'

// Ink settings, shared by the sketch editor and drawing on the board, so the
// pen you picked in one is the pen you have in the other.

export type DrawingTool = InkTool | 'eraser'

export const [inkTool, setInkTool] = createSignal<DrawingTool>('pen')
export const [inkColor, setInkColor] = createSignal<string>(INK_PALETTE[0].hex)
export const [inkWidth, setInkWidth] = createSignal<number>(INK_WIDTHS[1].width)

/** Draw mode: pointers on the board draw ink instead of selecting and moving cards. */
export const [boardDrawing, setBoardDrawing] = createSignal(false)
/** Strokes the board eraser is passing over; buried together when it lifts. */
export const [boardErasing, setBoardErasing] = createSignal<ReadonlySet<string>>(new Set())

export function beginBoardDrawing() {
  if (!doc.canWriteObject(doc.getBoard(boardId()))) return
  endEdit()
  clearSelection()
  setConnectMode(null)
  setBoardDrawing(true)
}

export function endBoardDrawing() {
  setBoardDrawing(false)
  setBoardErasing(new Set<string>())
}
