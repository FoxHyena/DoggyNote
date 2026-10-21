import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { isPositionLocked } from '../state/position.ts'
import { StickerLayer, groupTurn, selectionRing, setGroupTurn, setManipulatingSticker, stickerAt, stickerRingAt } from './StickerLayer.tsx'
import { armedSticker, cancelStickerPlacement, placeSticker, setStickerGhost } from '../state/stickers.ts'
import { ringGesture, transformSticker, transformStickerGroup, stickerBounds, usableSticker, newId, type Sticker } from '@doggynote/core'
import { exporting } from '../state/export.ts'
import {
  GRID,
  canvasInkHeight,
  LOD_ZOOM,
  dotSpacing,
  edgeNear,
  snap,
  clampZoom,
  cullRect,
  editCamera,
  fitCamera,
  intersects,
  isDoubleTap,
  momentumStep,
  nearestSide,
  pinchCamera,
  readableCamera,
  ordersBetween,
  panBy,
  rectFromPoints,
  screenToWorld,
  union,
  viewRect,
  zoomAt,
  type Camera,
  type Card,
  type Id,
  type Obj,
  type Rect,
  type Side,
  type Tap,
  type Vec,
} from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import {
  beginEdit,
  boardId,
  camera,
  clearSelection,
  connectMode,
  editingId,
  endEdit,
  loadCamera,
  openBoard,
  saveCamera,
  select,
  selectMore,
  selection,
  setCamera,
  setConnectMode,
  setNearHandle,
  setSelection,
  setTrashOpen,
  setViewport,
  trashOpen,
  viewport,
} from '../state/ui.ts'
import { columnCollapsed, connectionEndpoint, hiddenByColumn } from '../state/columns.ts'
import { columnChildren, connect, createCard } from '../state/actions.ts'
import { CardView } from './CardView.tsx'
import { LodLayer } from './LodLayer.tsx'
import { Connections } from './Connections.tsx'
import { cardEl, cardHeight, rectOf, setMeasuring } from './layout.ts'
import { setDropTarget, dropTarget, connectPreview, setConnectPreview, draggingIds, setDraggingIds, resizingId, setResizingId } from './dnd.ts'
import { snapTick, snapToGrid } from '../state/grid.ts'
import { handleCanvasDrop, handleCanvasPaste } from './paste.ts'
import { isClipProxy } from '../state/clipboard.ts'
import { BoardIconSvg } from '../ui/icons.tsx'
import { setToyboxOpen, toyboxOpen } from '../ui/ToyboxPanel.tsx'
import { setThreadCardId, threadCardId } from '../state/comments.ts'
import { haptic, phone, touch } from '../state/device.ts'
import { resetPageScroll, visible } from '../state/viewport.ts'
import { showToast } from '../state/toast.ts'
import { canvasDrawing } from '../state/canvasDrawing.ts'
import { CanvasInkPreview, CanvasInkTools, createCanvasInkController, hitCanvasInk } from '../drawing/CanvasInk.tsx'

type Gesture =
  | { kind: 'sticker'; original: Sticker; action: 'move' | 'transform'; start: Vec; client: Vec; canDrag: boolean; moved: boolean; snap: Record<Id, Partial<Obj>> }
  | { kind: 'sticker-place'; start: Vec; moved: boolean }
  | { kind: 'sticker-group'; originals: Sticker[]; pivot: Vec; start: Vec; client: Vec; turn: number; moved: boolean; snap: Record<Id, Partial<Obj>> }
  | { kind: 'pan'; last: Vec; start: Vec; target: HTMLElement; samples?: Tap[] }
  | { kind: 'marquee'; start: Vec; base: Set<Id> }
  | { kind: 'press'; id: Id; start: Vec; shift: boolean; target: HTMLElement; client: Vec }
  | { kind: 'drag'; ids: Id[]; primary: Id; startWorld: Vec; origins: Map<Id, Vec>; snap: Record<Id, Partial<Obj>>; lastGrid?: string }
  | { kind: 'resize'; id: Id; startX: number; startY: number; w0: number; h0: number; snap: Record<Id, Partial<Obj>>; lastGrid?: number }
  | { kind: 'connect'; from: Id; fromSide: Side }
  // Touch: a finger is down but hasn't decided yet (tap, pan, drag or long-press).
  | { kind: 'tpress'; id: Id | null; start: Vec; last: Vec; target: HTMLElement; pointerId: number; nodrag: boolean; timer: ReturnType<typeof setTimeout> }
  | { kind: 'pinch'; ids: [number, number]; startCam: Camera; a0: Vec; b0: Vec }

const DRAG_THRESHOLD = 4
/** Fingers wobble: a touch has to travel further before it counts as a drag. */
const TOUCH_SLOP = 10
const LONG_PRESS_MS = 350
/** Screen px around a checkbox that still toggles it on touch. */
const CHECK_REACH = 24
/** Smallest zoom a phone opens a board at: below this, notes stop being readable. */
const PHONE_MIN_ZOOM = 0.8
/** Height of the formatting dock that sits on the keyboard while editing (EditDock). */
const EDIT_DOCK = 56

type Client = { clientX: number; clientY: number; altKey?: boolean }

