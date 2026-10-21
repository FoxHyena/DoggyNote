import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import {
  CANVAS_INK_MAX_POINTS, canvasInkEnvelope, canvasInkLocal,
  hitInkStroke, inkBounds, inkPath, isCanvasInkSize, newId, screenToWorld,
  type Card, type InkMark, type Stroke, type Vec,
} from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { boardId, camera, viewport } from '../state/ui.ts'
import {
  canvasDrawing, canvasErasing, canvasInkColor, canvasInkTool, canvasInkWidth,
  endCanvasDrawing, setCanvasErasing, setCanvasInkColor, setCanvasInkTool, setCanvasInkWidth,
} from '../state/canvasDrawing.ts'
import { showToast } from '../state/toast.ts'
import { touch } from '../state/device.ts'
import { InkTools } from './InkTools.tsx'
import { rectOf } from '../canvas/layout.ts'
import './canvas-ink.css'

type Draft = {
  pointer: number; board: string; points: Vec[]; tool: 'pen' | 'highlighter' | 'eraser'
  width: number; color: string; opacity: number; limited: boolean
  candidates: { card: Card<'ink'>; strokes: Stroke[] }[]
}

/** One board-level controller. Drafts never enter the synced document. */
export function createCanvasInkController(readOnly: () => boolean, holdSpaceForPan: () => void) {
  let draft: Draft | null = null
  const [preview, setPreview] = createSignal<Pick<InkMark, 'points' | 'color' | 'width' | 'opacity'> | null>(null)
  const world = (e: PointerEvent) => {
    const v = viewport()
    return screenToWorld(camera(), { x: e.clientX - v.left, y: e.clientY - v.top })
  }
  const outside = (e: PointerEvent) => e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight
  function cancel() {
    const had = !!draft
    draft = null
    setPreview(null)
    setCanvasErasing(new Set<string>())
    return had
  }
  function erase(point: Vec, previous = point) {
    const d = draft!
    const erased = new Set(canvasErasing())
    // Snapshot candidates at gesture start: concurrent additions are not erased.
    for (const { card, strokes } of d.candidates) {
      const r = rectOf(card.id)
      if (!r || !doc.canWriteObject(doc.getCard(card.id))) continue
      const local = canvasInkLocal(point, r, card.content.width)
      const prev = canvasInkLocal(previous, r, card.content.width)
      const radius = 9 / camera().zoom * card.content.width / r.w
      for (const s of strokes) if (hitInkStroke(s, local, radius, prev)) erased.add(s.id)
    }
    setCanvasErasing(erased)
  }
  function move(e: PointerEvent): boolean {
    const d = draft
    if (!d || d.pointer !== e.pointerId) return false
    e.preventDefault()
    if (outside(e) || readOnly()) { cancel(); return true }
    const events = e.getCoalescedEvents?.() ?? []
    for (const ev of events.length ? events : [e]) {
      const p = world(ev)
      const previous = d.points[d.points.length - 1]
      if (d.tool === 'eraser') { erase(p, previous); d.points = [p]; continue }
      if (d.limited || Math.hypot(p.x - previous.x, p.y - previous.y) < 0.5 / camera().zoom) continue
      if (d.points.length >= CANVAS_INK_MAX_POINTS ||
        !canvasInkEnvelope([...d.points, p], d.width)) {
        d.limited = true
        showToast(`This mark reached its size limit. Release, then start another mark.`, 4500)
        continue
      }
      d.points.push(p)
    }
    if (d.tool !== 'eraser') setPreview({ points: [...d.points], width: d.width, color: d.color, opacity: d.opacity })
    return true
  }
  function down(e: PointerEvent, pan: boolean): boolean {
    if (!canvasDrawing() || readOnly() || pan || e.button !== 0 ||
      (e.target as Element).closest('[data-nodrag],button,input,select,textarea,[role="dialog"]')) return false
    e.preventDefault()
    if (draft) { cancel(); return true }
    const point = world(e)
    const tool = canvasInkTool()
    const width = canvasInkWidth() * (tool === 'highlighter' ? 3 : 1)
    if (!canvasInkEnvelope([point], width)) return true
    draft = {
      pointer: e.pointerId, board: boardId(), points: [point], tool,
      width, color: canvasInkColor(), opacity: tool === 'highlighter' ? 0.3 : 1, limited: false,
      candidates: tool === 'eraser' ? doc.cardsOn(boardId()).filter((c): c is Card<'ink'> => c.type === 'ink' && isCanvasInkSize(c.content)).map((card) => ({ card, strokes: [...doc.strokesOn(card.id)] })) : [],
    }
    if (tool === 'eraser') erase(point)
    else setPreview({ points: [point], width, color: draft.color, opacity: draft.opacity })
    return true
  }
  function up(e: PointerEvent): boolean {
    if (!draft || draft.pointer !== e.pointerId) return false
    if (e.type === 'pointercancel' || outside(e) || readOnly()) { cancel(); return true }
    move(e)
    const d = draft
    if (!d) return true
    const erased = canvasErasing()
    cancel()
    if (d.board !== boardId() || !doc.canWriteObject(doc.getBoard(d.board))) return true
    if (d.tool === 'eraser') {
      const now = Date.now()
      const patches: Record<string, { deletedAt: number }> = {}
      for (const { card, strokes } of d.candidates) {
        if (!doc.canWriteObject(doc.getCard(card.id))) continue
        for (const s of strokes) if (erased.has(s.id) && doc.canWriteObject(doc.get(s.id))) patches[s.id] = { deletedAt: now }
      }
      doc.update(patches)
      return true
    }
    const bounded = canvasInkEnvelope(d.points, d.width)
    if (!bounded) return true
    const { rect, points } = bounded
    const now = Date.now()
    const card: Card<'ink'> = {
      id: newId(), kind: 'card', type: 'ink', boardId: d.board, createdAt: now,
      ...rect, z: doc.maxZ(d.board) + 1, color: 'none', columnId: null,
      content: { width: rect.w, height: rect.h },
    }
    const stroke: Stroke = {
      id: newId(), kind: 'stroke', boardId: d.board, cardId: card.id, createdAt: now,
      tool: d.tool, width: d.width, color: d.color, opacity: d.opacity,
      points, order: now, bounds: inkBounds(points, d.width),
    }
    doc.commit([doc.createChange(card), doc.createChange(stroke)])
    return true
  }
  createEffect(on(boardId, () => { cancel(); endCanvasDrawing() }, { defer: true }))
  createEffect(on(camera, cancel, { defer: true }))
  createEffect(() => { if (!canvasDrawing() || readOnly()) cancel(); if (readOnly()) endCanvasDrawing() })
  const key = (e: KeyboardEvent) => {
    if (!canvasDrawing() || document.querySelector('[role="dialog"],[role="alertdialog"],.menu')) return
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation()
      if (!cancel()) endCanvasDrawing()
    }
    // Camera shortcuts animate on the next frame. Cancel on the request so
    // an immediate pointer-up cannot save a draft before that frame runs.
    if ((e.metaKey || e.ctrlKey) && ['z', 'y', '=', '+', '-', '_', '0', '1', 'k'].includes(e.key.toLowerCase())) cancel()
    if (e.code === 'Space' && !(e.target as Element)?.closest?.('input,select,textarea,[contenteditable="true"]')) {
      cancel()
      // The toolbar keeps native Space activation for keyboard users. Arm the
      // canvas pan in capture phase even when that toolbar stops bubbling keys.
      holdSpaceForPan()
    }
  }
  onMount(() => {
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    onCleanup(() => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
      cancel(); endCanvasDrawing()
    })
  })
  return { down, move, up, cancel, preview, active: () => !!draft }
}

