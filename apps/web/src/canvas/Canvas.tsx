import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import {
  LOD_ZOOM,
  clampZoom,
  cullRect,
  fitCamera,
  intersects,
  nearestSide,
  ordersBetween,
  panBy,
  rectFromPoints,
  screenToWorld,
  union,
  viewRect,
  zoomAt,
  type Card,
  type Id,
  type Obj,
  type Rect,
  type Side,
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
  selection,
  setCamera,
  setConnectMode,
  setSelection,
  setViewport,
  viewport,
} from '../state/ui.ts'
import { columnChildren, connect, createCard } from '../state/actions.ts'
import { CardView } from './CardView.tsx'
import { LodLayer } from './LodLayer.tsx'
import { Connections } from './Connections.tsx'
import { cardEl, cardHeight, rectOf, setMeasuring } from './layout.ts'
import { setDropTarget, dropTarget, connectPreview, setConnectPreview, setDraggingIds } from './dnd.ts'
import { handleCanvasDrop, handleCanvasPaste } from './paste.ts'

type Gesture =
  | { kind: 'pan'; last: Vec; start: Vec; target: HTMLElement }
  | { kind: 'marquee'; start: Vec; base: Set<Id> }
  | { kind: 'press'; id: Id; start: Vec; shift: boolean; target: HTMLElement; client: Vec }
  | { kind: 'drag'; ids: Id[]; startWorld: Vec; origins: Map<Id, Vec>; snap: Record<Id, Partial<Obj>> }
  | { kind: 'resize'; id: Id; startX: number; w0: number; snap: Record<Id, Partial<Obj>> }
  | { kind: 'connect'; from: Id; fromSide: Side }

const DRAG_THRESHOLD = 4

