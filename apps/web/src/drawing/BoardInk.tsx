import { areaAt, areaPlacement, addingToArea, setAddingToArea } from '../state/areas.ts'
import { Show, createEffect, createSignal, on, onCleanup, onMount, untrack } from 'solid-js'
import {
  BOARD_INK_MAX_SPAN, HIGHLIGHTER, MAX_INK_POINTS, boardInkEnvelope, boardInkLocal, hitInkStroke, inkBounds, inkPath, isBoardInkSize, newId, readableInk,
  type Card, type Id, type InkMark, type Obj, type Stroke, type Vec,
} from '@doggynote/core'
import { COPY, surfaces } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { boardId, camera } from '../state/ui.ts'
import { boardDrawing, boardErasing, endBoardDrawing, inkColor, inkTool, inkWidth, setBoardErasing, setInkColor } from '../state/drawing.ts'
import { theme } from '../theme.ts'
import { showToast } from '../state/toast.ts'
import { rectOf } from '../canvas/layout.ts'
import { IconButton } from '../ui/icons.tsx'
import { InkTools } from './InkTools.tsx'
import './ink.css'

type Draft = {
  pointer: number
  areaId?: Id
  board: Id
  tool: 'pen' | 'highlighter' | 'eraser'
  points: Vec[]
  width: number
  color: string
  opacity: number
  /** The mark hit its size limit; the rest of this gesture is ignored. */
  full: boolean
  /** Ink the eraser can touch, fixed when it goes down: marks drawn meanwhile by others are safe. */
  targets: { card: Card<'ink'>; strokes: Stroke[] }[]
}

/**
 * Draw mode on the board. One controller for the whole board: the gesture in
 * progress is a single preview path (no document writes, no card re-renders);
 * lifting the pen saves the mark as a small `ink` card plus its stroke, in one
 * undo step. The eraser buries whole marks it passes over.
 */