export function CanvasInkTools() {
  return <Show when={canvasDrawing()}>
    <section class="canvas-ink-tools" data-nodrag data-testid="canvas-ink-tools" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (!e.metaKey && !e.ctrlKey && ['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) e.stopPropagation()
    }}>
      <div class="canvas-ink-mode"><strong>Drawing on the board</strong><span>Ink stays here when cards move.<Show when={!touch()}> Space to pan · Esc to cancel / finish</Show></span></div>
      <InkTools tool={canvasInkTool()} setTool={setCanvasInkTool} color={canvasInkColor()} setColor={setCanvasInkColor} width={canvasInkWidth()} setWidth={setCanvasInkWidth} onDone={endCanvasDrawing} />
      <div class="canvas-ink-correction"><button class="bar-btn" disabled={!doc.canUndo()} onClick={() => doc.undo()}>Undo</button><button class="bar-btn" disabled={!doc.canRedo()} onClick={() => doc.redo()}>Redo</button><span>Done lets you select and move finished marks.</span></div>
    </section>
  </Show>
}

export function CanvasInkPreview(props: { mark: ReturnType<ReturnType<typeof createCanvasInkController>['preview']> }) {
  return <Show when={props.mark}>{(m) => <svg class="canvas-ink-preview" aria-hidden="true"><path d={inkPath(m())} fill="none" stroke={m().color} stroke-width={m().width} stroke-opacity={m().opacity} stroke-linecap="round" stroke-linejoin="round" /></svg>}</Show>
}

/** Precise path hit testing at both DOM and overview zooms. */
export function hitCanvasInk(card: Card<'ink'>, point: Vec, radius: number): boolean {
  if (!isCanvasInkSize(card.content)) return false
  const rect = rectOf(card.id)
  if (!rect || Math.abs(point.x - rect.x - rect.w / 2) > rect.w / 2 + radius || Math.abs(point.y - rect.y - rect.h / 2) > rect.h / 2 + radius) return false
  const local = canvasInkLocal(point, rect, card.content.width)
  return doc.strokesOn(card.id).some((s) => hitInkStroke(s, local, radius * card.content.width / rect.w))
}