export function Canvas(props: { readOnly: boolean }) {
  let vp!: HTMLDivElement
  const [marquee, setMarquee] = createSignal<Rect | null>(null)
  const [spaceHeld, setSpaceHeld] = createSignal(false)
  const [panning, setPanning] = createSignal(false)
  let gesture: Gesture | null = null
  let lastPress: { id: Id; board: Id; at: number } | null = null
  const ink = createCanvasInkController(() => props.readOnly, () => setSpaceHeld(true))
  createEffect(on(canvasDrawing, (active) => { if (active) vp?.focus({ preventScroll: true }) }))

  // An export needs every card in full, whatever the zoom.
  const lod = createMemo(() => camera().zoom < LOD_ZOOM && !exporting())
  const [snapping, setSnapping] = createSignal(false)

  // Background dots: two CSS variables per camera change, no DOM.
  const dots = () => {
    const c = camera()
    const step = dotSpacing(c.zoom)
    const ox = (-c.x * c.zoom) % step
    const oy = (-c.y * c.zoom) % step
    return {
      '--dot-step': `${step}px`,
      '--dot-x': `${ox - step / 2}px`,
      '--dot-y': `${oy - step / 2}px`,
      // Fade out as the overview takes over.
      '--dot-alpha': String(Math.min(1, Math.max(0, (c.zoom - 0.12) / 0.2))),
    }
  }

  // Promote the world to its own GPU layer only while the camera moves. A
  // permanent will-change pins the raster at the zoom it was created at, so a
  // zoomed-out board would composite a texture many times too large.
  const [moving, setMoving] = createSignal(false)
  let movingTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(
    on(
      camera,
      () => {
        setMoving(true)
        clearTimeout(movingTimer)
        movingTimer = setTimeout(() => setMoving(false), 160)
      },
      { defer: true },
    ),
  )
  createEffect(() => setMeasuring(!lod()))

  createEffect(() => {
    const hidden = [...selection()].filter(hiddenByColumn)
    if (hidden.length) {
      const parents = hidden.map((id) => doc.getCard(id)!.columnId!)
      select(new Set([...selection()].filter((id) => !hidden.includes(id)).concat(parents)))
      // Undoing a search reveal (or a remote collapse) must not strand the
      // selection below the now-hidden stack. Keep its header in context.
      if (selection().size === 1) {
        const parent = parents[0], board = boardId()
        requestAnimationFrame(() => {
          if (boardId() !== board || !selection().has(parent) || !columnCollapsed(doc.getCard(parent))) return
          const r = rectOf(parent), v = viewport(), cam = camera()
          if (!r) return
          const focus = () => requestAnimationFrame(() => cardEl(parent)?.querySelector<HTMLButtonElement>('.column-toggle')?.focus({ preventScroll: true }))
          if (!intersects(r, viewRect(cam, v.width, v.height))) {
            animateCamera({ x: r.x + r.w / 2 - v.width / cam.zoom / 2, y: r.y + r.h / 2 - v.height / cam.zoom / 2, zoom: cam.zoom }, 180, focus)
          } else focus()
        })
      }
    }
    const hiddenConnections = [...selection()].filter((id) => {
      const conn = doc.get(id)
      return conn?.kind === 'connection' && connectionEndpoint(conn.from) === connectionEndpoint(conn.to)
    })
    if (hiddenConnections.length) select([...selection()].filter((id) => !hiddenConnections.includes(id)))
    const editing = editingId()
    if (editing && hiddenByColumn(editing)) endEdit()
    const connecting = connectMode()?.from
    if (connecting && hiddenByColumn(connecting)) setConnectMode(null)
    const target = dropTarget()
    if (target && columnCollapsed(doc.getCard(target.columnId))) setDropTarget(null)
    const g = gesture
    if (g && (('id' in g && g.id && hiddenByColumn(g.id)) || (g.kind === 'connect' && hiddenByColumn(g.from)))) cancelGesture()
  })

  // ---- culling ---------------------------------------------------------------
  const cull = createMemo(
    () => {
      const c = camera()
      const v = viewport()
      // Margin + coarse snapping: panning re-culls only every few hundred
      // screen pixels, so cards aren't mounted/unmounted every frame. Kept
      // modest: every mounted card costs DOM and decoded-image memory.
      const step = 2 ** Math.round(Math.log2(256 / c.zoom))
      return cullRect(viewRect(c, v.width, v.height), 160 / c.zoom, step)
    },
    undefined,
    { equals: (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h },
  )

  const visible = createMemo(() => {
    if (exporting()) return doc.cardsOn(boardId()).filter((c) => !c.columnId)
    const r = cull()
    const active = doc.getCard(editingId())
    const editingRoot = active?.columnId ?? active?.id
    return doc.cardsOn(boardId()).filter((c) => !c.columnId && (c.id === editingRoot || intersects(r, { x: c.x, y: c.y, w: c.w, h: cardHeight(c) })))
  })

  const measure = () => {
    const r = vp.getBoundingClientRect()
    setViewport({ width: r.width, height: r.height, left: r.left, top: r.top })
  }

  // ---- camera per board ------------------------------------------------------
  createEffect(
    on(boardId, (id) => {
      const saved = loadCamera(id)
      if (saved) return setCamera(saved)
      // Effects can run before the ResizeObserver's first callback; fit needs the real size.
      measure()
      const v = viewport()
      const rects = doc.cardsOn(id).filter((c) => !c.columnId).map((c) => ({ x: c.x, y: c.y, w: c.w, h: cardHeight(c) }))
      rects.push(...doc.stickersOn(id).map(stickerBounds))
      const b = union(rects)
      if (!b) return setCamera({ x: -v.width / 2, y: -v.height / 3, zoom: 1 })
      // A phone screen would shrink a whole board to dots: start readable, at its top-left.
      setCamera(phone() ? readableCamera(b, v.width, v.height, PHONE_MIN_ZOOM) : fitCamera(b, v.width, v.height))
    }),
  )
  createEffect(
    on(boardId, () => {
      stopMomentum(); cancelGesture(); cancelStickerPlacement()
      // A thread belongs to a card on the board you left.
      setThreadCardId(null)
    }, { defer: true }),
  )

  // ---- editing on touch --------------------------------------------------------
  // Editing on a phone glides the card to a readable size near the top, keeps
  // the caret above the keyboard, and glides back afterwards.
  let editReturn: Camera | null = null
  createEffect(
    on(
      editingId,
      (id, prev) => {
        if (id && focusEdits() && doc.getCard(id)?.type !== 'image' && doc.getCard(id)?.type !== 'swatch') {
          if (!prev) editReturn = camera()
          movedWhileEditing = false
          const r = rectOf(id)
          if (r) animateCamera(editCamera(r, editRoom(), camera()), 260, () => requestAnimationFrame(revealCaret))
        } else if (!id && prev) {
          if (editReturn && !movedWhileEditing) animateCamera(editReturn, 260)
          editReturn = null
          resetPageScroll()
        }
      },
      { defer: true },
    ),
  )
  createEffect(() => {
    if (!editingId() || doc.getCard(editingId())?.type === 'image' || !focusEdits()) return
    visible()
    const onSelection = () => requestAnimationFrame(revealCaret)
    document.addEventListener('selectionchange', onSelection)
    onCleanup(() => document.removeEventListener('selectionchange', onSelection))
    requestAnimationFrame(revealCaret)
  })
  // A proposal preview frames its changes; that camera isn't the board's own.
  createEffect(() => { if (!doc.previewing()) saveCamera(boardId(), camera()) })

  // ---- helpers -----------------------------------------------------------------
  const local = (e: { clientX: number; clientY: number }): Vec => {
    const r = vp.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toWorld = (e: { clientX: number; clientY: number }) => screenToWorld(camera(), local(e))

  const domCardAt = (el: Element | null): Id | null => (el?.closest('[data-card-id]') as HTMLElement | null)?.dataset.cardId ?? null

  /** Topmost card under a world point. Zoomed out, cards are pixels on a canvas, so hit-test geometry. */
  function cardAtWorld(p: Vec): Id | null {
    let best: Card | null = null
    for (const c of doc.cardsOn(boardId())) {
      if (c.columnId) continue
      const r = { x: c.x, y: c.y, w: c.w, h: cardHeight(c) }
      // Ink's path test already includes its screen-sized picking tolerance.
      // A second strict envelope test would discard nearby endpoint hits,
      // especially when the safety inset is less than one screen pixel.
      const hit = c.type === 'ink' ? hitCanvasInk(c as Card<'ink'>, p, 5 / camera().zoom)
        : p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
      if (hit && (!best || (c.z ?? 0) > (best.z ?? 0))) best = c
    }
    if (best?.type === 'column' && !columnCollapsed(best)) {
      // A card inside the column, if the point is on one.
      for (const k of columnChildren(best.id)) {
        const r = rectOf(k.id)
        if (r && p.y >= r.y && p.y <= r.y + r.h) return k.id
      }
    }
    return best?.id ?? null
  }

  const cardIdAt = (el: Element | null, e?: { clientX: number; clientY: number }): Id | null => {
    const dom = domCardAt(el)
    if (!e) return dom
    const geometric = cardAtWorld(toWorld(e))
    // Selected ink's resize envelope remains draggable; other ink only hits its actual paths.
    if (dom && doc.getCard(dom)?.type === 'ink' && selection().has(dom)) return dom
    if (lod()) return geometric
    return geometric && doc.getCard(geometric)?.type === 'ink' ? geometric : dom
  }

  function columnAt(p: Vec, exclude: Set<Id>): Card | null {
    for (const c of doc.cardsOn(boardId())) {
      if (c.type !== 'column' || columnCollapsed(c) || c.columnId || exclude.has(c.id) || isPositionLocked(c.id)) continue
      const r = rectOf(c.id)
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h + 40) return c
    }
    return null
  }

  /** Index in the column's children where a drop at world y lands. */
  function insertIndex(columnId: Id, y: number, exclude: Set<Id>): number {
    const kids = columnChildren(columnId).filter((k) => !exclude.has(k.id))
    for (let i = 0; i < kids.length; i++) {
      const r = rectOf(kids[i].id)
      if (r && y < r.y + r.h / 2) return i
    }
    return kids.length
  }

  // ---- pointer -------------------------------------------------------------------
  // Mouse and pen: one gesture at a time, as on desktop. Touch has its own path
  // below (pan by default, pinch with two fingers, long-press to lift).
  let lastPointerType = 'mouse'

  function startStickerGesture(e: PointerEvent): boolean {
    if (props.readOnly || e.button !== 0 || spaceHeld() || connectMode()) return false
    if (armedSticker()) {
      startGesture(e, { kind: 'sticker-place', start: { x: e.clientX, y: e.clientY }, moved: false })
      setStickerGhost({ sticker: armedSticker()!, at: { x: e.clientX, y: e.clientY }, touch: e.pointerType === 'touch' })
      return true
    }
    const handle = (e.target as Element).closest<HTMLElement>('[data-sticker-handle]')
    const ring = handle ? selectionRing() ?? undefined : stickerRingAt(toWorld(e), e.pointerType === 'touch')
    if (ring && !ring.single) {
      // One ring around several stickers turns and scales them together about its center.
      const originals = ring.ids.map((id) => JSON.parse(JSON.stringify(doc.get(id))) as Sticker).filter((s) => doc.canWriteObject(s))
      if (!originals.length) return false
      endEdit(); doc.markBusy(originals.map((s) => s.id))
      startGesture(e, { kind: 'sticker-group', originals, pivot: ring.center, start: toWorld(e), client: { x: e.clientX, y: e.clientY }, turn: groupTurn(), moved: false, snap: Object.fromEntries(originals.map((s) => [s.id, doc.snapshot(s.id, ['x', 'y', 'w', 'angle'])])) })
      e.preventDefault()
      return true
    }
    const hit = ring?.single ?? stickerAt(toWorld(e), e.pointerType === 'touch')
    if (!hit || !doc.canWriteObject(hit)) return false
    endEdit()
    // Shift-click adds or removes a sticker, like a card.
    if (!ring && e.pointerType !== 'touch' && e.shiftKey) { toggle(hit.id); e.preventDefault(); return true }
    // Grabbing one of several selected things moves them all, like cards.
    if (!ring && selection().has(hit.id) && selection().size > 1) {
      startGesture(e, { kind: 'press', id: hit.id, start: { x: e.clientX, y: e.clientY }, shift: false, target: e.target as HTMLElement, client: { x: e.clientX, y: e.clientY } })
      e.preventDefault()
      return true
    }
    const canDrag = e.pointerType !== 'touch' || selection().has(hit.id) || !!ring
    const original = JSON.parse(JSON.stringify(hit)) as Sticker
    doc.markBusy([hit.id])
    startGesture(e, { kind: 'sticker', original, action: ring ? 'transform' : 'move', start: toWorld(e), client: { x: e.clientX, y: e.clientY }, canDrag, moved: false, snap: { [hit.id]: doc.snapshot(hit.id, ['x', 'y', 'w', 'angle', 'z']) } })
    if (e.pointerType !== 'touch' || ring) select([hit.id])
    e.preventDefault()
    return true
  }

  function onPointerDown(e: PointerEvent) {
    lastPointerType = e.pointerType
    if (canvasDrawing()) {
      stopMomentum()
      cancelCameraAnimation()
      // Move focus off a tool button before Space+drag so releasing Space
      // after panning cannot also activate that button (for example Done).
      if (spaceHeld() && !(e.target as Element).closest('[data-nodrag]')) vp.focus({ preventScroll: true })
      if (ink.down(e, spaceHeld() || e.button === 1)) { capture(e.pointerId); return }
    }
    if (e.pointerType === 'touch') return touchDown(e)
    if (e.button === 2) return
    if (startStickerGesture(e)) return
    const target = e.target as HTMLElement
    lastPress = null
    const editing = editingId()

    if (target.closest('[data-nodrag]')) return
    if (e.button === 1 || spaceHeld() || props.readOnly) {
      e.preventDefault()
      const p = { x: e.clientX, y: e.clientY }
      return startGesture(e, { kind: 'pan', last: p, start: p, target })
    }
    if (insideEditor(e, editing)) return
    if (startHandleGesture(e, target)) return
    const id = cardIdAt(target, e)
    if (id) {
      if (connectTap(id)) return
      return startGesture(e, { kind: 'press', id, start: { x: e.clientX, y: e.clientY }, shift: e.shiftKey, target, client: { x: e.clientX, y: e.clientY } })
    }
    // Background.
    endEdit()
    setConnectMode(null)
    if (!e.shiftKey) clearSelection()
    const start = toWorld(e)
    startGesture(e, { kind: 'marquee', start, base: new Set(e.shiftKey ? selection() : []) })
  }

  /**
   * Is this press inside the card being edited (not on its handles)? Uses the
   * event path: an editor widget may re-render, detaching the target, before
   * the event reaches us.
   */
  function insideEditor(e: PointerEvent, editing: Id | null): boolean {
    const el = editing ? cardEl(editing) : null
    if (!el) return false
    const path = e.composedPath()
    return path.includes(el) && !path.some((n) => n instanceof HTMLElement && (n.hasAttribute('data-resize') || n.hasAttribute('data-connect-handle')))
  }

  function closePanelSheets(): boolean {
    if (!toyboxOpen() && !trashOpen() && !threadCardId()) return false
    setToyboxOpen(false)
    setTrashOpen(false)
    setThreadCardId(null)
    return true
  }

  function insideOwnCard(e: PointerEvent, target: HTMLElement): boolean {
    if (!target.closest('[data-connect-handle],[data-resize]')) return false
    const el = target.closest<HTMLElement>('[data-card-id]')
    const r = el?.getBoundingClientRect()
    return !!r && e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom
  }

  /** Resize and connect handles, and connection lines: the same for every pointer. */
  function startHandleGesture(e: PointerEvent, target: HTMLElement): boolean {
    if (target.closest('[data-resize]')) {
      const id = cardIdAt(target)!
      const c = doc.getCard(id)!
      if (isPositionLocked(id)) return true
      doc.markBusy([id])
      startGesture(e, { kind: 'resize', id, startX: e.clientX, startY: e.clientY, w0: c.w, h0: c.h, snap: { [id]: doc.snapshot(id, c.type === 'sketch' || c.type === 'ink' ? ['w', 'h'] : ['w']) } })
      return true
    }
    const handle = target.closest('[data-connect-handle]') as HTMLElement | null
    if (handle) {
      const from = cardIdAt(target)!
      const fromSide = (handle.dataset.connectHandle || 'right') as Side
      endEdit()
      setConnectPreview({ from, fromSide, to: toWorld(e), target: null })
      startGesture(e, { kind: 'connect', from, fromSide })
      return true
    }
    const connId = (target.closest('[data-connection-id]') as HTMLElement | null)?.dataset.connectionId
    if (connId) {
      endEdit()
      if (e.shiftKey || selectMore()) toggle(connId)
      else select([connId])
      return true
    }
    return false
  }

  /** Line tool: the first card tapped is the start, the second the end. */
  function connectTap(id: Id): boolean {
    const cm = connectMode()
    if (!cm) return false
    if (!cm.from) setConnectMode({ from: id })
    else {
      if (cm.from !== id) {
        const conn = connect(cm.from, id)
        if (conn) haptic('drop')
      }
      setConnectMode(null)
    }
    return true
  }

  function capture(pointerId: number) {
    try {
      vp.setPointerCapture(pointerId)
    } catch {
      // The pointer is already gone (or synthetic); events still bubble here.
    }
  }

  function startGesture(e: PointerEvent, g: Gesture) {
    gesture = g
    if (g.kind === 'pan') setPanning(true)
    capture(e.pointerId)
  }

  function toggle(id: Id) {
    const s = new Set(selection())
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelection(s)
  }

  function beginDrag(g: Extract<Gesture, { kind: 'press' }>, e: Client) {
    endEdit()
    if (!selection().has(g.id)) {
      if (g.shift) toggle(g.id)
      else select([g.id])
    }
    const candidates = [...selection()].filter((id) => doc.getCard(id) && !hiddenByColumn(id))
    if (isPositionLocked(g.id)) {
      showToast('Position locked. Select the card and choose Unlock position.')
      gesture = null
      return
    }
    const selectedColumns = new Set(candidates.filter((id) => doc.getCard(id)?.type === 'column'))
    const cardIds = candidates.filter((id) => !isPositionLocked(id) && !selectedColumns.has(doc.getCard(id)?.columnId ?? ''))
    if (cardIds.length < candidates.length) showToast('Locked positions stay in place. Columns move with their members.')
    const b = boardId()
    // Selected stickers come along, lifted above the others in their own stacking order.
    const stickers = doc.stickersOn(b).filter((s) => selection().has(s.id) && doc.canWriteObject(s)).sort((p, q) => p.z - q.z)
    const ids = [...cardIds, ...stickers.map((s) => s.id)]
    let z = doc.maxZ(b), top = Math.max(0, ...doc.stickersOn(b).map((s) => s.z))
    const snap: Record<Id, Partial<Obj>> = {}
    const origins = new Map<Id, Vec>()
    for (const s of stickers) {
      snap[s.id] = doc.snapshot(s.id, ['x', 'y', 'z'])
      origins.set(s.id, { x: s.x, y: s.y })
      doc.transient(s.id, { z: ++top })
    }
    for (const id of cardIds) {
      const c = doc.getCard(id)!
      snap[id] = doc.snapshot(id, ['x', 'y', 'z', 'columnId', 'order'])
      const r = rectOf(id) ?? { x: c.x, y: c.y, w: c.w, h: c.h }
      origins.set(id, { x: r.x, y: r.y })
      // Lift out of a column and onto the top of the stack.
      doc.transient(id, { x: Math.round(r.x), y: Math.round(r.y), z: ++z, columnId: null } as Partial<Card>)
    }
    setDraggingIds(new Set(ids))
    doc.markBusy(ids)
    gesture = { kind: 'drag', ids, primary: selectedColumns.has(doc.getCard(g.id)?.columnId ?? '') ? doc.getCard(g.id)!.columnId! : g.id, startWorld: toWorld({ clientX: g.client.x, clientY: g.client.y }), origins, snap }
    moveGesture(e)
  }

  function onPointerMove(e: PointerEvent) {
    if (ink.move(e)) return
    if (e.pointerType === 'touch') return touchMove(e)
    lastPointer = { clientX: e.clientX, clientY: e.clientY }
    moveGesture(e)
    trackNearHandle(e)
  }

  // ---- connector handles (mouse) ---------------------------------------------
  // A handle shows only while the pointer is near its edge: an edge of the card
  // under the pointer, else the closest edge just outside a card. Never mid-card,
  // and never on the card being edited. Checked once a frame.
  type Hover = { clientX: number; clientY: number; target: Element | null }
  let nearFrame = 0
  let nearAt: Hover | null = null
  function trackNearHandle(e: PointerEvent) {
    nearAt = { clientX: e.clientX, clientY: e.clientY, target: e.target as Element | null }
    if (nearFrame) return
    nearFrame = requestAnimationFrame(() => {
      nearFrame = 0
      if (nearAt) setNearHandle(nearHandleAt(nearAt))
    })
  }
  function nearHandleAt(e: Hover): string {
    if (gesture || lod()) return ''
    const p = toWorld(e)
    const zoom = camera().zoom
    const sideOf = (id: Id) => {
      const r = id === editingId() ? null : rectOf(id)
      return r && edgeNear(r, p, 12 / zoom, 24 / zoom)
    }
    const under = domCardAt(e.target)
    if (under) {
      const side = sideOf(under)
      return side ? `${under}:${side}` : ''
    }
    let best = ''
    let bestD = Infinity
    for (const c of doc.cardsOn(boardId())) {
      if (c.columnId) continue
      const side = sideOf(c.id)
      if (!side) continue
      const r = rectOf(c.id)!
      const d = Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h))
      if (d < bestD) {
        best = `${c.id}:${side}`
        bestD = d
      }
    }
    return best
  }

  function moveGesture(e: Client) {
    const g = gesture
    if (!g) return
    switch (g.kind) {
      case 'sticker-place': {
        if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > 10) g.moved = true
        if (armedSticker()) setStickerGhost({ sticker: armedSticker()!, at: { x: e.clientX, y: e.clientY }, touch: lastPointerType === 'touch' })
        break
      }
      case 'sticker': {
        const s = g.original, delta = Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y)
        if (delta < (lastPointerType === 'touch' ? 10 : 4) && !g.moved) break
        if (!g.canDrag) {
          doc.unmarkBusy([s.id])
          gesture = { kind: 'pan', last: g.client, start: g.client, target: vp, samples: [] }
          setPanning(true); moveGesture(e); break
        }
        if (!g.moved && g.action === 'move') {
          // Dragging a sticker lifts it to the front; the move's undo step restores its place.
          const others = doc.stickersOn(s.boardId).filter((o) => o.id !== s.id), top = Math.max(0, ...others.map((o) => o.z))
          if (others.length && s.z <= top) doc.transient(s.id, { z: top + 1 })
        }
        g.moved = true; select([s.id]); setManipulatingSticker(s.id)
        const point = toWorld(e)
        if (g.action === 'move') doc.transient(s.id, { x: Math.max(-1e6, Math.min(1e6, s.x + point.x - g.start.x)), y: Math.max(-1e6, Math.min(1e6, s.y + point.y - g.start.y)) })
        else doc.transient(s.id, transformSticker(s, g.start, point))
        break
      }
      case 'sticker-group': {
        if (!g.moved && Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < (lastPointerType === 'touch' ? 10 : 4)) break
        g.moved = true; setManipulatingSticker('group')
        const { scale, turn } = ringGesture(g.pivot, g.start, toWorld(e)), next = transformStickerGroup(g.originals, g.pivot, scale, turn)
        for (const s of g.originals) doc.transient(s.id, next[s.id])
        setGroupTurn(g.turn + turn)
        break
      }
      case 'pan': {
        setCamera(panBy(camera(), e.clientX - g.last.x, e.clientY - g.last.y))
        g.last = { x: e.clientX, y: e.clientY }
        if (g.samples) {
          g.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() })
          if (g.samples.length > 8) g.samples.shift()
        }
        break
      }
      case 'marquee': {
        const r = rectFromPoints(g.start, toWorld(e))
        setMarquee(r)
        const ids = new Set(g.base)
        for (const c of doc.cardsOn(boardId())) {
          if (c.columnId) continue
          if (intersects(r, { x: c.x, y: c.y, w: c.w, h: cardHeight(c) })) ids.add(c.id)
        }
        for (const s of doc.stickersOn(boardId())) if (intersects(r, stickerBounds(s))) ids.add(s.id)
        setSelection(ids)
        break
      }
      case 'press': {
        if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > DRAG_THRESHOLD) beginDrag(g, e)
        break
      }
      case 'drag': {
        const w = toWorld(e)
        let dx = w.x - g.startWorld.x
        let dy = w.y - g.startWorld.y
        // Snap the grabbed card's corner; everything else selected moves by the
        // same snapped delta, so the group keeps its shape. ⌥ bypasses.
        // Snapping lines up the grabbed card; a grabbed sticker moves freely, as it does alone.
        const snapping = snapToGrid() && !e.altKey && !!doc.getCard(g.primary)
        setSnapping(snapping)
        if (snapping) {
          const o = g.origins.get(g.primary)!
          const sx = snap(o.x + dx)
          const sy = snap(o.y + dy)
          dx = sx - o.x
          dy = sy - o.y
          const key = `${sx},${sy}`
          if (g.lastGrid !== undefined && g.lastGrid !== key) snapTick()
          g.lastGrid = key
        }
        for (const id of g.ids) {
          const o = g.origins.get(id)!
          doc.transient(id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) } as Partial<Card>)
        }
        const set = new Set(g.ids)
        // Columns hold cards: a drag that carries a column, board ink or stickers never drops into one.
        const hasColumn = g.ids.some((id) => ['column', 'ink'].includes(doc.getCard(id)?.type ?? '') || !doc.getCard(id))
        const col = hasColumn ? null : columnAt(w, set)
        setDropTarget(col ? { columnId: col.id, index: insertIndex(col.id, w.y, set) } : null)
        break
      }
      case 'resize': {
        const c = doc.getCard(g.id)!
        const min = c.type === 'ink' ? Math.min(4, g.w0) : c.type === 'image' || c.type === 'sketch' ? 80 : 160
        let w = Math.max(min, Math.round(g.w0 + (e.clientX - g.startX) / camera().zoom))
        // Snapping puts the right edge on a grid line.
        const snapping = snapToGrid() && !e.altKey
        setSnapping(snapping)
        if (snapping) {
          w = Math.max(snap(c.x + min, GRID) - c.x, snap(c.x + w) - c.x)
          if (g.lastGrid !== undefined && g.lastGrid !== w) snapTick()
          g.lastGrid = w
        }
        if (c.type === 'sketch') w = Math.min(10_000, w)
        setResizingId(g.id)
        if (c.type === 'ink') {
          const logical = (c as Card<'ink'>).content
          // Thin vertical marks must not grow into enormous exports on a small horizontal drag.
          w = Math.min(w, 8192 * logical.width / Math.max(logical.width, logical.height))
          doc.transient(g.id, { w, h: canvasInkHeight(logical, w) } as Partial<Card>)
        } else doc.transient(g.id, c.type === 'sketch' ? { w, h: Math.min(10_000, Math.max(80, Math.round(g.h0 + (e.clientY - g.startY) / camera().zoom))) } : { w })
        break
      }
      case 'connect': {
        setConnectPreview({ from: g.from, fromSide: g.fromSide, to: toWorld(e), target: snapTarget(e, g.from) })
        break
      }
    }
  }

  /** The card under the pointer (other than `from`) and its side nearest the pointer. */
  function snapTarget(e: { clientX: number; clientY: number }, from: Id): { id: Id; side: Side } | null {
    const under = document.elementFromPoint(e.clientX, e.clientY)
    const id = cardIdAt(under, e)
    if (!id || id === from) return null
    const r = rectOf(id)
    return r ? { id, side: nearestSide(r, toWorld(e)) } : null
  }

  function onPointerUp(e: PointerEvent) {
    if (ink.up(e)) return
    if (e.pointerType === 'touch') return touchUp(e)
    if (e.type === 'pointercancel') { cancelGesture(); return }
    const g = gesture
    gesture = null
    setPanning(false)
    setSnapping(false)
    setResizingId(null)
    if (g) endGesture(g, e)
  }

  function endGesture(g: Gesture, e: PointerEvent) {
    switch (g.kind) {
      case 'sticker-place': {
        if (e.type !== 'pointercancel' && !g.moved && armedSticker()) placeSticker(armedSticker()!, toWorld(e))
        else setStickerGhost(null)
        break
      }
      case 'sticker-group': {
        const ids = g.originals.map((s) => s.id)
        if (e.type === 'pointercancel') { for (const id of ids) doc.transient(id, g.snap[id]); setGroupTurn(g.turn) }
        else doc.commitFrom(g.snap)
        setManipulatingSticker(null); doc.unmarkBusy(ids)
        break
      }
      case 'sticker': {
        const id = g.original.id
        if (e.type === 'pointercancel') doc.transient(id, g.snap[id])
        else { select([id]); doc.commitFrom(g.snap) }
        setManipulatingSticker(null); doc.unmarkBusy([id])
        break
      }
      case 'pan': {
        // In the viewer, a click (not a drag) on a board tile opens it.
        const moved = Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > DRAG_THRESHOLD
        const hit = lod() ? doc.getCard(cardAtWorld(toWorld(e))) : null
        const open =
          (g.target.closest('[data-open-board]') as HTMLElement | null)?.dataset.openBoard ??
          (hit?.type === 'board' ? (hit as Card<'board'>).content.boardId : undefined)
        if (!moved && open && props.readOnly) openBoard(open)
        break
      }
      case 'marquee':
        setMarquee(null)
        break
      case 'press': {
        const c = doc.getCard(g.id)
        // A click on one of several selected stickers picks it alone.
        if (!c) { if (e.type !== 'pointercancel' && doc.get(g.id)?.kind === 'sticker') select([g.id]); break }
        if (g.shift) {
          // Shift-clicking another card while typing: stop typing, and keep the
          // card you were in as part of the selection.
          const typing = editingId()
          if (typing && typing !== g.id) {
            endEdit()
            select([...new Set([...selection(), typing])])
          }
          toggle(g.id)
          break
        }
        // Remembered so a double-click knows which card it landed on: pointer capture
        // retargets the dblclick to the canvas itself.
        if (e.type !== 'pointercancel') lastPress = { id: g.id, board: boardId(), at: performance.now() }
        if (c.type === 'board') {
          endEdit()
          select([g.id])
          break
        }
        // The first click selects a card, so its toolbar is reachable; clicking the
        // selected card again (or double-clicking) edits it. For a column, that's its title.
        const again = selection().size === 1 && selection().has(g.id)
        const renames = c.type === 'column' && !!g.target.closest('[data-edit-title]') && again
        // Zoomed out, cards are shapes on a canvas: a click selects, it can't edit.
        if (!lod() && (((c.type === 'note' || c.type === 'todo' || c.type === 'swatch') && again) || renames)) {
          queueEditCaret(g.client)
          beginEdit(g.id)
        } else {
          select([g.id])
          if (c.type === 'swatch') cardEl(c.id)?.focus({ preventScroll: true })
        }
        break
      }
      case 'drag': {
        const drop = dropTarget()
        setDropTarget(null)
        setDraggingIds(new Set<Id>())
        if (drop) {
          const set = new Set(g.ids)
          const kids = columnChildren(drop.columnId).filter((k) => !set.has(k.id))
          const orders = ordersBetween(kids[drop.index - 1]?.order, kids[drop.index]?.order, g.ids.length)
          const sorted = [...g.ids].sort((a, b) => doc.getCard(a)!.y - doc.getCard(b)!.y)
          sorted.forEach((id, i) => doc.transient(id, { columnId: drop.columnId, order: orders[i] } as Partial<Card>))
          haptic('drop')
        }
        const moved = doc.commitFrom(g.snap)
        doc.unmarkBusy(g.ids)
        // On touch the Undo button hides behind the selection bar: offer it here.
        if (moved && e.pointerType === 'touch' && e.type !== 'pointercancel') showToast(drop ? 'Moved into the column' : 'Moved', 3000, { label: 'Undo', run: () => doc.undo() })
        break
      }
      case 'resize':
        doc.commitFrom(g.snap)
        doc.unmarkBusy([g.id])
        break
      case 'connect': {
        setConnectPreview(null)
        const t = snapTarget(e, g.from)
        if (t) {
          const id = connect(g.from, t.id, { fromSide: g.fromSide, toSide: t.side })
          if (id) select([id])
        }
        break
      }
    }
  }

  /** Abandon whatever is in progress and put cards back where they were (a second finger arrived). */
  function cancelGesture() {
    const g = gesture
    gesture = null
    setPanning(false)
    setSnapping(false)
    if (!g) return
    switch (g.kind) {
      case 'sticker-place': setStickerGhost(null); break
      case 'sticker':
        doc.transient(g.original.id, g.snap[g.original.id]); doc.unmarkBusy([g.original.id]); setManipulatingSticker(null); break
      case 'sticker-group':
        for (const s of g.originals) doc.transient(s.id, g.snap[s.id])
        doc.unmarkBusy(g.originals.map((s) => s.id)); setManipulatingSticker(null); setGroupTurn(g.turn); break
      case 'tpress':
        clearTimeout(g.timer)
        break
      case 'drag':
        for (const id of g.ids) doc.transient(id, g.snap[id])
        setDraggingIds(new Set<Id>())
        setDropTarget(null)
        doc.unmarkBusy(g.ids)
        break
      case 'resize':
        doc.transient(g.id, g.snap[g.id])
        setResizingId(null)
        doc.unmarkBusy([g.id])
        break
      case 'connect':
        setConnectPreview(null)
        break
      case 'marquee':
        setSelection(g.base)
        setMarquee(null)
        break
    }
  }

  // ---- touch ------------------------------------------------------------------------
  // One finger pans, even across cards, so browsing never moves anything by
  // accident. A selected card drags. Long-press lifts any card (or starts a
  // selection box on empty canvas). Two fingers pinch and pan. Tap selects;
  // tapping the selected card again edits or opens it.
  const fingers = new Map<number, Vec>()
  let lastTap: Tap | null = null
  // A paw print where the finger asked for something.
  const [paw, setPaw] = createSignal<{ x: number; y: number; n: number } | null>(null)
  let pawTimer: ReturnType<typeof setTimeout> | undefined
  function pawAt(client: Vec) {
    const p = local({ clientX: client.x, clientY: client.y })
    setPaw({ ...p, n: (paw()?.n ?? 0) + 1 })
    clearTimeout(pawTimer)
    pawTimer = setTimeout(() => setPaw(null), 560)
  }

  function touchDown(e: PointerEvent) {
    stopMomentum()
    cancelCameraAnimation()
    // On a phone a panel sheet covers most of the board: the first touch on
    // what's left of the board puts the sheet away, rather than acting behind it.
    if (phone() && !fingers.size && closePanelSheets()) {
      e.preventDefault()
      return
    }
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (fingers.size === 2) {
      cancelGesture()
      const [[ia, a], [ib, b]] = [...fingers]
      gesture = { kind: 'pinch', ids: [ia, ib], startCam: camera(), a0: local({ clientX: a.x, clientY: a.y }), b0: local({ clientX: b.x, clientY: b.y }) }
      movedWhileEditing = true
      capture(e.pointerId)
      return
    }
    if (fingers.size > 2) return
    if (startStickerGesture(e)) return
    const target = e.target as HTMLElement
    // The editor owns single touches inside the card being edited (caret, selection).
    if (insideEditor(e, editingId())) return
    const nodrag = !!target.closest('[data-nodrag]')
    // Ours from here: no compatibility mouse events (their mousedown would steal
    // focus from an editor this touch opens), no text selection or callout.
    // Links and checkboxes keep their click.
    if (!nodrag) e.preventDefault()
    // Browsers snap a fingertip to nearby handles. A touch inside the card's
    // own box is about the card (move it), not the handle on its edge.
    if (!props.readOnly && !insideOwnCard(e, target) && startHandleGesture(e, target)) return
    const id = cardIdAt(target, e)
    if (id && !props.readOnly && connectTap(id)) return
    const p = { x: e.clientX, y: e.clientY }
    gesture = { kind: 'tpress', id, start: p, last: p, target, pointerId: e.pointerId, nodrag, timer: setTimeout(longPress, LONG_PRESS_MS) }
    // Links and checkboxes keep their own click until the finger moves.
    if (!nodrag) capture(e.pointerId)
  }

  function longPress() {
    const g = gesture
    if (g?.kind !== 'tpress' || props.readOnly) return
    capture(g.pointerId)
    haptic('lift')
    pawAt(g.last)
    const at = { clientX: g.last.x, clientY: g.last.y }
    if (g.id) {
      beginDrag({ kind: 'press', id: g.id, start: g.start, shift: selectMore(), target: g.target, client: g.start }, at)
      return
    }
    endEdit()
    setConnectMode(null)
    const base = new Set(selectMore() ? selection() : [])
    setSelection(base)
    const start = toWorld(at)
    gesture = { kind: 'marquee', start, base }
    setMarquee({ x: start.x, y: start.y, w: 0, h: 0 })
  }

  function touchMove(e: PointerEvent) {
    if (!fingers.has(e.pointerId)) return
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture
    if (!g) return
    if (g.kind === 'pinch') {
      const a = fingers.get(g.ids[0])
      const b = fingers.get(g.ids[1])
      if (a && b) setCamera(pinchCamera(g.startCam, g.a0, g.b0, local({ clientX: a.x, clientY: a.y }), local({ clientX: b.x, clientY: b.y })))
      return
    }
    if (g.kind === 'tpress') {
      g.last = { x: e.clientX, y: e.clientY }
      if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) <= TOUCH_SLOP) return
      clearTimeout(g.timer)
      capture(g.pointerId)
      if (g.id && !props.readOnly && !selectMore() && selection().has(g.id) && editingId() !== g.id) {
        return beginDrag({ kind: 'press', id: g.id, start: g.start, shift: false, target: g.target, client: g.start }, e)
      }
      // Pan from where the finger went down, so the board stays under it.
      gesture = { kind: 'pan', last: g.start, start: g.start, target: g.target, samples: [] }
      movedWhileEditing = true
      setPanning(true)
    }
    moveGesture(e)
  }

  function touchUp(e: PointerEvent) {
    fingers.delete(e.pointerId)
    const g = gesture
    if (!g) return
    if (g.kind === 'pinch') {
      if (!g.ids.includes(e.pointerId)) return
      // One finger lifted: keep panning with the other, no jump.
      const rest = [...fingers.values()][0]
      gesture = rest ? { kind: 'pan', last: rest, start: rest, target: vp, samples: [] } : null
      setPanning(!!rest)
      return
    }
    if (fingers.size) return
    gesture = null
    setPanning(false)
    setSnapping(false)
    setResizingId(null)
    const cancelled = e.type === 'pointercancel'
    switch (g.kind) {
      case 'tpress':
        clearTimeout(g.timer)
        if (!cancelled) touchTap(g, e)
        break
      case 'pan':
        if (!cancelled && g.samples) flick(g.samples)
        break
      default:
        endGesture(g, e)
    }
  }

  function touchTap(g: Extract<Gesture, { kind: 'tpress' }>, e: PointerEvent) {
    const t = { x: e.clientX, y: e.clientY, t: performance.now() }
    const double = isDoubleTap(lastTap, t)
    lastTap = double ? null : t
    if (props.readOnly) {
      const c = g.id ? doc.getCard(g.id) : null
      if (c?.type === 'board') openBoard((c as Card<'board'>).content.boardId)
      return
    }
    // Links, checkboxes and buttons inside cards handle their own click.
    if (g.nodrag) return
    if (!g.id) {
      if (double && !editingId() && !connectMode()) {
        // Zoomed out there's no DOM to type into: come in first, inside the
        // touch, so the editor mounts and focuses while iOS still allows a keyboard.
        if (lod()) setCamera(zoomAt(camera(), local(e), 1))
        pawAt({ x: e.clientX, y: e.clientY })
        haptic('success')
        createCard('note', { at: toWorld(e) })
        return
      }
      endEdit()
      setConnectMode(null)
      clearSelection()
      return
    }
    const c = doc.getCard(g.id)
    if (!c) return
    if (selectMore()) {
      endEdit()
      toggle(g.id)
      return
    }
    // A fingertip is bigger than a checkbox: a tap near one ticks it.
    if (!lod() && editingId() !== g.id) {
      const box = checkboxNear(g.id, e)
      if (box) {
        box.click()
        // The browser's own click for this tap may snap to the same box and undo it.
        swallowNextClick()
        haptic('tick')
        return
      }
    }
    const again = selection().size === 1 && selection().has(g.id)
    if (!again) {
      endEdit()
      select([g.id])
      return
    }
    if (c.type === 'board') return openBoard((c as Card<'board'>).content.boardId)
    const isTitle = !!g.target.closest('[data-edit-title]')
    if (!lod() && (c.type === 'swatch' || c.type === 'note' || c.type === 'todo' || (c.type === 'column' && isTitle))) {
      // Synchronously, inside the touch: iOS only raises the keyboard for focus it can tie to a gesture.
      touchEdit(g.id, { x: e.clientX, y: e.clientY })
    }
  }

  function swallowNextClick() {
    const stop = (ev: Event) => {
      // Our own box.click() for a quick next tap is not the browser's echo of this one.
      if (!ev.isTrusted) return
      ev.preventDefault()
      ev.stopPropagation()
      off()
    }
    const off = () => {
      window.removeEventListener('click', stop, true)
      clearTimeout(timer)
    }
    window.addEventListener('click', stop, true)
    const timer = setTimeout(off, 500)
  }

  function checkboxNear(id: Id, e: Client): HTMLInputElement | null {
    const boxes = cardEl(id)?.querySelectorAll<HTMLInputElement>('input.todo-check:not(:disabled), input.task-check:not(:disabled)')
    // Only the gutter beside a box, on that item's first line: taps on the text or the
    // title select the card. Zoomed out the rows are too thin to guess, so hit the box.
    const reach = camera().zoom < 0.6 ? 4 : CHECK_REACH
    let best: HTMLInputElement | null = null
    let bestD = Infinity
    for (const b of boxes ?? []) {
      const r = b.getBoundingClientRect()
      const row = b.parentElement!.getBoundingClientRect()
      const bottom = r.bottom + Math.max(4, r.top - row.top)
      if (e.clientY < row.top || e.clientY > bottom || e.clientX < r.left - reach || e.clientX > r.right + 8) continue
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
      if (d <= bestD) {
        best = b
        bestD = d
      }
    }
    return best
  }

  function onDblClick(e: MouseEvent) {
    if (props.readOnly || canvasDrawing() || stickerAt(toWorld(e)) || armedSticker()) return
    // Touch double-taps are handled in touchTap; Chrome also sends a dblclick for them.
    if (lastPointerType === 'touch') return
    if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || spaceHeld() || connectMode() || editingId()) return
    const target = e.target as HTMLElement
    const pressed = lastPress
    if (pressed && pressed.board === boardId() && performance.now() - pressed.at < 500) {
      const card = doc.getCard(pressed.id)
      if (card?.type === 'board') {
        e.preventDefault()
        lastPress = null
        openBoard((card as Card<'board'>).content.boardId)
        return
      }
      // A sketch opens its drawing; an image types its caption right under it.
      if ((card?.type === 'sketch' || card?.type === 'image') && !lod() && doc.canWriteObject(card)) {
        e.preventDefault()
        lastPress = null
        beginEdit(card.id)
        return
      }
      // Any other card: the press already selected or began editing it. Never drop a new note on top.
      if (card) return
    }
    if (target.closest('[data-card-id],[data-connection-id]')) return
    if (lod() && cardAtWorld(toWorld(e))) return
    createCard('note', { at: toWorld(e) })
  }

  // ---- wheel + pinch -------------------------------------------------------------
  let wheelAcc = { dx: 0, dy: 0, zoom: 1, anchor: { x: 0, y: 0 } }
  let wheelFrame = 0
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    ink.cancel()
    stopMomentum()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vp.clientHeight : 1
    if (e.ctrlKey || e.metaKey) {
      wheelAcc.zoom *= Math.exp(-e.deltaY * unit * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002))
      wheelAcc.anchor = local(e)
    } else {
      wheelAcc.dx += (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit
      wheelAcc.dy += (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit
    }
    wheelFrame ||= requestAnimationFrame(() => {
      wheelFrame = 0
      let c = camera()
      if (wheelAcc.zoom !== 1) c = zoomAt(c, wheelAcc.anchor, c.zoom * wheelAcc.zoom)
      if (wheelAcc.dx || wheelAcc.dy) c = panBy(c, -wheelAcc.dx, -wheelAcc.dy)
      setCamera(c)
      wheelAcc = { dx: 0, dy: 0, zoom: 1, anchor: wheelAcc.anchor }
    })
  }

  // Safari/WebKit (and so Tauri) report trackpad pinch as gesture events. iOS
  // sends them for two-finger touches too; those are already a pointer pinch,
  // so only stop the page from zooming.
  let gestureZoom = 1
  const onGestureStart = (e: Event) => {
    e.preventDefault()
    ink.cancel()
    gestureZoom = camera().zoom
  }
  const onGestureChange = (e: Event) => {
    e.preventDefault()
    if (fingers.size) return
    const ge = e as Event & { scale: number; clientX: number; clientY: number }
    setCamera(zoomAt(camera(), local(ge), gestureZoom * ge.scale))
  }
  const onGestureEnd = (e: Event) => e.preventDefault()

  /** A pan released at speed keeps gliding. */
  function flick(samples: Tap[]) {
    const now = performance.now()
    const recent = samples.filter((s) => now - s.t < 100)
    if (recent.length < 2) return
    const a = recent[0]
    const b = recent[recent.length - 1]
    const dt = Math.max(1, b.t - a.t)
    const v = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
    if (Math.hypot(v.x, v.y) > 0.3) startMomentum(v)
  }

  // ---- keyboard: space-to-pan -------------------------------------------------------
  const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,[contenteditable="true"]')
  const onStickerEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || (!armedSticker() && gesture?.kind !== 'sticker' && gesture?.kind !== 'sticker-place')) return
    e.preventDefault(); e.stopImmediatePropagation(); cancelGesture(); cancelStickerPlacement()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (document.querySelector('[role="dialog"],[role="alertdialog"]') ||
      (e.target as Element)?.closest?.('.menu,.topbar,.toolbar,.canvas-controls,.canvas-ink-tools')) return
    if (e.key === 'Escape' && gesture && ['press', 'drag', 'resize', 'connect'].includes(gesture.kind)) {
      e.preventDefault()
      cancelGesture()
      return
    }
    if (e.code === 'Space' && !e.defaultPrevented && !typing(e.target) && !(e.target as Element | null)?.closest?.('button,a,select,[role="button"]') && !editingId()) {
      e.preventDefault()
      setSpaceHeld(true)
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') setSpaceHeld(false)
  }
  const onBlur = () => { setSpaceHeld(false); ink.cancel(); cancelGesture() }

  // ---- paste + drop -----------------------------------------------------------------
  const centerWorld = () => {
    const v = viewport()
    return screenToWorld(camera(), { x: v.width / 2, y: v.height / 2 })
  }
  const onCopy = (e: ClipboardEvent) => {
    if (props.readOnly || (typing(e.target) && !isClipProxy(e.target)) || editingId()) return
    const stickers = [...selection()].map(doc.get).filter(usableSticker)
    if (!stickers.length || stickers.length !== selection().size || !e.clipboardData) return
    e.clipboardData.setData('application/x-doggynote-stickers', JSON.stringify(stickers))
    e.clipboardData.setData('text/plain', stickers.map((s) => s.content.emoji).join(' '))
    e.preventDefault()
  }
  // Pastes land under the mouse when it's over the board, else in the middle.
  let lastPointer: { clientX: number; clientY: number } | null = null
  const onPaste = (e: ClipboardEvent) => {
    if (props.readOnly || (typing(e.target) && !isClipProxy(e.target)) || editingId()) return
    const data = e.clipboardData?.getData('application/x-doggynote-stickers')
    if (data) {
      e.preventDefault()
      try {
        if (data.length > 256_000) return
        const values: unknown = JSON.parse(data)
        if (!Array.isArray(values) || values.length > 100 || !values.every(usableSticker)) return
        const top = Math.max(0, ...doc.stickersOn(boardId()).map((s) => s.z))
        const copies: Sticker[] = values.map((s, i) => ({ ...s, id: newId(), boardId: boardId(), x: s.x + 20, y: s.y + 20, z: top + i + 1, purged: false, deletedAt: null, createdAt: Date.now() }))
        doc.commit(copies.map(doc.createChange)); select(copies.map((s) => s.id))
      } catch { showToast('This sticker copy could not be pasted. Try copying it again.') }
      return
    }
    const at = lastPointer ? toWorld(lastPointer) : centerWorld()
    const column = lastPointer ? columnAt(at, new Set()) : null
    if (handleCanvasPaste(e, at, column?.id)) e.preventDefault()
  }

  onCleanup(() => { cancelGesture(); cancelStickerPlacement() })
  onMount(() => {
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    vp.addEventListener('wheel', onWheel, { passive: false })
    vp.addEventListener('gesturestart', onGestureStart)
    vp.addEventListener('gesturechange', onGestureChange)
    vp.addEventListener('gestureend', onGestureEnd)
    window.addEventListener('keydown', onStickerEscape, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('paste', onPaste)
    document.addEventListener('copy', onCopy)
    onCleanup(() => {
      ro.disconnect()
      vp.removeEventListener('wheel', onWheel)
      vp.removeEventListener('gesturestart', onGestureStart)
      vp.removeEventListener('gesturechange', onGestureChange)
      vp.removeEventListener('gestureend', onGestureEnd)
      window.removeEventListener('keydown', onStickerEscape, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('copy', onCopy)
    })
  })

  const transform = () => {
    const c = camera()
    // 2D on purpose: in WebKit (the desktop app) a 3D transform pins the world
    // to a GPU layer rasterized once at 1×, so zooming in stretches a bitmap
    // and text goes soft. A 2D transform re-renders sharp once motion stops.
    return `translate(${-c.x * c.zoom}px, ${-c.y * c.zoom}px) scale(${c.zoom})`
  }

  const marqueeStyle = () => {
    const m = marquee()!
    const c = camera()
    return {
      left: `${(m.x - c.x) * c.zoom}px`,
      top: `${(m.y - c.y) * c.zoom}px`,
      width: `${m.w * c.zoom}px`,
      height: `${m.h * c.zoom}px`,
    }
  }

  return (
    <div
      ref={vp}
      class="viewport"
      data-testid="canvas"
      tabindex="0"
      role="region"
      aria-label="Board canvas"
      style={dots()}
      classList={{ panning: panning(), moving: moving(), snapping: snapping(), 'snap-on': snapToGrid(), connecting: !!connectPreview(), 'space-held': spaceHeld(), lod: lod(), 'connect-mode': !!connectMode(), readonly: props.readOnly, 'canvas-drawing': canvasDrawing() && !props.readOnly }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={(e) => { if (e.pointerType !== 'touch') { lastPointer = null; nearAt = null; setNearHandle('') } }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={() => ink.cancel()}
      onDblClick={onDblClick}
      onContextMenu={(e) => {
        // Long-press is ours on touch (lift a card), not the browser's menu.
        if (lastPointerType === 'touch') e.preventDefault()
      }}
      onDragOver={(e) => {
        if (!props.readOnly) e.preventDefault()
      }}
      onDrop={(e) => {
        if (props.readOnly) return
        e.preventDefault()
        handleCanvasDrop(e, toWorld(e))
      }}
    >
      <div class="world" data-testid="world" style={{ transform: transform() }}>
        <Show when={snapping()}>
          <GridGlow />
        </Show>
        <div class="card-layer">
        <Connections />
        <CanvasInkPreview mark={ink.preview()} />
        <Show when={!lod()}>
          <For each={visible()}>{(c) => <CardView card={c} lod={false} readOnly={props.readOnly} />}</For>
        </Show>
        </div>
        <StickerLayer readOnly={props.readOnly} />
      </div>
      <Show when={lod()}>
        <LodLayer />
      </Show>
      <Show when={!props.readOnly}><CanvasInkTools /></Show>
      <Show when={marquee()}>
        <div class="marquee" style={marqueeStyle()} />
      </Show>
      <Show when={paw()} keyed>
        {(p) => (
          <div class="paw-ripple" style={{ left: `${p.x}px`, top: `${p.y}px` }} aria-hidden="true">
            <BoardIconSvg icon="paw" size={30} />
          </div>
        )}
      </Show>
      <Show when={!doc.cardsOn(boardId()).length && !doc.stickersOn(boardId()).length}>
        <div class="empty">
          <p class="empty-title">{props.readOnly ? 'This board is empty' : `Nothing in this ${boardId() === 'home' ? COPY.home : 'board'} yet`}</p>
          <Show when={!props.readOnly}>
            <p class="empty-sub">{touch() ? (phone() ? COPY.emptyTouch : COPY.emptyTouchTablet) : 'Double-click anywhere to add a note, or drag something in from the left.'}</p>
            <Show when={touch()}>
              <p class="empty-sub">{COPY.emptyHintTouch}</p>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}

// ---- editing on touch ------------------------------------------------------------

let movedWhileEditing = false
/** Phones and short touch screens get the editing camera and keyboard handling. */
const focusEdits = () => touch() && (phone() || visible().height < 600)

/** The part of the canvas the keyboard and the edit dock leave visible, in canvas px. */
function editRoom() {
  const v = viewport()
  const vis = visible()
  const top = Math.max(0, vis.top - v.top)
  const bottom = Math.min(v.height, vis.top + vis.height - v.top) - EDIT_DOCK
  return { width: v.width, top, bottom }
}

/** Edit a card from touch. Zoomed out it isn't DOM yet, so jump in first (no animation) to mount the editor now. */
export function touchEdit(id: Id, caret?: Vec) {
  const r = rectOf(id)
  if (r && focusEdits() && camera().zoom < LOD_ZOOM) setCamera(editCamera(r, editRoom(), camera()))
  // Queue the caret first: the editor mounts (and reads it) inside beginEdit.
  if (caret) queueEditCaret(caret)
  beginEdit(id)
}

function caretRect(within: HTMLElement): DOMRect | null {
  const active = document.activeElement as HTMLElement | null
  if (active && within.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return active.getBoundingClientRect()
  const sel = document.getSelection()
  if (!sel?.rangeCount || !sel.focusNode || !within.contains(sel.focusNode)) return null
  const range = sel.getRangeAt(0).cloneRange()
  range.collapse(false)
  const rect = range.getClientRects()[0]
  if (rect) return rect
  const node = sel.focusNode.nodeType === Node.ELEMENT_NODE ? (sel.focusNode as Element) : sel.focusNode.parentElement
  return node?.getBoundingClientRect() ?? null
}

/** Pan just enough to keep the caret between the top of the screen and the keyboard. */
function revealCaret() {
  const id = editingId()
  const el = id ? cardEl(id) : null
  const caret = el ? caretRect(el) : null
  // The edit glide checks again when it lands.
  if (!caret || anim) return
  const v = viewport()
  const room = editRoom()
  const top = caret.top - v.top
  const bottom = caret.bottom - v.top
  const margin = 20
  let dy = 0
  if (bottom > room.bottom - margin) dy = room.bottom - margin - bottom
  else if (top < room.top + margin) dy = room.top + margin - top
  if (Math.abs(dy) > 1) {
    cancelCameraAnimation()
    setCamera(panBy(camera(), 0, dy))
  }
}

/** After entering edit mode from a click, the editor places its caret at the click. */
let pendingCaret: Vec | null = null
function queueEditCaret(p: Vec) {
  pendingCaret = p
}
export function takeEditCaret(): Vec | null {
  const p = pendingCaret
  pendingCaret = null
  return p
}

export function zoomBy(factor: number) {
  const v = viewport()
  const c = camera()
  animateCamera(zoomAt(c, { x: v.width / 2, y: v.height / 2 }, clampZoom(c.zoom * factor)))
}

export function zoomTo(zoom: number) {
  const v = viewport()
  animateCamera(zoomAt(camera(), { x: v.width / 2, y: v.height / 2 }, zoom))
}

export function zoomToFit() {
  const v = viewport()
  const rects = doc.cardsOn(boardId()).filter((c) => !c.columnId).map((c) => ({ x: c.x, y: c.y, w: c.w, h: cardHeight(c) }))
  rects.push(...doc.stickersOn(boardId()).map(stickerBounds))
  const b = union(rects)
  if (b) animateCamera(fitCamera(b, v.width, v.height))
}

let momentum = 0
function startMomentum(v: Vec) {
  stopMomentum()
  let prev = performance.now()
  const step = (now: number) => {
    const r = momentumStep(v, Math.min(32, now - prev))
    prev = now
    v = r.v
    setCamera(panBy(camera(), r.delta.x, r.delta.y))
    momentum = Math.hypot(v.x, v.y) > 0.02 ? requestAnimationFrame(step) : 0
  }
  momentum = requestAnimationFrame(step)
}
export function stopMomentum() {
  cancelAnimationFrame(momentum)
  momentum = 0
}

let anim = 0
export function cancelCameraAnimation() {
  cancelAnimationFrame(anim)
  anim = 0
}

/**
 * Pan (never zoom) so a card's whole height is on screen, clear of the phone's
 * bottom bars. A card taller than the room shows its top.
 */
/** Pan so a card clears the bars. `from` (board units below the card's top) is the
 *  part that matters most, for a card taller than the room. */
export function revealCard(id: Id, from = 0) {
  const r = rectOf(id)
  if (!r) return
  const cam = camera()
  const room = viewport().height - (phone() ? 150 : 24)
  const top = (r.y + from - cam.y) * cam.zoom
  const bottom = (r.y + r.h - cam.y) * cam.zoom
  const dy = bottom > room ? Math.min(bottom - room, top - 16) : top < 16 ? top - 16 : 0
  if (Math.abs(dy) >= 2) animateCamera({ ...cam, y: cam.y + dy / cam.zoom }, 260)
}

/** Ease the camera to a target. Short and springy: it should feel physical, not slow. */
export function animateCamera(to: { x: number; y: number; zoom: number }, ms = 220, done?: () => void) {
  cancelAnimationFrame(anim)
  stopMomentum()
  const from = camera()
  const v = viewport()
  // Interpolate the viewport centre linearly and zoom geometrically, so a zoom
  // around the centre doesn't drift and it feels even at every scale.
  const cf = { x: from.x + v.width / 2 / from.zoom, y: from.y + v.height / 2 / from.zoom }
  const ct = { x: to.x + v.width / 2 / to.zoom, y: to.y + v.height / 2 / to.zoom }
  const t0 = performance.now()
  const ease = (t: number) => 1 - Math.pow(1 - t, 3)
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms)
    const k = ease(t)
    const zoom = from.zoom * Math.pow(to.zoom / from.zoom, k)
    const cx = cf.x + (ct.x - cf.x) * k
    const cy = cf.y + (ct.y - cf.y) * k
    setCamera({ x: cx - v.width / 2 / zoom, y: cy - v.height / 2 / zoom, zoom })
    if (t < 1) anim = requestAnimationFrame(step)
    else {
      anim = 0
      done?.()
    }
  }
  anim = requestAnimationFrame(step)
}

/** Brighter grid dots around whatever is being dragged or resized, so the snap points are easy to see. */
function GridGlow() {
  const rect = createMemo(() => {
    const ids = [...draggingIds(), ...(resizingId() ? [resizingId()!] : [])]
    const rects = ids.map((id) => rectOf(id)).filter((r): r is Rect => !!r)
    const u = union(rects)
    if (!u) return null
    const pad = GRID * 4
    // Align the box to the grid so its dot pattern sits exactly on the board's.
    const x = Math.floor((u.x - pad) / GRID) * GRID
    const y = Math.floor((u.y - pad) / GRID) * GRID
    return { x, y, w: Math.ceil((u.w + pad * 2) / GRID) * GRID, h: Math.ceil((u.h + pad * 2) / GRID) * GRID }
  })
  return (
    <Show when={rect()}>
      <div
        class="grid-glow"
        data-testid="grid-glow"
        style={{
          left: `${rect()!.x - GRID / 2}px`,
          top: `${rect()!.y - GRID / 2}px`,
          width: `${rect()!.w + GRID}px`,
          height: `${rect()!.h + GRID}px`,
          '--grid': `${GRID}px`,
        }}
      />
    </Show>
  )
}
