import type { Card, CardType } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { nudgeSelection } from '../state/position.ts'
import { burySelection, selectAll } from '../state/actions.ts'
import { moveToCard } from '../state/keyboardNav.ts'
import {
  beginEdit,
  clearSelection,
  connectMode,
  editingId,
  endEdit,
  openBoard,
  paletteOpen,
  selection,
  boardId,
  setConnectMode,
  setPaletteOpen,
  setShortcutsOpen,
  setTrashOpen,
  trashOpen,
} from '../state/ui.ts'
import { zoomBy, zoomTo, zoomToFit } from '../canvas/Canvas.tsx'
import { toggleSnap } from '../state/grid.ts'
import { centrePlacement, placementAt, useTool } from './Toolbar.tsx'

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')

/** Single keys that add a card where the mouse is (or mid-view), like the toolbar's tools. */
const CREATE_KEYS: Record<string, CardType | 'line'> = { n: 'note', t: 'todo', b: 'board', l: 'line' }

// The last mouse position, so N, T and B add a card under the pointer.
let pointer: { x: number; y: number } | null = null
const trackPointer = (e: PointerEvent) => { pointer = e.pointerType === 'touch' ? null : { x: e.clientX, y: e.clientY } }
const forgetPointer = () => { pointer = null }

/** Any menu, popover or sheet that's open owns the keyboard, even if focus has wandered off it. */
const overlayOpen = () => !!document.querySelector('.menu, [role="menu"], .popover, [role="dialog"], [role="alertdialog"]')

export function installShortcuts(opts: { readOnly: boolean }) {
  const onKey = (e: KeyboardEvent) => {
    // Dialog buttons and selects must never rename or bury a selected canvas card.
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
      if (e.key === 'Backspace' && !isTyping(e.target)) e.preventDefault()
      return
    }
    const mod = e.metaKey || e.ctrlKey
    const typing = isTyping(e.target)

    // Board controls can keep focus after closing a menu or dialog. Escape still
    // dismisses canvas state; open menus and text fields keep their keys.
    const target = e.target as Element | null
    if (e.key === 'Escape' && !typing && !e.defaultPrevented && !opts.readOnly
      && target?.closest?.('.topbar, .canvas-controls, .selection-bar')
      && !target.closest('.menu, [role="menu"]')) {
      e.preventDefault()
      if (editingId()) endEdit()
      else if (connectMode()) setConnectMode(null)
      else if (trashOpen()) setTrashOpen(false)
      else clearSelection()
      return
    }

    // "?" (Shift+/) shows every shortcut, on any board you can see, even from a
    // top-bar button (focus returns to Account when the sheet closes).
    if (e.key === '?' && !mod && !e.altKey && !typing && !target?.closest?.('.menu, [role="menu"]')) return void (e.preventDefault(), setShortcutsOpen(true))

    // Menu and toolbar buttons keep ordinary typing keys away from canvas edits.
    if ((e.target as Element)?.closest?.('.menu, .topbar, .canvas-controls, .follow-banner, .selection-bar') && !mod) {
      if (e.key === 'Backspace') e.preventDefault()
      return
    }

    // Zoom works everywhere, including the read-only viewer.
    if (mod && (e.key === '=' || e.key === '+')) return void (e.preventDefault(), zoomBy(1.25))
    if (mod && (e.key === '-' || e.key === '_')) return void (e.preventDefault(), zoomBy(0.8))
    if (mod && e.key === '0') return void (e.preventDefault(), zoomTo(1))
    if (mod && e.key === '1') return void (e.preventDefault(), zoomToFit())
    if (mod && e.key.toLowerCase() === 'k') return void (e.preventDefault(), setPaletteOpen(!paletteOpen()))
    if (mod && e.key === "'" && !opts.readOnly) return void (e.preventDefault(), toggleSnap())

    if (typing) return
    if (opts.readOnly) {
      // WebKit treats Backspace as "go back"; a viewer shouldn't lose the board to a stray key.
      if (e.key === 'Backspace') e.preventDefault()
      return
    }

    if (e.key === 'Escape') {
      if (editingId()) endEdit()
      else if (connectMode()) setConnectMode(null)
      else if (trashOpen()) setTrashOpen(false)
      else clearSelection()
      return
    }
    if (editingId()) return

    const tool = CREATE_KEYS[e.key.toLowerCase()]
    if (tool && !mod && !e.altKey && !e.shiftKey && !e.repeat) {
      // Never while a menu or popover is open, nor on a board you can only view.
      if (overlayOpen() || !doc.canWriteObject(doc.getBoard(boardId()))) return
      e.preventDefault()
      const type = tool === 'line' ? 'note' : tool
      return useTool(tool, () => (pointer && placementAt(pointer.x, pointer.y)) || centrePlacement(type))
    }

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return e.shiftKey ? doc.redo() : doc.undo()
    }
    if (mod && e.key.toLowerCase() === 'y') return void (e.preventDefault(), doc.redo())
    if (mod && e.key.toLowerCase() === 'a') return void (e.preventDefault(), selectAll())
    const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const
    if (!mod && e.altKey && e.key in ARROWS) {
      e.preventDefault()
      return moveToCard(ARROWS[e.key as keyof typeof ARROWS])
    }
    if (!mod && !e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && selection().size) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      nudgeSelection(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection().size) {
        e.preventDefault()
        burySelection()
      }
      return
    }
    if (e.key === 'Enter' && selection().size === 1) {
      const id = [...selection()][0]
      const c = doc.getCard(id)
      // A mark drawn on the board has nothing to edit.
      if (c && c.type !== 'ink') {
        e.preventDefault()
        // Enter does what a double-click does: edit a card, open a board. Rename is in the bar.
        if (c.type === 'board') openBoard((c as Card<'board'>).content.boardId)
        else beginEdit(id)
      }
    }
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointermove', trackPointer, { passive: true })
  document.documentElement.addEventListener('pointerleave', forgetPointer)
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('pointermove', trackPointer)
    document.documentElement.removeEventListener('pointerleave', forgetPointer)
  }
}