export function Canvas(props: { readOnly: boolean }) {
  let vp!: HTMLDivElement
  const [marquee, setMarquee] = createSignal<Rect | null>(null)
  const [spaceHeld, setSpaceHeld] = createSignal(false)
  const [panning, setPanning] = createSignal(false)
  let gesture: Gesture | null = null

  const lod = createMemo(() => camera().zoom < LOD_ZOOM)

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

  // ---- culling ---------------------------------------------------------------
  const cull = createMemo(
    () => {
      const c = camera()
      const v = viewport()
      // Generous margin + coarse snapping: panning re-culls only every few
      // hundred screen pixels, so cards aren't mounted/unmounted every frame.
      const step = 2 ** Math.round(Math.log2(512 / c.zoom))
      return cullRect(viewRect(c, v.width, v.height), 400 / c.zoom, step)
    },
    undefined,
    { equals: (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h },
  )

  const visible = createMemo(() => {
    const r = cull()
    return doc.cardsOn(boardId()).filter((c) => !c.columnId && intersects(r, { x: c.x, y: c.y, w: c.w, h: cardHeight(c) }))
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
      const rects = doc.cardsOn(id).filter((c) => !c.columnId).map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }))
      const b = union(rects)
      setCamera(b ? fitCamera(b, v.width, v.height) : { x: -v.width / 2, y: -v.height / 3, zoom: 1 })
    }),
  )
  createEffect(() => saveCamera(boardId(), camera()))

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
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h && (!best || (c.z ?? 0) > (best.z ?? 0))) best = c
    }
    if (best?.type === 'column') {
      // A card inside the column, if the point is on one.
      for (const k of columnChildren(best.id)) {
        const r = rectOf(k.id)
        if (r && p.y >= r.y && p.y <= r.y + r.h) return k.id
      }
    }
    return best?.id ?? null
  }

  const cardIdAt = (el: Element | null, e?: { clientX: number; clientY: number }): Id | null =>
    domCardAt(el) ?? (lod() && e && (el as HTMLElement | null)?.closest?.('.lod-layer') ? cardAtWorld(toWorld(e)) : null)

  function columnAt(p: Vec, exclude: Set<Id>): Card | null {
    for (const c of doc.cardsOn(boardId())) {
      if (c.type !== 'column' || c.columnId || exclude.has(c.id)) continue
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
  function onPointerDown(e: PointerEvent) {
    if (e.button === 2) return
    const target = e.target as HTMLElement
    const editing = editingId()

    if (target.closest('[data-nodrag]')) return
    if (e.button === 1 || spaceHeld() || props.readOnly) {
      e.preventDefault()
      const p = { x: e.clientX, y: e.clientY }
      return startGesture(e, { kind: 'pan', last: p, start: p, target })
    }
    if (editing && cardEl(editing)?.contains(target) && !target.closest('[data-resize],[data-connect-handle]')) return

    if (target.closest('[data-resize]')) {
      const id = cardIdAt(target)!
      const c = doc.getCard(id)!
      doc.markBusy([id])
      return startGesture(e, { kind: 'resize', id, startX: e.clientX, w0: c.w, snap: { [id]: doc.snapshot(id, ['w']) } })
    }
    const handle = target.closest('[data-connect-handle]') as HTMLElement | null
    if (handle) {
      const from = cardIdAt(target)!
      const fromSide = (handle.dataset.connectHandle || 'right') as Side
      endEdit()
      setConnectPreview({ from, fromSide, to: toWorld(e), target: null })
      return startGesture(e, { kind: 'connect', from, fromSide })
    }
    const connId = (target.closest('[data-connection-id]') as HTMLElement | null)?.dataset.connectionId
    if (connId) {
      endEdit()
      if (e.shiftKey) toggle(connId)
      else select([connId])
      return
    }
    const id = cardIdAt(target, e)
    if (id) {
      const cm = connectMode()
      if (cm) {
        if (!cm.from) setConnectMode({ from: id })
        else {
          connect(cm.from, id)
          setConnectMode(null)
        }
        return
      }
      return startGesture(e, { kind: 'press', id, start: { x: e.clientX, y: e.clientY }, shift: e.shiftKey, target, client: { x: e.clientX, y: e.clientY } })
    }
    // Background.
    endEdit()
    setConnectMode(null)
    if (!e.shiftKey) clearSelection()
    const start = toWorld(e)
    startGesture(e, { kind: 'marquee', start, base: new Set(e.shiftKey ? selection() : []) })
  }

  function startGesture(e: PointerEvent, g: Gesture) {
    gesture = g
    if (g.kind === 'pan') setPanning(true)
    vp.setPointerCapture(e.pointerId)
  }

  function toggle(id: Id) {
    const s = new Set(selection())
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelection(s)
  }

  function beginDrag(g: Extract<Gesture, { kind: 'press' }>, e: PointerEvent) {
    endEdit()
    if (!selection().has(g.id)) {
      if (g.shift) toggle(g.id)
      else select([g.id])
    }
    const ids = [...selection()].filter((id) => doc.getCard(id))
    const b = boardId()
    let z = doc.maxZ(b)
    const snap: Record<Id, Partial<Obj>> = {}
    const origins = new Map<Id, Vec>()
    for (const id of ids) {
      const c = doc.getCard(id)!
      snap[id] = doc.snapshot(id, ['x', 'y', 'z', 'columnId', 'order'])
      const r = rectOf(id) ?? { x: c.x, y: c.y, w: c.w, h: c.h }
      origins.set(id, { x: r.x, y: r.y })
      // Lift out of a column and onto the top of the stack.
      doc.transient(id, { x: Math.round(r.x), y: Math.round(r.y), z: ++z, columnId: null } as Partial<Card>)
    }
    setDraggingIds(new Set(ids))
    doc.markBusy(ids)
    gesture = { kind: 'drag', ids, startWorld: toWorld({ clientX: g.client.x, clientY: g.client.y }), origins, snap }
    onPointerMove(e)
  }

  function onPointerMove(e: PointerEvent) {
    const g = gesture
    if (!g) return
    switch (g.kind) {
      case 'pan': {
        setCamera(panBy(camera(), e.clientX - g.last.x, e.clientY - g.last.y))
        g.last = { x: e.clientX, y: e.clientY }
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
        setSelection(ids)
        break
      }
      case 'press': {
        if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > DRAG_THRESHOLD) beginDrag(g, e)
        break
      }
      case 'drag': {
        const w = toWorld(e)
        const dx = w.x - g.startWorld.x
        const dy = w.y - g.startWorld.y
        for (const id of g.ids) {
          const o = g.origins.get(id)!
          doc.transient(id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) } as Partial<Card>)
        }
        const set = new Set(g.ids)
        const hasColumn = g.ids.some((id) => doc.getCard(id)?.type === 'column')
        const col = hasColumn ? null : columnAt(w, set)
        setDropTarget(col ? { columnId: col.id, index: insertIndex(col.id, w.y, set) } : null)
        break
      }
      case 'resize': {
        const c = doc.getCard(g.id)!
        const min = c.type === 'image' ? 80 : 160
        doc.transient(g.id, { w: Math.max(min, Math.round(g.w0 + (e.clientX - g.startX) / camera().zoom)) } as Partial<Card>)
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
    const g = gesture
    gesture = null
    setPanning(false)
    if (!g) return
    switch (g.kind) {
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
        if (!c) break
        if (g.shift) {
          toggle(g.id)
          break
        }
        if (c.type === 'board') {
          openBoard((c as Card<'board'>).content.boardId)
          break
        }
        const isTitle = !!g.target.closest('[data-edit-title]')
        // Zoomed out, cards are shapes on a canvas: a click selects, it can't edit.
        if (!lod() && (c.type === 'note' || c.type === 'todo' || (c.type === 'column' && isTitle))) {
          beginEdit(g.id)
          queueEditCaret(g.client)
        } else select([g.id])
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
        }
        doc.commitFrom(g.snap)
        doc.unmarkBusy(g.ids)
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

  function onDblClick(e: MouseEvent) {
    if (props.readOnly) return
    const target = e.target as HTMLElement
    if (target.closest('[data-card-id],[data-connection-id]')) return
    if (lod() && cardAtWorld(toWorld(e))) return
    createCard('note', { at: toWorld(e) })
  }

  // ---- wheel + pinch -------------------------------------------------------------
  let wheelAcc = { dx: 0, dy: 0, zoom: 1, anchor: { x: 0, y: 0 } }
  let wheelFrame = 0
  function onWheel(e: WheelEvent) {
    e.preventDefault()
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

  // Safari/WebKit (and so Tauri) report trackpad pinch as gesture events.
  let gestureZoom = 1
  const onGestureStart = (e: Event) => {
    e.preventDefault()
    gestureZoom = camera().zoom
  }
  const onGestureChange = (e: Event) => {
    e.preventDefault()
    const ge = e as Event & { scale: number; clientX: number; clientY: number }
    setCamera(zoomAt(camera(), local(ge), gestureZoom * ge.scale))
  }

  // ---- keyboard: space-to-pan -------------------------------------------------------
  const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input,textarea,[contenteditable="true"]')
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !typing(e.target) && !editingId()) {
      e.preventDefault()
      setSpaceHeld(true)
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') setSpaceHeld(false)
  }

  // ---- paste + drop -----------------------------------------------------------------
  const centerWorld = () => {
    const v = viewport()
    return screenToWorld(camera(), { x: v.width / 2, y: v.height / 2 })
  }
  const onPaste = (e: ClipboardEvent) => {
    if (props.readOnly || typing(e.target) || editingId()) return
    if (handleCanvasPaste(e, centerWorld())) e.preventDefault()
  }

  onMount(() => {
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    vp.addEventListener('wheel', onWheel, { passive: false })
    vp.addEventListener('gesturestart', onGestureStart)
    vp.addEventListener('gesturechange', onGestureChange)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('paste', onPaste)
    onCleanup(() => {
      ro.disconnect()
      vp.removeEventListener('wheel', onWheel)
      vp.removeEventListener('gesturestart', onGestureStart)
      vp.removeEventListener('gesturechange', onGestureChange)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('paste', onPaste)
    })
  })

  const transform = () => {
    const c = camera()
    return `translate3d(${-c.x * c.zoom}px, ${-c.y * c.zoom}px, 0) scale(${c.zoom})`
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
      classList={{ panning: panning(), moving: moving(), connecting: !!connectPreview(), 'space-held': spaceHeld(), lod: lod(), 'connect-mode': !!connectMode(), readonly: props.readOnly }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDblClick={onDblClick}
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
        <Connections />
        <Show when={!lod()}>
          <For each={visible()}>{(c) => <CardView card={c} lod={false} readOnly={props.readOnly} />}</For>
        </Show>
      </div>
      <Show when={lod()}>
        <LodLayer />
      </Show>
      <Show when={marquee()}>
        <div class="marquee" style={marqueeStyle()} />
      </Show>
      <Show when={!doc.cardsOn(boardId()).length}>
        <div class="empty">
          <p class="empty-title">{props.readOnly ? 'This board is empty' : `Nothing in this ${boardId() === 'home' ? COPY.home : 'board'} yet`}</p>
          <Show when={!props.readOnly}>
            <p class="empty-sub">Double-click anywhere to add a note, or drag something in from the left.</p>
          </Show>
        </div>
      </Show>
    </div>
  )
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
  const b = union(rects)
  if (b) animateCamera(fitCamera(b, v.width, v.height))
}

let anim = 0
/** Ease the camera to a target. Short and springy: it should feel physical, not slow. */
export function animateCamera(to: { x: number; y: number; zoom: number }, ms = 220) {
  cancelAnimationFrame(anim)
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
  }
  anim = requestAnimationFrame(step)
}
