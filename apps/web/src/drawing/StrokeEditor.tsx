import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from 'solid-js'
import { Portal } from 'solid-js/web'
import { HIGHLIGHTER, MAX_INK_POINTS, hitInkStroke, inkBounds, newId, readableInk, roundInk, type Card, type InkMark, type InkPoint, type Stroke } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { inkColor, inkTool, inkWidth, setInkColor } from '../state/drawing.ts'
import { phone } from '../state/device.ts'
import { IconButton, ToolIcons } from '../ui/icons.tsx'
import { installMenu } from '../ui/menu.ts'
import { agentDialogKeys } from '../ui/agentDialog.ts'
import { InkLayer } from './InkLayer.tsx'
import { InkTools, PaperPicker } from './InkTools.tsx'
import './ink.css'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
/** Room around the paper inside the editor. */
const GUTTER = 12

/**
 * The sketch editor: the sketch's paper at a comfortable size, with the ink
 * tools. Mounted only for the one sketch being edited. Every finished stroke is
 * saved (and synced) on its own; the title and paper colour go through the
 * card's edit session, so closing the editor is when they become one undo step.
 * Clicking outside it, Escape or Done closes it.
 */
export function StrokeEditor(props: {
  card: Card<'sketch'>
  title: string
  background: string
  width: number
  height: number
  setTitle: (title: string) => void
  setBackground: (hex: string) => void
  onDone: () => void
}) {
  let backdrop!: HTMLDivElement
  let dialog!: HTMLElement
  let head!: HTMLElement
  let viewport!: HTMLDivElement
  let surface!: HTMLDivElement
  let pointer: number | null = null
  let last: InkPoint | undefined
  /**
   * Where a shift-click's straight line starts: the end of the last stroke (or
   * eraser pass). Forgotten when the tool changes or that stroke is undone.
   */
  let anchor: { point: InkPoint; stroke: string | null } | null = null
  /** This press began with shift held from an anchor: if it doesn't move, it's a straight line. */
  let lineFrom: InkPoint | null = null
  const [draft, setDraft] = createSignal<InkMark | null>(null)
  const [erasing, setErasing] = createSignal<ReadonlySet<string>>(new Set())
  const [full, setFull] = createSignal(false)
  const [zoom, setZoom] = createSignal(1)
  const [fit, setFit] = createSignal(1)
  const strokes = () => doc.strokesOn(props.card.id).filter((s) => !erasing().has(s.id))
  const writable = () => doc.canWriteObject(props.card)
  const scale = () => fit() * zoom()
  /** Full screen, or a phone (always full screen): the paper fits the room left under the header. */
  const filled = () => full() || phone()

  // The pen never vanishes on the paper: an ink too faint for this paper (a
  // charcoal pen on charcoal paper) becomes white or charcoal when the editor
  // opens or the paper changes. A pick that reads stays.
  // A memo, so only a real change of paper counts (the card re-renders for many other reasons).
  const paper = createMemo(() => props.background)
  createEffect(on(paper, (hex) => setInkColor(readableInk(untrack(inkColor), hex))))

  function cancel() {
    const p = pointer
    pointer = null
    if (p !== null && surface?.hasPointerCapture(p)) surface.releasePointerCapture(p)
    last = undefined
    setDraft(null)
    setErasing(new Set<string>())
  }
  createEffect(on(inkTool, () => { anchor = null }, { defer: true }))
  /** The anchor, unless the stroke it came from was undone or erased. */
  const anchorPoint = () => (anchor && (!anchor.stroke || doc.strokesOn(props.card.id).some((s) => s.id === anchor!.stroke)) ? anchor.point : null)
  const undo = () => { cancel(); if (doc.canUndoDrawing(props.card.id)) doc.undo() }
  const redo = () => { cancel(); if (doc.canRedoDrawing(props.card.id)) doc.redo() }
  const done = () => { cancel(); props.onDone() }

  /** A pointer position in the paper's logical space, kept on the paper. */
  function point(e: PointerEvent): InkPoint {
    const r = surface.getBoundingClientRect()
    return {
      x: roundInk(Math.max(0, Math.min(props.width, ((e.clientX - r.left) / r.width) * props.width))),
      y: roundInk(Math.max(0, Math.min(props.height, ((e.clientY - r.top) / r.height) * props.height))),
    }
  }
  function erase(p: InkPoint) {
    const hits = new Set(erasing())
    // A fingertip-sized eraser whatever the zoom.
    for (const s of doc.strokesOn(props.card.id)) if (!hits.has(s.id) && hitInkStroke(s, p, 10 / scale(), last ?? p)) hits.add(s.id)
    setErasing(hits)
    last = p
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 || pointer !== null || !writable()) return
    e.preventDefault()
    pointer = e.pointerId
    try {
      surface.setPointerCapture(pointer)
    } catch {
      // The pointer is already gone (or synthetic); its events still reach the paper.
    }
    const p = point(e)
    const tool = inkTool()
    lineFrom = e.shiftKey ? anchorPoint() : null
    if (tool === 'eraser') {
      // Shift-click: erase along the straight segment from the anchor.
      if (lineFrom) last = lineFrom
      return erase(p)
    }
    const width = inkWidth() * (tool === 'highlighter' ? HIGHLIGHTER.scale : 1)
    const order = Math.max(Date.now(), ...doc.strokesOn(props.card.id).map((s) => s.order + 1))
    setDraft({ id: newId(), tool, color: inkColor(), width, opacity: tool === 'highlighter' ? HIGHLIGHTER.opacity : 1, points: [p], order, bounds: inkBounds([p], width) })
  }
  function move(e: PointerEvent) {
    if (pointer !== e.pointerId) return
    e.preventDefault()
    const events = e.getCoalescedEvents?.() ?? []
    for (const ev of events.length ? events : [e]) {
      const p = point(ev)
      if (inkTool() === 'eraser') { erase(p); continue }
      const d = draft()
      if (!d) return
      const prev = d.points[d.points.length - 1]
      // Under a screen pixel apart adds bytes, not shape.
      if (Math.hypot(p.x - prev.x, p.y - prev.y) * scale() < 1) continue
      // A very long line thins out its older points rather than stopping.
      const kept = d.points.length >= MAX_INK_POINTS - 1 ? d.points.filter((_, i) => i % 2 === 0) : d.points
      setDraft({ ...d, points: [...kept, p] })
    }
  }
  /**
   * The pen lifts: keep the line. Also on lost capture, which WebKit can send
   * before pointerup on a quick release; its coordinates aren't trustworthy,
   * so only a real pointerup adds a final point.
   */
  function up(e: PointerEvent) {
    if (pointer !== e.pointerId) return
    if (e.type === 'pointerup') move(e)
    let d = draft()
    const erased = [...erasing()]
    const end = d ? d.points[d.points.length - 1] : last
    const card = doc.getCard(props.card.id)
    // A shift-click that didn't move: a straight line from the anchor.
    if (d && lineFrom && d.points.length === 1) d = { ...d, points: [lineFrom, d.points[0]] }
    lineFrom = null
    cancel()
    if (!card || !writable()) return
    anchor = end ? { point: end, stroke: d?.id ?? null } : null
    if (d) {
      const stroke: Stroke = { ...d, bounds: inkBounds(d.points, d.width), kind: 'stroke', boardId: card.boardId, cardId: card.id, createdAt: Date.now() }
      doc.commit([doc.createChange(stroke)])
    } else if (erased.length) {
      const now = Date.now()
      doc.update(Object.fromEntries(erased.map((id) => [id, { deletedAt: now }])))
    }
  }

  // Someone took away edit access mid-stroke: drop the unfinished mark.
  createEffect(() => { if (!writable()) cancel() })
  onMount(() => {
    const back = document.activeElement as HTMLElement | null
    dialog.focus({ preventScroll: true })
    // The paper fills the room it has (less a gutter), keeping its shape, and
    // the window is sized to the paper: no empty frame around a small sketch.
    const measure = () => {
      let w: number, h: number
      if (filled()) {
        w = viewport.clientWidth
        h = viewport.clientHeight
      } else {
        const cs = getComputedStyle(backdrop)
        w = backdrop.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2
        h = backdrop.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - head.offsetHeight - 2
      }
      setFit(Math.max(0.05, Math.min((w - GUTTER * 2) / props.width, (h - GUTTER * 2) / props.height)))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(backdrop)
    ro.observe(head)
    ro.observe(viewport)
    createEffect(on(filled, () => requestAnimationFrame(measure), { defer: true }))
    const blur = () => cancel()
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', windowKeys, true)
    onCleanup(() => {
      ro.disconnect()
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', windowKeys, true)
      cancel()
      if (back?.isConnected) back.focus({ preventScroll: true })
    })
  })

  function keys(e: KeyboardEvent) {
    // Nothing here reaches the board's shortcuts (Delete would bury the card).
    agentDialogKeys(e)
    // WebKit treats Backspace as "go back".
    if (e.key === 'Backspace' && !(e.target as Element).closest('input')) e.preventDefault()
  }

  /**
   * Escape, Undo and Redo work wherever focus is, even after a button that
   * just disabled itself (Redo with nothing left) dropped focus to the page.
   * A popover or menu open over the editor (paper, zoom) handles its own Escape.
   */
  function windowKeys(e: KeyboardEvent) {
    if (e.defaultPrevented || document.querySelector('.popover, .ink-zoom-menu')) return
    const typing = !!(e.target as Element | null)?.closest?.('input')
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (typing) surface.focus({ preventScroll: true })
      else if (pointer !== null) cancel()
      else done()
    } else if (!typing && mod && (key === 'z' || key === 'y')) {
      e.preventDefault()
      e.stopPropagation()
      if (key === 'y' || e.shiftKey) redo()
      else undo()
    }
  }
  const stop = (e: Event) => e.stopPropagation()
  const history = (
    <>
      <IconButton testid="sketch-undo" icon={ToolIcons.undo} label="Undo" title="Undo (⌘Z)" disabled={!writable() || !doc.canUndoDrawing(props.card.id)} onClick={undo} />
      <IconButton testid="sketch-redo" icon={ToolIcons.redo} label="Redo" title="Redo (⇧⌘Z)" disabled={!writable() || !doc.canRedoDrawing(props.card.id)} onClick={redo} />
    </>
  )
  return (
    <Portal>
      {/* A press on the backdrop finishes, like clicking away from a note. Events stop here: the board underneath never sees them. */}
      <div
        ref={backdrop}
        class="ink-backdrop"
        classList={{ full: full() }}
        data-testid="sketch-backdrop"
        onPointerDown={(e) => { stop(e); if (e.target === e.currentTarget) done() }}
        onPointerMove={stop}
        onPointerUp={stop}
        onDblClick={stop}
        onContextMenu={stop}
        onWheel={stop}
      >
        <section
          ref={dialog}
          class="ink-editor"
          classList={{ readonly: !writable() }}
          style={filled() ? undefined : { '--ink-fit-w': `${Math.ceil(props.width * fit()) + GUTTER * 2 + 2}px`, '--ink-fit-h': `${Math.ceil(props.height * fit()) + GUTTER * 2}px` }}
          role="dialog"
          aria-modal="true"
          aria-label={props.title || 'Sketch'}
          data-testid="sketch-editor"
          tabIndex={-1}
          onKeyDown={keys}
        >
          {/* One row when there's room: the sketch (title, paper) on the left, the tools in the middle, view and Done on the right. */}
          <header ref={head} class="ink-head">
            <div class="ink-doc">
              {/* The paper leads, like a document's icon: it belongs to the sketch, not the pen. */}
              <Show when={writable()}>
                <PaperPicker value={props.background} onChange={props.setBackground} />
              </Show>
              <Show when={writable()} fallback={<h2 class="ink-title-text">{props.title || 'Sketch'}</h2>}>
                <input
                  class="ink-title"
                  data-testid="sketch-title"
                  aria-label="Sketch title"
                  placeholder={COPY.sketchTitlePlaceholder}
                  maxLength={1000}
                  value={props.title}
                  onInput={(e) => props.setTitle(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); surface.focus({ preventScroll: true }) } }}
                />
              </Show>
            </div>
            <Show when={writable()}>
              <div class="ink-toolbar"><InkTools onTool={cancel} lead={history} /></div>
            </Show>
            <div class="ink-actions" role="group" aria-label="Sketch actions">
              {/* A phone's editor is the whole screen already, with the paper as wide as it goes. */}
              <Show when={!phone()}>
                <ZoomMenu zoom={zoom()} scale={scale()} setZoom={setZoom} full={full()} setFull={setFull} />
              </Show>
              <IconButton testid="sketch-done" icon={ToolIcons.check} label="Done" title="Done (Esc)" onClick={done} />
            </div>
          </header>
          <div ref={viewport} class="ink-viewport" data-testid="sketch-viewport">
            <div class="ink-pad">
              <div
                ref={surface}
                class="ink-surface"
                classList={{ erasing: inkTool() === 'eraser', readonly: !writable() }}
                style={{ background: props.background, width: `${props.width * scale()}px`, height: `${props.height * scale()}px` }}
                tabIndex={0}
                role="img"
                aria-label="Sketch paper"
                data-testid="sketch-surface"
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onLostPointerCapture={(e) => { if (e.pointerId === pointer) up(e) }}
              >
                <InkLayer strokes={strokes()} width={props.width} height={props.height} draft={draft()} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </Portal>
  )
}

