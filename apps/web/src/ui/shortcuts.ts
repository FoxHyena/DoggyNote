import * as doc from '../state/doc.ts'
import { selectAll, trashSelection } from '../state/actions.ts'
import {
  beginEdit,
  clearSelection,
  connectMode,
  editingId,
  endEdit,
  paletteOpen,
  selection,
  setConnectMode,
  setPaletteOpen,
  setTrashOpen,
  trashOpen,
} from '../state/ui.ts'
import { zoomBy, zoomTo, zoomToFit } from '../canvas/Canvas.tsx'
import { toggleSnap } from '../state/grid.ts'

const isTyping = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,[contenteditable="true"]')

export function installShortcuts(opts: { readOnly: boolean }) {
  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    const typing = isTyping(e.target)

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

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return e.shiftKey ? doc.redo() : doc.undo()
    }
    if (mod && e.key.toLowerCase() === 'y') return void (e.preventDefault(), doc.redo())
    if (mod && e.key.toLowerCase() === 'a') return void (e.preventDefault(), selectAll())
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection().size) {
        e.preventDefault()
        trashSelection()
      }
      return
    }
    if (e.key === 'Enter' && selection().size === 1) {
      const id = [...selection()][0]
      const c = doc.getCard(id)
      if (c && c.type !== 'image') {
        e.preventDefault()
        beginEdit(id)
      }
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
