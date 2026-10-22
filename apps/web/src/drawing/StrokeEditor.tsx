import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { HIGHLIGHTER, MAX_INK_POINTS, hitInkStroke, inkBounds, newId, roundInk, type Card, type InkMark, type InkPoint, type Stroke } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { inkColor, inkTool, inkWidth } from '../state/drawing.ts'
import { phone } from '../state/device.ts'
import { IconButton, ToolIcons } from '../ui/icons.tsx'
import { agentDialogKeys } from '../ui/agentDialog.ts'
import { InkLayer } from './InkLayer.tsx'
import { InkTools } from './InkTools.tsx'
import './ink.css'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4

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
  let dialog!: HTMLElement
  let viewport!: HTMLDivElement
  let surface!: HTMLDivElement
  let pointer: number | null = null
  let last: InkPoint | undefined
  const [draft, setDraft] = createSignal<InkMark | null>(null)
  const [erasing, setErasing] = createSignal<ReadonlySet<string>>(new Set())
  const [full, setFull] = createSignal(false)
  const [zoom, setZoom] = createSignal(1)
  const [fit, setFit] = createSignal(1)
  const strokes = () => doc.strokesOn(props.card.id).filter((s) => !erasing().has(s.id))
  const writable = () => doc.canWriteObject(props.card)
  const scale = () => fit() * zoom()

  function cancel() {
    const p = pointer
    pointer = null
    if (p !== null && surface?.hasPointerCapture(p)) surface.releasePointerCapture(p)
    last = undefined
    setDraft(null)
    setErasing(new Set<string>())
  }
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
    if (tool === 'eraser') return erase(p)
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
  function up(e: PointerEvent) {
    if (pointer !== e.pointerId) return
    move(e)
    const d = draft()
    const erased = [...erasing()]
    const card = doc.getCard(props.card.id)
    cancel()
    if (!card || !writable()) return
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
    // The paper fills the room it has (less a margin), keeping its shape.
    const ro = new ResizeObserver(() => setFit(Math.max(0.05, Math.min((viewport.clientWidth - 24) / props.width, (viewport.clientHeight - 24) / props.height))))
    ro.observe(viewport)
    const blur = () => cancel()
    window.addEventListener('blur', blur)
    onCleanup(() => {
      ro.disconnect()
      window.removeEventListener('blur', blur)
      cancel()
      if (back?.isConnected) back.focus({ preventScroll: true })
    })
  })

  function keys(e: KeyboardEvent) {
    // Nothing here reaches the board's shortcuts (Delete would bury the card).
    agentDialogKeys(e)
    const typing = !!(e.target as Element).closest('input')
    if (e.key === 'Escape') {
      e.preventDefault()
      if (typing) return surface.focus({ preventScroll: true })
      if (pointer !== null) cancel()
      else done()
      return
    }
    if (typing) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo() }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
    // WebKit treats Backspace as "go back".
    if (e.key === 'Backspace') e.preventDefault()
  }

  const stop = (e: Event) => e.stopPropagation()
  return (
    <Portal>
      {/* A press on the backdrop finishes, like clicking away from a note. Events stop here: the board underneath never sees them. */}
      <div
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
        <section ref={dialog} class="ink-editor" role="dialog" aria-modal="true" aria-label={props.title || 'Sketch'} data-testid="sketch-editor" tabIndex={-1} onKeyDown={keys}>
          <header class="ink-head">
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
            <div class="ink-actions" role="group" aria-label="Sketch actions">
              <IconButton testid="sketch-undo" icon={ToolIcons.undo} label="Undo" title="Undo (⌘Z)" disabled={!writable() || !doc.canUndoDrawing(props.card.id)} onClick={undo} />
              <IconButton testid="sketch-redo" icon={ToolIcons.redo} label="Redo" title="Redo (⇧⌘Z)" disabled={!writable() || !doc.canRedoDrawing(props.card.id)} onClick={redo} />
              {/* A phone's editor is the whole screen already, with the paper as wide as it goes. */}
              <Show when={!phone()}>
                <span class="ink-sep" aria-hidden="true" />
                <IconButton testid="sketch-zoom-out" icon={ToolIcons.zoomOut} label="Zoom out" disabled={zoom() <= MIN_ZOOM} onClick={() => setZoom(Math.max(MIN_ZOOM, zoom() / 1.5))} />
                <IconButton testid="sketch-fit" icon={ToolIcons.fit} label="Fit to window" disabled={zoom() === 1} onClick={() => setZoom(1)} />
                <IconButton testid="sketch-zoom-in" icon={ToolIcons.zoomIn} label="Zoom in" disabled={zoom() >= MAX_ZOOM} onClick={() => setZoom(Math.min(MAX_ZOOM, zoom() * 1.5))} />
                <IconButton testid="sketch-full" icon={full() ? ToolIcons.shrink : ToolIcons.expand} label={full() ? 'Exit full screen' : 'Full screen'} pressed={full()} onClick={() => setFull(!full())} />
              </Show>
              <span class="ink-sep" aria-hidden="true" />
              <IconButton testid="sketch-done" icon={ToolIcons.check} label="Done" title="Done (Esc)" onClick={done} />
            </div>
          </header>
          <Show when={writable()}>
            <div class="ink-toolbar"><InkTools onTool={cancel} paper={{ value: props.background, onChange: props.setBackground }} /></div>
          </Show>
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
                onPointerCancel={cancel}
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