/** The view: the board's zoom pill ("100% ▾"), its menu holding zoom, fit and full screen. */
function ZoomMenu(props: { zoom: number; scale: number; setZoom: (z: number) => void; full: boolean; setFull: (on: boolean) => void }) {
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement, trigger!: HTMLButtonElement
  installMenu(open, () => setOpen(false), () => root, () => trigger)
  const item = (testid: string, label: string, action: () => void, disabled = false, pressed?: boolean) => (
    // Mouse down keeps focus in the menu: WebKit would otherwise hand it to the dialog, which closes the menu before the click lands.
    <button class="menu-item" data-testid={testid} disabled={disabled} aria-pressed={pressed} onMouseDown={(e) => e.preventDefault()} onClick={() => { action(); setOpen(false); trigger.focus({ preventScroll: true }) }}>
      <span class="nav-menu-label">{label}</span>
    </button>
  )
  // The paper's real size on screen, like the board's own zoom.
  const percent = () => `${Math.round(props.scale * 100)}%`
  return (
    <div class="ink-zoom" ref={root}>
      <button ref={trigger} type="button" class="bar-btn ink-zoom-pill" data-testid="sketch-zoom" aria-label={`Zoom: ${percent()}`} aria-haspopup="menu" aria-expanded={open()} data-tip="Zoom and full screen" onClick={() => setOpen(!open())}>
        {percent()}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m2 4 3 3 3-3" fill="none" stroke="currentColor" /></svg>
      </button>
      <Show when={open()}>
        <div class="menu nav-menu ink-zoom-menu" role="menu" aria-label="Zoom">
          {item('sketch-zoom-in', 'Zoom in', () => props.setZoom(Math.min(MAX_ZOOM, props.zoom * 1.5)), props.zoom >= MAX_ZOOM)}
          {item('sketch-zoom-out', 'Zoom out', () => props.setZoom(Math.max(MIN_ZOOM, props.zoom / 1.5)), props.zoom <= MIN_ZOOM)}
          {item('sketch-fit', 'Fit to window', () => props.setZoom(1), props.zoom === 1)}
          {item('sketch-full', props.full ? 'Exit full screen' : 'Full screen', () => props.setFull(!props.full), false, props.full)}
        </div>
      </Show>
    </div>
  )
}
