import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import {
  TABLE_CAPS, addColumn, addRows, cellDisplay, cellOf, clearCells, copyGrid, deleteColumns, deleteRows, duplicateRows, moveColumns, moveRows, parseInput, parseTsv, pasteGrid,
  resizeBoundary, setCells, tableTitle, toTsv, updateColumn,
  type Card, type TableColumn, type TablePatch,
} from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../../state/doc.ts'
import { endEdit, onFlushEdit } from '../../state/ui.ts'
import { touch } from '../../state/device.ts'
import { showToast } from '../../state/toast.ts'
import { revealEditCaret, takeEditCaret } from '../../canvas/Canvas.tsx'
import { Icon } from '../../ui/icons.tsx'
import { TableLineMenu } from '../../ui/TableMenus.tsx'
import { activeTable, setActiveTable, type SelectionKind, type TableControl } from './tableControl.ts'
import { bodyRows, confine, edge, enterDown, homeEnd, rangeOf, step, tab, type Cursor, type Dir } from './tableNav.ts'

export { activeTable } from './tableControl.ts'

// What happens on top of a table card while it is edited. The read view stays
// in place; this draws the selection on it and owns one textarea that sits over
// the active cell (outside layout, so rows never move). The selection is local
// and kept by row and column id, so a row someone else adds or removes never
// shifts it. Every action is one doc.update, which is one undo step.
//
// The textarea has two modes. Navigating: it is empty and shows no caret, so
// typing a character replaces the cell. Editing: it holds the draft; Enter or
// Tab saves it and moves on, Escape drops it.

type Pos = { row: string | null; col: string; r: number; c: number }
type Box = { x: number; y: number; w: number; h: number }
type Line = 'rows' | 'cols'
/** Where the grips, resize strips and menus go, in the card's own pixels. */
type Layout = { rows: { y: number; h: number }[]; cols: { x: number; w: number }[]; head: Box | null; table: Box | null }
/** A finger moves this far before a grip press becomes a drag. */
const DRAG_SLOP = 4
const TOUCH_DRAG_SLOP = 8
const LONG_PRESS = 500
type Target = { kind: 'title' } | { kind: 'header'; col: string } | { kind: 'cell'; row: string; col: string }

const ARROWS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
/** Touch: the field is 16px (iOS zooms into smaller ones) and scaled down to the card's 14px. */
const TOUCH_SCALE = 0.875
const TITLE_MAX = 200

