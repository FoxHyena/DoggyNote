import { createSignal } from 'solid-js'
import { INK_PALETTE } from '@doggynote/core'
import { boardId, clearSelection, endEdit, setConnectMode } from './ui.ts'
import * as doc from './doc.ts'
import type { DrawingTool } from '../drawing/InkTools.tsx'

export const [canvasDrawing, setCanvasDrawing] = createSignal(false)
export const [canvasInkTool, setCanvasInkTool] = createSignal<DrawingTool>('pen')
export const [canvasInkColor, setCanvasInkColor] = createSignal<string>(INK_PALETTE[0])
export const [canvasInkWidth, setCanvasInkWidth] = createSignal(3)
/** Transient erase preview; tombstones are committed together on pointer-up. */
export const [canvasErasing, setCanvasErasing] = createSignal<ReadonlySet<string>>(new Set())

export function beginCanvasDrawing() {
  if (!doc.canWriteObject(doc.getBoard(boardId()))) return
  endEdit()
  clearSelection()
  setConnectMode(null)
  setCanvasDrawing(true)
}

export function endCanvasDrawing() {
  const restoreFocus = document.activeElement?.closest('.canvas-ink-tools')
  setCanvasDrawing(false)
  if (restoreFocus) document.querySelector<HTMLElement>('[data-testid="canvas"]')?.focus({ preventScroll: true })
}