export function createBoardInk(readOnly: () => boolean, toWorld: (e: { clientX: number; clientY: number }) => Vec) {
  let draft: Draft | null = null
  /**
   * Where a shift-click's straight line starts: the end of the last mark (or
   * eraser pass) this Draw session. Forgotten with a new tool, when drawing
   * ends, or when that mark is undone or erased.
   */
  let anchor: { point: Vec; card: Id | null } | null = null
  let lineFrom: Vec | null = null
  const anchorPoint = () => (anchor && (!anchor.card || doc.cardsOn(boardId()).some((c) => c.id === anchor!.card)) ? anchor.point : null)
  const [preview, setPreview] = createSignal<Pick<InkMark, 'points' | 'color' | 'width' | 'opacity'> | null>(null)

  function cancel(): boolean {
    const had = !!draft
    draft = null
    setPreview(null)
    if (boardErasing().size) setBoardErasing(new Set<string>())
    return had
  }

  function erase(point: Vec, previous: Vec) {
    const d = draft!
    const hits = new Set(boardErasing())
    for (const { card, strokes } of d.targets) {
      const r = rectOf(card.id)
      if (!r) continue
      const scale = card.content.width / r.w
      const local = boardInkLocal(point, r, card.content.width)
      const prev = boardInkLocal(previous, r, card.content.width)
      // A fingertip-sized eraser whatever the zoom.
      for (const s of strokes) if (!hits.has(s.id) && hitInkStroke(s, local, (10 / camera().zoom) * scale, prev)) hits.add(s.id)
    }
    if (hits.size !== boardErasing().size) setBoardErasing(hits)
  }

  function down(e: PointerEvent): boolean {
    if (!boardDrawing() || readOnly() || e.button !== 0) return false
    e.preventDefault()
    if (draft) { cancel(); return true }
    const p = toWorld(e)
    const tool = inkTool()
    lineFrom = e.shiftKey ? anchorPoint() : null
    const width = inkWidth() * (tool === 'highlighter' ? HIGHLIGHTER.scale : 1)
    const board = boardId()
    draft = {
      pointer: e.pointerId, areaId: addingToArea() ?? areaAt(p)?.id, board, tool, points: [p], width, color: inkColor(), opacity: tool === 'highlighter' ? HIGHLIGHTER.opacity : 1, full: false,
      targets: tool === 'eraser'
        ? doc.cardsOn(board).filter((c): c is Card<'ink'> => c.type === 'ink' && isBoardInkSize(c.content) && doc.canWriteObject(c)).map((card) => ({ card, strokes: [...doc.strokesOn(card.id)] }))
        : [],
    }
    setAddingToArea(null)
    // Shift-click with the eraser: erase along the straight segment from the anchor.
    if (tool === 'eraser') erase(p, lineFrom ?? p)
    else setPreview({ points: [p], width, color: draft.color, opacity: draft.opacity })
    return true
  }

  function move(e: PointerEvent): boolean {
    const d = draft
    if (!d || d.pointer !== e.pointerId) return false
    e.preventDefault()
    const events = e.getCoalescedEvents?.() ?? []
    for (const ev of events.length ? events : [e]) {
      const p = toWorld(ev)
      const prev = d.points[d.points.length - 1]
      if (d.tool === 'eraser') { erase(p, prev); d.points = [p]; continue }
      if (d.full || Math.hypot(p.x - prev.x, p.y - prev.y) * camera().zoom < 1) continue
      if (d.points.length >= MAX_INK_POINTS || Math.abs(p.x - d.points[0].x) > BOARD_INK_MAX_SPAN / 2 || Math.abs(p.y - d.points[0].y) > BOARD_INK_MAX_SPAN / 2) {
        d.full = true
        showToast(COPY.inkTooLong, 4000)
        continue
      }
      d.points.push(p)
    }
    if (d.tool !== 'eraser') setPreview({ points: [...d.points], width: d.width, color: d.color, opacity: d.opacity })
    return true
  }

  /**
   * The pen lifts: keep the mark. Lost capture (WebKit can send it before
   * pointerup on a quick release) and a cancel keep what was drawn too; only
   * a real pointerup's position is trusted as a final point.
   */
  function up(e: PointerEvent): boolean {
    const d = draft
    if (!d || d.pointer !== e.pointerId) return false
    if (e.type === 'pointerup') move(e)
    const erased = new Set(boardErasing())
    const from = lineFrom
    lineFrom = null
    cancel()
    if (d.board !== boardId() || readOnly()) return true
    // A shift-click that didn't move: a straight line from the anchor.
    if (from && d.tool !== 'eraser' && d.points.length === 1) d.points = [from, d.points[0]]
    const end = d.points[d.points.length - 1]
    if (d.tool === 'eraser') {
      const now = Date.now()
      const patches: Record<Id, Partial<Obj>> = {}
      for (const { card, strokes } of d.targets) {
        const gone = strokes.filter((s) => erased.has(s.id))
        if (!gone.length) continue
        for (const s of gone) patches[s.id] = { deletedAt: now }
        // A mark with nothing left on it goes too (not to the trash: undo brings it back).
        if (doc.strokesOn(card.id).every((s) => erased.has(s.id))) patches[card.id] = { purged: true }
      }
      if (Object.keys(patches).length) doc.update(patches)
      anchor = { point: end, card: null }
      return true
    }
    const box = boardInkEnvelope(d.points, d.width)
    if (!box) return true
    const now = Date.now()
    const card: Card<'ink'> = {
      id: newId(), kind: 'card', type: 'ink', boardId: d.board, createdAt: now,
      x: box.rect.x, y: box.rect.y, w: box.rect.w, h: box.rect.h, z: doc.maxZ(d.board) + 1, color: 'none', columnId: null,
      content: { width: box.rect.w, height: box.rect.h },
    }
    Object.assign(card, areaPlacement({ x: card.x, y: card.y }, d.areaId ? doc.getCard(d.areaId) : undefined))
    const stroke: Stroke = {
      id: newId(), kind: 'stroke', boardId: d.board, cardId: card.id, createdAt: now,
      tool: d.tool, color: d.color, width: d.width, opacity: d.opacity, order: now, points: box.points, bounds: inkBounds(box.points, d.width),
    }
    doc.commit([doc.createChange(card), doc.createChange(stroke)])
    anchor = { point: end, card: card.id }
    return true
  }

  createEffect(on(boardId, () => { cancel(); endBoardDrawing() }, { defer: true }))
  createEffect(() => { if (!boardDrawing() || readOnly()) { cancel(); anchor = null } })
  createEffect(on(inkTool, () => { anchor = null }, { defer: true }))
  onMount(() => {
    // Escape drops the line in progress, or (with none) finishes drawing.
    const key = (e: KeyboardEvent) => {
      if (!boardDrawing() || e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"], .menu')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!cancel()) endBoardDrawing()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    onCleanup(() => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
      cancel()
      endBoardDrawing()
    })
  })
  return { down, move, up, cancel, preview, active: () => !!draft }
}

/** The line being drawn, in world space inside the transformed world. */
export function BoardInkPreview(props: { mark: Pick<InkMark, 'points' | 'color' | 'width' | 'opacity'> | null }) {
  return (
    <Show when={props.mark}>
      {(m) => (
        // Above every card on the board while it's drawn.
        <svg class="board-ink-preview" style={{ 'z-index': untrack(() => doc.maxZ(boardId())) + 1 }} aria-hidden="true" data-testid="board-ink-preview">
          <path d={inkPath(m())} fill="none" stroke={m().color} stroke-width={m().width} stroke-opacity={m().opacity} stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      )}
    </Show>
  )
}

/** Draw mode's floating bar: the ink tools and Done. */
export function BoardInkBar() {
  // The pen never vanishes on the board: an ink too faint on this theme's floor
  // becomes white or charcoal when drawing starts or the theme changes.
  createEffect(on([boardDrawing, theme], ([drawing, t]) => { if (drawing) setInkColor(readableInk(untrack(inkColor), surfaces[t].bg)) }))
  return (
    <Show when={boardDrawing()}>
      <section
        class="board-ink-bar"
        data-nodrag
        data-testid="board-ink-bar"
        aria-label="Drawing on the board"
        onPointerDown={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (!e.metaKey && !e.ctrlKey && ['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) e.stopPropagation() }}
      >
        <InkTools />
        {/* Undo and Redo stay where they always are, in the canvas controls. */}
        <IconButton testid="board-ink-done" icon="check" label="Done drawing" title="Done (Esc)" onClick={endBoardDrawing} />
      </section>
    </Show>
  )
}