export function TableEditor(props: {
  card: Card<'table'>
  wrap: () => HTMLElement
  table: () => HTMLTableElement | undefined
  rowIds: () => string[]
  colIds: () => string[]
  columns: () => TableColumn[]
}) {
  const id = props.card.id
  let ta!: HTMLTextAreaElement
  const [mode, setMode] = createSignal<'nav' | 'edit'>('nav')
  const [onTitle, setOnTitle] = createSignal(false)
  const [anchor, setAnchor] = createSignal<Pos>({ row: null, col: '', r: 0, c: 0 })
  const [focus, setFocus] = createSignal<Pos>({ row: null, col: '', r: 0, c: 0 })
  const [layoutTick, setLayoutTick] = createSignal(0)
  const [boxes, setBoxes] = createSignal<{ active: Box | null; range: Box | null }>({ active: null, range: null })
  const [announcement, setAnnouncement] = createSignal('')
  const [target, setTarget] = createSignal<'title' | 'header' | 'cell'>('cell')
  const [kind, setKind] = createSignal<SelectionKind>('cells')
  const [layout, setLayout] = createSignal<Layout>({ rows: [], cols: [], head: null, table: null }, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) })
  const [hoverCol, setHoverCol] = createSignal<string | null>(null)
  /** While a grip is dragged: the line where the rows or columns would land. */
  const [drop, setDrop] = createSignal<{ kind: Line; at: number } | null>(null)
  const [menu, setMenu] = createSignal<{ kind: Line; x: number; y: number } | null>(null)
  let editTarget: Target = { kind: 'title' }
  let initial = ''

  const size = () => ({ rows: props.rowIds().length, cols: props.colIds().length })
  const titleActive = () => onTitle() || !props.colIds().length
  const column = (colId: string) => props.columns().find((c) => c.id === colId)

  // ---- positions: ids to indices and back ----------------------------------------
  const rowIndex = (p: Pos) => {
    if (p.row === null) return -1
    const i = props.rowIds().indexOf(p.row)
    return i >= 0 ? i : Math.min(p.r, props.rowIds().length - 1)
  }
  const colIndex = (p: Pos) => {
    const i = props.colIds().indexOf(p.col)
    return i >= 0 ? i : Math.max(0, Math.min(p.c, props.colIds().length - 1))
  }
  const at = (p: Pos): Cursor => ({ r: rowIndex(p), c: colIndex(p) })
  const posAt = (cur: Cursor): Pos => {
    const r = Math.max(-1, Math.min(cur.r, props.rowIds().length - 1))
    const c = Math.max(0, Math.min(cur.c, props.colIds().length - 1))
    return { row: r < 0 ? null : props.rowIds()[r]!, col: props.colIds()[c] ?? '', r, c }
  }
  // Whole rows or columns span the table, whatever has been added since they were picked.
  const range = createMemo(() => {
    const r = rangeOf(at(anchor()), at(focus()))
    if (kind() === 'rows') return { ...r, c0: 0, c1: Math.max(0, props.colIds().length - 1) }
    if (kind() === 'cols') return { ...r, r0: -1, r1: props.rowIds().length - 1 }
    return r
  })

  // ---- reading and writing --------------------------------------------------------
  const targetOf = (): Target => {
    if (titleActive()) return { kind: 'title' }
    const a = anchor()
    const cur = at(a)
    const col = props.colIds()[cur.c]!
    return cur.r < 0 ? { kind: 'header', col } : { kind: 'cell', row: props.rowIds()[cur.r]!, col }
  }
  const textOf = (t: Target): string => {
    if (t.kind === 'title') return tableTitle(props.card)
    const col = column(t.col)
    if (!col) return ''
    if (t.kind === 'header') return col.n
    return cellDisplay(col, cellOf(props.card, t.row, t.col))
  }
  /** The change that saves `text` into `t`, or null if nothing would change (or the cell is gone). */
  function patchFor(t: Target, text: string): TablePatch | null {
    if (t.kind === 'title') {
      const title = text.replace(/\s*\n\s*/g, ' ').slice(0, TITLE_MAX)
      return title === tableTitle(props.card) ? null : { content: { ...(props.card.content as object), title } }
    }
    const col = column(t.col)
    if (!col) return null
    if (t.kind === 'header') {
      const name = text.replace(/\s*\n\s*/g, ' ').trim()
      return name === col.n ? null : updateColumn(props.card, t.col, { n: name })
    }
    if (!props.rowIds().includes(t.row)) return null
    if (text === cellDisplay(col, cellOf(props.card, t.row, t.col))) return null
    return setCells(props.card, [{ row: t.row, col: t.col, value: parseInput(col, text) }])
  }
  const run = (...patches: (TablePatch | null)[]) => {
    const merged = Object.assign({}, ...patches.filter(Boolean)) as TablePatch
    if (Object.keys(merged).length) doc.update({ [id]: merged as Partial<Card> })
  }

  // ---- the draft ------------------------------------------------------------------
  /** Leave the draft: the textarea is empty again. Returns the change it makes, to run (alone or with a move). */
  function endDraft(): TablePatch | null {
    if (mode() !== 'edit') return null
    const patch = patchFor(editTarget, ta.value)
    setMode('nav')
    ta.value = ''
    fit()
    return patch
  }
  const commit = () => run(endDraft())
  function cancel() {
    setMode('nav')
    ta.value = ''
    fit()
  }
  function beginEditing(text: string) {
    editTarget = targetOf()
    initial = text
    ta.value = text
    setMode('edit')
    fit()
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(text.length, text.length)
  }

  // ---- moving ---------------------------------------------------------------------
  function settle() {
    setTarget(titleActive() ? 'title' : at(anchor()).r < 0 ? 'header' : 'cell')
    if (mode() === 'edit') cancel()
    ta.focus({ preventScroll: true })
    announce()
    if (touch()) revealEditCaret()
  }
  function goto(to: Cursor, extend = false) {
    if (!props.colIds().length) return
    setKind('cells')
    if (extend && !titleActive()) setFocus(posAt(confine(at(anchor()), to)))
    else {
      const p = posAt(to)
      setOnTitle(false)
      setAnchor(p)
      setFocus(p)
    }
    settle()
  }
  function gotoTitle() {
    setOnTitle(true)
    settle()
  }
  function move(dir: Dir, extend: boolean, jump: boolean) {
    if (titleActive()) {
      if (dir === 'down') goto({ r: -1, c: 0 })
      return
    }
    const cur = at(extend ? focus() : anchor())
    if (dir === 'up' && !extend && !jump && cur.r === -1) return gotoTitle()
    goto(jump ? edge(cur, dir, size()) : step(cur, dir, size()), extend)
  }
  /** Add a row at `index` and select it, saving `before` (a draft) in the same step. */
  function addRowAt(index: number, col: number, before: TablePatch | null = null): boolean {
    const { patch, ids } = addRows(props.card, 1, index)
    if (!ids.length) {
      run(before)
      showToast(COPY.table.rowsFull)
      return false
    }
    run(before, patch)
    goto({ r: index, c: col })
    setAnnouncement(COPY.table.announceRowAdded)
    return true
  }
  function tabMove(back: boolean, before: TablePatch | null = null) {
    if (titleActive()) {
      run(before)
      if (!back) goto({ r: -1, c: 0 })
      return
    }
    const { to, addRow } = tab(at(anchor()), back, size())
    if (addRow) return void addRowAt(to.r, to.c, before)
    run(before)
    goto(to)
  }
  function enterMove(before: TablePatch | null) {
    if (titleActive()) {
      run(before)
      return void goto({ r: size().rows ? 0 : -1, c: 0 })
    }
    const { to, addRow } = enterDown(at(anchor()), size())
    if (addRow) return void addRowAt(to.r, to.c, before)
    run(before)
    goto(to)
  }

  // ---- structure ------------------------------------------------------------------
  const canAddRow = () => props.rowIds().length < TABLE_CAPS.rows
  const canAddColumn = () => props.colIds().length < TABLE_CAPS.cols
  function insertRow(where: 'above' | 'below') {
    commit()
    const r = range()
    addRowAt(where === 'above' ? Math.max(0, r.r0) : r.r1 + 1, Math.max(0, at(anchor()).c))
  }
  function insertColumn(where: 'left' | 'right') {
    const r = range()
    addColumnAt(where === 'left' ? r.c0 : r.c1 + 1)
  }
  /** A new column at `index`, selected on its header so its name can be typed. */
  function addColumnAt(index: number) {
    commit()
    const { patch, ids } = addColumn(props.card, {}, index)
    if (!ids.length) return void showToast(COPY.table.columnsFull)
    run(patch)
    goto({ r: -1, c: index })
    setAnnouncement(COPY.table.announceColumnAdded)
  }
  const rowsSelected = () => bodyRows(range()).filter((r) => r < props.rowIds().length)
  function removeRows() {
    commit()
    const rows = rowsSelected()
    if (!rows.length) return
    const first = rows[0]!
    run(deleteRows(props.card, rows.map((r) => props.rowIds()[r]!)))
    goto({ r: Math.min(first, props.rowIds().length - 1), c: Math.max(0, at(anchor()).c) })
    setAnnouncement(COPY.table.announceRowsDeleted(rows.length))
  }
  const canRemoveColumns = () => !titleActive() && range().c1 - range().c0 + 1 < props.colIds().length
  function removeColumns() {
    if (!canRemoveColumns()) return
    commit()
    const { c0, c1 } = range()
    const ids = props.colIds().slice(c0, c1 + 1)
    const r = Math.max(-1, at(anchor()).r)
    run(deleteColumns(props.card, ids))
    goto({ r, c: Math.min(c0, props.colIds().length - 1) })
    setAnnouncement(COPY.table.announceColumnsDeleted(ids.length))
  }
  function clearSelected() {
    const { c0, c1 } = range()
    const refs = rowsSelected().flatMap((r) => props.colIds().slice(c0, c1 + 1).map((col) => ({ row: props.rowIds()[r]!, col })))
    if (!refs.length) return
    run(clearCells(props.card, refs))
    setAnnouncement(COPY.table.announceCleared)
  }
  function selectAll() {
    if (!size().rows || !size().cols) return
    setOnTitle(false)
    setAnchor(posAt({ r: 0, c: 0 }))
    setFocus(posAt({ r: size().rows - 1, c: size().cols - 1 }))
    settle()
  }

  // ---- whole rows and columns -----------------------------------------------------
  /** Select a row or column (a grip, a header's menu). `extend` stretches the selection from where it was. */
  function selectLine(k: Line, index: number, extend = false) {
    commit()
    setOnTitle(false)
    const cur = at(anchor())
    const from = extend ? (kind() === k ? (k === 'rows' ? cur.r : cur.c) : k === 'rows' ? Math.max(0, cur.r) : cur.c) : index
    const last = (n: number) => Math.max(0, n - 1)
    const a = k === 'rows' ? posAt({ r: from, c: 0 }) : posAt({ r: -1, c: from })
    const f = k === 'rows' ? posAt({ r: index, c: last(props.colIds().length) }) : posAt({ r: props.rowIds().length - 1, c: index })
    setKind(k)
    setAnchor(a)
    setFocus(f)
    settle()
    const n = k === 'rows' ? rowsSelected().length : range().c1 - range().c0 + 1
    setAnnouncement(k === 'rows' ? COPY.table.announceRowsSelected(n) : COPY.table.announceColumnsSelected(n))
  }
  const lineIds = (k: Line): string[] => (k === 'rows' ? rowsSelected().map((r) => props.rowIds()[r]!) : props.colIds().slice(range().c0, range().c1 + 1))
  const inLine = (k: Line, index: number) => kind() === k && (k === 'rows' ? index >= range().r0 && index <= range().r1 : index >= range().c0 && index <= range().c1)
  const lineSpan = (k: Line): [number, number] => (k === 'rows' ? [Math.max(0, range().r0), range().r1] : [range().c0, range().c1])
  const lineCount = (k: Line) => (k === 'rows' ? props.rowIds().length : props.colIds().length)
  function canMove(step: -1 | 1) {
    const k = kind()
    if (k === 'cells') return false
    const [first, last] = lineSpan(k)
    return step < 0 ? first > 0 : last < lineCount(k) - 1
  }
  /** One step with the selection, or all the way to a place (a drop): `to` counts among the rows that stay. */
  function moveLines(k: Line, to: number) {
    commit()
    const ids = lineIds(k)
    const patch = k === 'rows' ? moveRows(props.card, ids, to) : moveColumns(props.card, ids, to)
    if (!Object.keys(patch).length) return
    run(patch)
    setAnnouncement(COPY.table.announceMoved)
  }
  function moveBy(step: -1 | 1) {
    const k = kind()
    if (k === 'cells' || !canMove(step)) return
    moveLines(k, lineSpan(k)[0] + step)
  }
  const canDuplicateRows = () => kind() === 'rows' && rowsSelected().length > 0 && props.rowIds().length + rowsSelected().length <= TABLE_CAPS.rows
  function duplicateSelectedRows() {
    commit()
    if (kind() !== 'rows') return
    const { patch, ids } = duplicateRows(props.card, lineIds('rows'))
    if (!ids.length) return void showToast(COPY.table.rowsFull)
    run(patch)
    // The copies are the new selection.
    const first = props.rowIds().indexOf(ids[0]!)
    selectLine('rows', first)
    selectLine('rows', first + ids.length - 1, true)
    setAnnouncement(COPY.table.announceDuplicated)
  }
  function renameColumn() {
    if (kind() !== 'cols') return
    const c = range().c0
    commit()
    goto({ r: -1, c })
    beginEditing(textOf(targetOf()))
  }

  // ---- the clipboard --------------------------------------------------------------
  // Copy and cut work through the field itself: on the keystroke it holds the text and selects it, so
  // WebKit, which only copies a selection, fires `copy` here. Paste reads plain text only.
  let clipReady = false
  const rangeGrid = () => {
    const rows = bodyRows(range()).filter((r) => r < props.rowIds().length).map((r) => props.rowIds()[r]!)
    return copyGrid(props.card, rows, props.colIds().slice(range().c0, range().c1 + 1), range().r0 < 0)
  }
  function gridHtml(grid: string[][], header: boolean): string {
    const table = document.createElement('table')
    grid.forEach((line, i) => {
      const tr = table.insertRow()
      for (const text of line) {
        const cell = document.createElement(header && i === 0 ? 'th' : 'td')
        cell.textContent = text
        tr.append(cell)
      }
    })
    return table.outerHTML
  }
  function armClip() {
    const text = titleActive() ? tableTitle(props.card) : toTsv(rangeGrid())
    ta.value = text || ' '
    ta.select()
    clipReady = true
    setTimeout(() => {
      if (!clipReady) return
      clipReady = false
      if (mode() === 'nav') ta.value = ''
    }, 0)
  }
  function writeClip(e: ClipboardEvent): boolean {
    if (mode() !== 'nav' || !clipReady || !e.clipboardData) return false
    clipReady = false
    e.preventDefault()
    if (titleActive()) e.clipboardData.setData('text/plain', tableTitle(props.card))
    else {
      const grid = rangeGrid()
      e.clipboardData.setData('text/plain', toTsv(grid))
      e.clipboardData.setData('text/html', gridHtml(grid, range().r0 < 0))
    }
    ta.value = ''
    return true
  }
  function onCopy(e: ClipboardEvent) {
    if (writeClip(e)) setAnnouncement(COPY.table.announceCopied)
  }
  function onCut(e: ClipboardEvent) {
    if (!writeClip(e) || titleActive()) return
    clearSelected()
    setAnnouncement(COPY.table.announceCut)
  }
  function onPaste(e: ClipboardEvent) {
    // A draft or the title takes the text as typed; cells take it as a grid.
    if (mode() === 'edit' || titleActive()) return
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!text) return
    const grid = parseTsv(text)
    if (!grid.length) return
    const r = range()
    const result = pasteGrid(props.card, grid, { r: r.r0, c: r.c0 }, r)
    run(result.patch)
    if (result.clipped) showToast(COPY.table.pasteClipped, 6000)
    // The pasted cells are the new selection.
    const to = result.range
    setKind('cells')
    setOnTitle(false)
    setAnchor(posAt({ r: to.r0, c: to.c0 }))
    setFocus(posAt({ r: to.r1, c: to.c1 }))
    settle()
    setAnnouncement(COPY.table.announcePasted((to.r1 - to.r0 + 1) * (to.c1 - to.c0 + 1)))
  }

  // ---- keys -----------------------------------------------------------------------
  function onKeyDown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key
    if (mode() === 'edit') {
      if (key === 'Enter') {
        e.preventDefault()
        // A newline is wanted: Shift or Alt+Enter (a title is one line).
        if (e.shiftKey || e.altKey) {
          if (editTarget.kind === 'cell') {
            ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end')
            fit()
          }
          return
        }
        return enterMove(endDraft())
      }
      if (key === 'Tab') {
        e.preventDefault()
        return tabMove(e.shiftKey, endDraft())
      }
      if (key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        return cancel()
      }
      // Undo works on the text typed so far; with nothing typed it undoes the table.
      if (mod && key.toLowerCase() === 'z' && ta.value === initial) {
        e.preventDefault()
        cancel()
        return e.shiftKey ? doc.redo() : doc.undo()
      }
      return
    }
    const dir = ARROWS[key]
    // Alt+Shift+arrows move the selected rows (up, down) or columns (left, right).
    if (dir && e.altKey && e.shiftKey && !mod) {
      e.preventDefault()
      e.stopPropagation()
      const k = kind()
      if (k === 'rows' && (dir === 'up' || dir === 'down')) moveBy(dir === 'up' ? -1 : 1)
      else if (k === 'cols' && (dir === 'left' || dir === 'right')) moveBy(dir === 'left' ? -1 : 1)
      return
    }
    // Shift+arrows along a selected line stretch it.
    if (dir && e.shiftKey && !mod && !e.altKey) {
      const k = kind()
      const along = k === 'rows' ? dir === 'up' || dir === 'down' : k === 'cols' ? dir === 'left' || dir === 'right' : false
      if (k !== 'cells' && along) {
        e.preventDefault()
        const f = at(focus())
        const next = (k === 'rows' ? f.r : f.c) + (dir === 'up' || dir === 'left' ? -1 : 1)
        return selectLine(k, Math.max(0, Math.min(lineCount(k) - 1, next)), true)
      }
    }
    if (dir) {
      e.preventDefault()
      return move(dir, e.shiftKey, mod)
    }
    if (mod) {
      const k = key.toLowerCase()
      if (k === 'c' || k === 'x') return armClip()
      if (k === 'a') { e.preventDefault(); return selectAll() }
      if (k === 'z') { e.preventDefault(); return e.shiftKey ? doc.redo() : doc.undo() }
      if (k === 'y') { e.preventDefault(); return doc.redo() }
      if (key === 'Home' || key === 'End') { e.preventDefault(); return goto(homeEnd(at(anchor()), key === 'End', true, size()), e.shiftKey) }
      return
    }
    switch (key) {
      case 'Enter':
      case 'F2':
        e.preventDefault()
        if (kind() === 'rows') goto({ r: at(anchor()).r, c: 0 })
        return beginEditing(textOf(targetOf()))
      case 'Tab':
        e.preventDefault()
        return tabMove(e.shiftKey)
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        // Whole rows or columns step back to a cell first.
        if (kind() !== 'cells') return goto(at(anchor()))
        return endEdit()
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        return clearSelected()
      case 'Home':
      case 'End':
        e.preventDefault()
        if (!titleActive()) goto(homeEnd(at(anchor()), key === 'End', false, size()), e.shiftKey)
        return
    }
  }
  // The first character typed while navigating replaces the cell: it lands in the empty field.
  function onInput() {
    // Typing with a whole row or column picked would write somewhere unseen: it does nothing.
    if (mode() === 'nav' && ta.value && kind() !== 'cells') { ta.value = ''; return }
    if (mode() === 'nav' && ta.value) {
      editTarget = targetOf()
      initial = ''
      setMode('edit')
    }
    if (mode() === 'edit') fit()
  }
  const onCompositionStart = () => {
    if (mode() === 'nav' && kind() === 'cells') { editTarget = targetOf(); initial = ''; setMode('edit') }
  }

  // ---- pointer --------------------------------------------------------------------
  type Hit = { title: true } | { title?: false; cur: Cursor }
  function hitOf(el: EventTarget | null): Hit | null {
    const node = el instanceof Element ? el : null
    if (!node || node === ta) return null
    if (node.closest('[data-table-title]')) return { title: true }
    const cell = node.closest<HTMLElement>('td[data-col], th[data-col]')
    if (!cell || !props.table()?.contains(cell)) return null
    const r = cell.dataset.row ? props.rowIds().indexOf(cell.dataset.row) : -1
    const c = props.colIds().indexOf(cell.dataset.col!)
    return c < 0 || (cell.dataset.row && r < 0) ? null : { cur: { r, c } }
  }
  // A touch's own pointerdown is cancelled by the canvas (WebKit then sends no click), so a tap
  // is recognised here: down and up close together, close in time.
  let tapStart: { x: number; y: number; at: number } | null = null
  let dragging = false
  function pointerDown(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      tapStart = { x: e.clientX, y: e.clientY, at: performance.now() }
      return
    }
    tapStart = null
    if (e.button !== 0) return
    const hit = hitOf(e.target)
    if (!hit || (e.target as Element).closest('[data-table-strip]')) return
    // Keep the focus where it is (the field), so no text selection starts either.
    e.preventDefault()
    commit()
    if (hit.title) {
      gotoTitle()
      return beginEditing(textOf(targetOf()))
    }
    goto(hit.cur, e.shiftKey && !titleActive())
    dragging = true
    try { props.wrap().setPointerCapture(e.pointerId) } catch { /* the pointer is already gone */ }
  }
  function pointerMove(e: PointerEvent) {
    if (e.pointerType === 'mouse') setHoverCol((e.target as HTMLElement | null)?.closest?.('th[data-col], .table-col-menu')?.getAttribute('data-col') ?? null)
    if (!dragging) return
    const hit = hitOf(document.elementFromPoint(e.clientX, e.clientY))
    if (hit && !hit.title) setFocus(posAt(confine(at(anchor()), hit.cur)))
  }
  function pointerUp(e: PointerEvent) {
    const start = tapStart
    tapStart = null
    if (e.pointerType === 'touch' && e.type === 'pointerup' && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10 && performance.now() - start.at < 500) tapCell(e)
    if (!dragging) return
    dragging = false
    try { props.wrap().releasePointerCapture(e.pointerId) } catch { /* released */ }
    announce()
  }
  const leave = () => setHoverCol(null)
  /** What is under a click. The pointer was captured for dragging, so the event's own target is the card. */
  const under = (e: MouseEvent) => document.elementFromPoint(e.clientX, e.clientY) ?? e.target
  function doubleClick(e: MouseEvent) {
    // A touch double tap is two taps (select, then edit): never an extra edit.
    if (touch()) return
    const hit = hitOf(under(e))
    if (hit && !hit.title) beginEditing(textOf(targetOf()))
  }
  // A tap selects a cell; a tap on the selected cell edits it. Focus moves inside the tap, so the keyboard comes up.
  function tapCell(e: MouseEvent) {
    const el = under(e)
    if (el instanceof Element && el.closest('[data-table-strip]')) return
    const hit = hitOf(el)
    if (!hit) return
    if (hit.title) {
      commit()
      gotoTitle()
      return beginEditing(textOf(targetOf()))
    }
    const a = at(anchor())
    const same = mode() === 'nav' && !titleActive() && a.r === hit.cur.r && a.c === hit.cur.c && range().r0 === range().r1 && range().c0 === range().c1
    commit()
    goto(hit.cur)
    if (same) beginEditing(textOf(targetOf()))
  }

  // ---- grips, resize strips and menus ---------------------------------------------
  const kScale = () => { const w = props.wrap(); return w.getBoundingClientRect().width / (w.offsetWidth || 1) || 1 }
  const toCard = (clientX: number, clientY: number) => {
    const r = props.wrap().getBoundingClientRect()
    const k = kScale()
    return { x: (clientX - r.left) / k, y: (clientY - r.top) / k }
  }
  const release = (el: Element, id: number) => { try { el.releasePointerCapture(id) } catch { /* released */ } }
  type GripDrag = { id: number; kind: Line; x: number; y: number; moved: boolean; to: number; timer?: ReturnType<typeof setTimeout>; el: HTMLElement; touch: boolean }
  let grip: GripDrag | null = null
  function gripDown(e: PointerEvent, k: Line, index: number) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // The field keeps the keyboard focus, and a touch's pointerdown is the only event we get to act on.
    e.preventDefault()
    e.stopPropagation()
    commit()
    if (e.shiftKey) selectLine(k, index, true)
    else if (!inLine(k, index)) selectLine(k, index)
    else ta.focus({ preventScroll: true })
    const el = e.currentTarget as HTMLElement
    const g: GripDrag = { id: e.pointerId, kind: k, x: e.clientX, y: e.clientY, moved: false, to: -1, el, touch: e.pointerType !== 'mouse' }
    grip = g
    try { el.setPointerCapture(e.pointerId) } catch { /* the pointer is already gone */ }
    // A held finger asks for the menu, as a right click does.
    if (g.touch) g.timer = setTimeout(() => {
      if (grip !== g || g.moved) return
      grip = null
      release(el, g.id)
      const r = el.getBoundingClientRect()
      setMenu({ kind: k, x: r.right + 4, y: r.top })
    }, LONG_PRESS)
  }
  function gripMove(e: PointerEvent) {
    const g = grip
    if (!g || e.pointerId !== g.id) return
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < (g.touch ? TOUCH_DRAG_SLOP : DRAG_SLOP)) return
      g.moved = true
      clearTimeout(g.timer)
    }
    const p = toCard(e.clientX, e.clientY)
    const L = layout()
    const [first, last] = lineSpan(g.kind)
    const boxes = g.kind === 'rows' ? L.rows.map((b) => ({ a: b.y, b: b.y + b.h })) : L.cols.map((b) => ({ a: b.x, b: b.x + b.w }))
    const stay = boxes.filter((_, i) => i < first || i > last)
    const pos = g.kind === 'rows' ? p.y : p.x
    g.to = stay.filter((b) => (b.a + b.b) / 2 < pos).length
    setDrop({ kind: g.kind, at: g.to < stay.length ? stay[g.to]!.a : (stay[stay.length - 1]?.b ?? 0) })
  }
  function gripUp(e: PointerEvent) {
    const g = grip
    if (!g || e.pointerId !== g.id) return
    grip = null
    clearTimeout(g.timer)
    release(g.el, g.id)
    setDrop(null)
    if (g.moved && e.type === 'pointerup' && g.to >= 0) moveLines(g.kind, g.to)
    ta.focus({ preventScroll: true })
  }
  function gripContextMenu(e: MouseEvent, k: Line, index: number) {
    e.preventDefault()
    e.stopPropagation()
    if (grip) { clearTimeout(grip.timer); grip = null }
    commit()
    if (!inLine(k, index)) selectLine(k, index)
    setMenu({ kind: k, x: e.clientX, y: e.clientY })
  }
  /** A column header's ⋯: pick the column and open its menu under the button. */
  function openColumnMenu(index: number, button: HTMLElement) {
    commit()
    if (!inLine('cols', index)) selectLine('cols', index)
    const r = button.getBoundingClientRect()
    setMenu({ kind: 'cols', x: r.left, y: r.bottom + 4 })
  }
  const columnSelected = (index: number) => inLine('cols', index)

  type Resize = { id: number; left: string; x0: number; k: number; width: number; total: number; patch: TablePatch; el: HTMLElement }
  let resizing: Resize | null = null
  /** Show these weights on the table without touching the document. */
  function showWeights(patch: TablePatch) {
    const cols = props.table()?.querySelectorAll('col')
    const weights = props.columns().map((c) => (patch[`tk${c.id}`] as { w?: number } | undefined)?.w ?? c.w)
    const total = weights.reduce((a, b) => a + b, 0) || 1
    cols?.forEach((el, i) => { el.style.width = `${((weights[i] ?? 1) / total) * 100}%` })
    setLayoutTick((n) => n + 1)
  }
  function resizeDown(e: PointerEvent, left: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    commit()
    const el = e.currentTarget as HTMLElement
    resizing = { id: e.pointerId, left, x0: e.clientX, k: kScale(), width: layout().table?.w || 1, total: props.columns().reduce((a, c) => a + c.w, 0) || 1, patch: {}, el }
    try { el.setPointerCapture(e.pointerId) } catch { /* gone */ }
  }
  function resizeMove(e: PointerEvent) {
    const r = resizing
    if (!r || e.pointerId !== r.id) return
    // Pixels to weight: the weights' sum stays, so the card keeps its width.
    r.patch = resizeBoundary(props.card, r.left, ((e.clientX - r.x0) / r.k / r.width) * r.total)
    showWeights(r.patch)
  }
  function resizeUp(e: PointerEvent) {
    const r = resizing
    if (!r || e.pointerId !== r.id) return
    resizing = null
    release(r.el, r.id)
    // One drag is one commit.
    if (e.type === 'pointerup' && Object.keys(r.patch).length) run(r.patch)
    else showWeights({})
    ta.focus({ preventScroll: true })
  }
  /** Double-click a boundary: the two columns share their width equally. */
  function evenOut(left: string) {
    commit()
    const cols = props.columns()
    const i = cols.findIndex((c) => c.id === left)
    const [a, b] = [cols[i], cols[i + 1]]
    if (a && b) run(resizeBoundary(props.card, left, (a.w + b.w) / 2 - a.w))
    ta.focus({ preventScroll: true })
  }

  // ---- drawing --------------------------------------------------------------------
  function boxOf(el: Element): Box {
    const wrap = props.wrap()
    const w = wrap.getBoundingClientRect()
    // The board is scaled by the camera: measure in the card's own pixels.
    const k = w.width / (wrap.offsetWidth || 1) || 1
    const r = el.getBoundingClientRect()
    return { x: (r.left - w.left) / k, y: (r.top - w.top) / k, w: r.width / k, h: r.height / k }
  }
  function cellEl(r: number, c: number): HTMLElement | null {
    const t = props.table()
    const row = r < 0 ? t?.tHead?.rows[0] : t?.tBodies[0]?.rows[r]
    return row?.cells[c] ?? null
  }
  function measure() {
    const wrap = props.wrap()
    if (!wrap) return
    const next: { active: Box | null; range: Box | null } = { active: null, range: null }
    let fill: HTMLElement | null = null
    if (titleActive()) {
      const el = wrap.querySelector('[data-table-title]')
      next.active = el ? boxOf(el) : null
    } else {
      const a = at(anchor())
      const ae = cellEl(a.r, a.c)
      fill = ae
      next.active = ae ? boxOf(ae) : null
      // One rectangle from the range's first and last cells, measured now (after any wrapping).
      const { r0, r1, c0, c1 } = range()
      // A range that reaches into the body leaves the header out of the tint, so its muted text stays easy to read.
      const [first, last] = [cellEl(r0 < 0 && r1 >= 0 ? 0 : r0, c0), cellEl(r1, c1)]
      if (first && last && (kind() !== 'cells' || r0 !== r1 || c0 !== c1)) {
        const [p, q] = [boxOf(first), boxOf(last)]
        const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y)
        next.range = { x, y, w: Math.max(p.x + p.w, q.x + q.w) - x, h: Math.max(p.y + p.h, q.y + q.h) - y }
      }
    }
    const t = props.table()
    const head = t?.tHead?.rows[0]
    setLayout({
      rows: [...(t?.tBodies[0]?.rows ?? [])].map((tr) => { const b = boxOf(tr); return { y: b.y, h: b.h } }),
      cols: head ? [...head.cells].map((c) => { const b = boxOf(c); return { x: b.x, w: b.w } }) : [],
      head: head ? boxOf(head) : null,
      table: t ? boxOf(t) : null,
    })
    // A filled cell keeps its colour under the draft.
    ta.style.setProperty('--ta-bg', fill?.dataset.fill !== undefined ? fill.style.getPropertyValue('--cell-bg') : '')
    // The field's text lines up with the cell's: 14px at the card's edges.
    const ai = at(anchor()).c
    ta.style.setProperty('--ta-pl', !titleActive() && ai === 0 ? '14px' : '')
    ta.style.setProperty('--ta-pr', !titleActive() && ai === props.colIds().length - 1 ? '14px' : '')
    ta.style.setProperty('--ta-fg', fill?.dataset.fill !== undefined ? fill.style.getPropertyValue('--cell-text') : '')
    setBoxes(next)
    fit()
  }
  /** The field covers its cell, and grows past it while a long draft is typed. */
  function fit() {
    const box = boxes().active
    if (!box) return
    const s = touch() ? TOUCH_SCALE : 1
    ta.style.height = '0px'
    ta.style.height = `${Math.max(box.h / s, mode() === 'edit' ? ta.scrollHeight : 0)}px`
  }
  const ro = new ResizeObserver(() => setLayoutTick((n) => n + 1))
  createEffect(() => {
    // Whatever moves a cell: the selection, rows and columns, widths and heights, the input mode.
    onTitle(); anchor(); focus(); kind(); props.rowIds(); props.colIds(); props.columns(); layoutTick(); touch()
    measure()
  })
  createEffect(on(mode, fit))

  // ---- announcements --------------------------------------------------------------
  function announce() {
    if (titleActive()) return setAnnouncement(tableTitle(props.card) || COPY.table.titlePlaceholder)
    const a = at(anchor())
    const col = props.colIds()[a.c]
    const name = column(col!)?.n || COPY.table.columnFallback
    setAnnouncement(a.r < 0 ? COPY.table.announceHeader(name) : COPY.table.announceCell(a.r + 1, size().rows, name, textOf(targetOf())))
  }
  const label = () => {
    if (titleActive()) return COPY.table.titlePlaceholder
    const a = at(anchor())
    const name = column(props.colIds()[a.c]!)?.n || COPY.table.columnFallback
    return a.r < 0 ? COPY.table.headerLabel(a.c + 1) : COPY.table.cellLabel(a.r + 1, name)
  }

  // ---- lifecycle ------------------------------------------------------------------
  const control: TableControl = {
    cardId: id,
    kind,
    canMove,
    move: moveBy,
    duplicateRows: duplicateSelectedRows,
    canDuplicateRows,
    renameColumn,
    rowSpan: () => rowsSelected().length,
    colSpan: () => (titleActive() ? 0 : range().c1 - range().c0 + 1),
    inHeader: () => !titleActive() && range().r0 < 0,
    canAddRow, canAddColumn,
    canRemoveColumns: () => canRemoveColumns(),
    next: () => tabMove(false, endDraft()),
    prev: () => tabMove(true, endDraft()),
    insertRow, insertColumn,
    removeRows, removeColumns,
    clear: clearSelected,
    refocus: () => ta.focus({ preventScroll: true }),
  }
  onMount(() => {
    const wrap = props.wrap()
    // Open on the cell that was clicked or tapped, else the first cell.
    const p = takeEditCaret()
    const hit = p ? hitOf(document.elementsFromPoint(p.x, p.y).find((el) => wrap.contains(el) && el !== ta) ?? null) : null
    if (hit?.title) setOnTitle(true)
    else {
      const to = hit && !hit.title ? hit.cur : { r: size().rows ? 0 : -1, c: 0 }
      const pos = posAt(to)
      setAnchor(pos)
      setFocus(pos)
    }
    setTarget(titleActive() ? 'title' : at(anchor()).r < 0 ? 'header' : 'cell')
    wrap.addEventListener('pointerdown', pointerDown)
    wrap.addEventListener('pointermove', pointerMove)
    wrap.addEventListener('pointerup', pointerUp)
    wrap.addEventListener('pointercancel', pointerUp)
    wrap.addEventListener('dblclick', doubleClick)
    wrap.addEventListener('pointerleave', leave)
    ro.observe(wrap)
    const table = props.table()
    if (table) ro.observe(table)
    setActiveTable(control)
    ta.focus({ preventScroll: true })
    announce()
    onCleanup(() => {
      wrap.removeEventListener('pointerdown', pointerDown)
      wrap.removeEventListener('pointermove', pointerMove)
      wrap.removeEventListener('pointerup', pointerUp)
      wrap.removeEventListener('pointercancel', pointerUp)
      wrap.removeEventListener('dblclick', doubleClick)
      wrap.removeEventListener('pointerleave', leave)
      ro.disconnect()
    })
  })
  // A flush (before a sync pull that removes something, or when the edit ends) saves the draft but
  // leaves it open: whoever is typing keeps typing. Saving again later just finds nothing new.
  onCleanup(onFlushEdit((active) => { if (active === id && mode() === 'edit') run(patchFor(editTarget, ta.value)) }))
  onCleanup(() => { if (activeTable() === control) setActiveTable(null) })

  // A strip keeps the field's focus. A touch acts on pointerdown (the canvas cancels it, and WebKit then sends no click).
  let touchActed = -Infinity
  const strip = (act: (e: { currentTarget: Element }) => void) => ({
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault()
      if (e.pointerType === 'touch') { touchActed = performance.now(); act(e as unknown as { currentTarget: Element }) }
    },
    onClick: (e: MouseEvent) => { if (performance.now() - touchActed > 700) act(e as unknown as { currentTarget: Element }) },
  })
  const scale = () => (touch() ? TOUCH_SCALE : 1)
  return (
    <div class="table-editor" data-testid="table-editor">
      <Show when={boxes().range}>
        {(r) => <div class="table-range" data-testid="table-range" aria-hidden="true" style={{ left: `${r().x}px`, top: `${r().y}px`, width: `${r().w}px`, height: `${r().h}px` }} />}
      </Show>
      <textarea
        ref={ta}
        class="table-input"
        data-testid="table-input"
        data-mode={mode()}
        data-target={target()}
        data-kind={kind()}
        rows={1}
        aria-label={label()}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        style={{
          left: `${boxes().active?.x ?? 0}px`,
          top: `${boxes().active?.y ?? 0}px`,
          width: `${(boxes().active?.w ?? 0) / scale()}px`,
        }}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onBlur={commit}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      />
      <Show when={layout().head}>
        <div class="table-gutter table-gutter-rows" role="group" aria-label={COPY.table.rowActions} data-testid="table-row-grips">
          <For each={props.rowIds()}>
            {(rowId, i) => (
              <Show when={layout().rows[i()]}>
                {(box) => (
                  <button
                    type="button"
                    tabIndex={-1}
                    class="table-grip"
                    classList={{ on: inLine('rows', i()) }}
                    data-grip="row"
                    data-row={rowId}
                    data-testid="table-row-grip"
                    aria-label={COPY.table.rowGrip(i() + 1)}
                    style={{ top: `${box().y}px`, height: `${box().h}px` }}
                    onPointerDown={(e) => gripDown(e, 'rows', i())}
                    onPointerMove={gripMove}
                    onPointerUp={gripUp}
                    onPointerCancel={gripUp}
                    onContextMenu={(e) => gripContextMenu(e, 'rows', i())}
                  >
                    <Icon name="grip" size={16} />
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
        <div class="table-gutter table-gutter-cols" role="group" aria-label={COPY.table.columnActions} data-testid="table-column-grips">
          <For each={props.colIds()}>
            {(colId, i) => (
              <Show when={layout().cols[i()]}>
                {(box) => (
                  <button
                    type="button"
                    tabIndex={-1}
                    class="table-grip"
                    classList={{ on: inLine('cols', i()) }}
                    data-grip="column"
                    data-col={colId}
                    data-testid="table-column-grip"
                    aria-label={COPY.table.columnGrip(column(colId)?.n ?? '')}
                    style={{ left: `${box().x}px`, width: `${box().w}px` }}
                    onPointerDown={(e) => gripDown(e, 'cols', i())}
                    onPointerMove={gripMove}
                    onPointerUp={gripUp}
                    onPointerCancel={gripUp}
                    onContextMenu={(e) => gripContextMenu(e, 'cols', i())}
                  >
                    <Icon name="grip" size={16} />
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
        <For each={props.colIds()}>
          {(colId, i) => (
            <Show when={layout().cols[i()] && layout().head}>
              <button
                type="button"
                tabIndex={-1}
                class="table-col-menu"
                classList={{ shown: hoverCol() === colId || columnSelected(i()) }}
                data-col={colId}
                data-testid="table-column-menu"
                aria-haspopup="menu"
                aria-label={COPY.table.columnMenu(column(colId)?.n ?? '')}
                style={{ left: `${layout().cols[i()]!.x + layout().cols[i()]!.w}px`, top: `${layout().head!.y}px`, height: `${layout().head!.h}px` }}
                {...strip((e) => openColumnMenu(i(), e.currentTarget as HTMLElement))}
              >
                <Icon name="more" size={16} />
              </button>
            </Show>
          )}
        </For>
        <For each={props.colIds().slice(0, -1)}>
          {(colId, i) => (
            <Show when={layout().cols[i()] && layout().head}>
              <div
                class="table-resize"
                data-testid="table-resize"
                data-col={colId}
                role="separator"
                aria-orientation="vertical"
                aria-label={COPY.table.resizeColumn}
                style={{ left: `${layout().cols[i()]!.x + layout().cols[i()]!.w}px`, top: `${layout().head!.y}px`, height: `${layout().head!.h}px` }}
                onPointerDown={(e) => resizeDown(e, colId)}
                onPointerMove={resizeMove}
                onPointerUp={resizeUp}
                onPointerCancel={resizeUp}
                onDblClick={(e) => { e.stopPropagation(); evenOut(colId) }}
              />
            </Show>
          )}
        </For>
        <Show when={drop()}>
          {(d) => <div class="table-drop" data-kind={d().kind} data-testid="table-drop" style={d().kind === 'rows' ? { top: `${d().at}px` } : { left: `${d().at}px` }} />}
        </Show>
      </Show>
      <Show when={menu()}>
        {(m) => <TableLineMenu kind={m().kind} x={m().x} y={m().y} returnTo={() => ta} close={() => { setMenu(null); ta.focus({ preventScroll: true }) }} />}
      </Show>
      <Show when={canAddRow()}>
        <button class="table-add table-add-row" data-table-strip data-testid="table-add-row" aria-label={COPY.table.addRow} data-tip={COPY.table.addRow} {...strip(() => { commit(); addRowAt(props.rowIds().length, Math.max(0, at(anchor()).c)) })}>
          <Icon name="plus" size={16} />
        </button>
      </Show>
      <Show when={canAddColumn()}>
        <button class="table-add table-add-column" data-table-strip data-testid="table-add-column" aria-label={COPY.table.addColumn} data-tip={COPY.table.addColumn} {...strip(() => addColumnAt(props.colIds().length))}>
          <Icon name="plus" size={16} />
        </button>
      </Show>
      <div class="table-live" role="status" aria-live="polite">{announcement()}</div>
    </div>
  )
}
