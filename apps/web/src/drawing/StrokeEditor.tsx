import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { INK_PALETTE, MAX_INK_POINTS, hitInkStroke, inkBounds, newId, sketchPaperColor, type InkMark, type InkPoint, type SketchBackground, type Stroke } from '@doggynote/core'
import { cardColors } from '@doggynote/theme'
import { syncState } from '../state/sync.ts'
import * as doc from '../state/doc.ts'
import { agentDialogKeys } from '../ui/agentDialog.ts'
import { InkLayer } from './InkLayer.tsx'
import { InkTools, type DrawingTool } from './InkTools.tsx'
import { IconButton, ToolIcons } from '../ui/icons.tsx'

export type StrokeEditorProps = {
  cardId: string; width: number; height: number; imageUrl?: string
  background?: SketchBackground; title?: string; originalUrl?: string; onDone: () => void
  /** A sketch names itself here, where it's drawn; the card only shows a title once one is set. */
  titleField?: { value: string; onInput: (title: string) => void }
  backgroundField?: { value: SketchBackground; onChange: (background: SketchBackground) => void }
}

/** One editor, only while actively marking up. Every completed gesture is durable. */
export function StrokeEditor(props: StrokeEditorProps) {
  let dialog!: HTMLElement, viewport!: HTMLDivElement, surface!: HTMLDivElement
  let pointer: number | null = null
  let pan: { x: number; y: number; left: number; top: number } | null = null
  let last: InkPoint | undefined
  const [draft, setDraft] = createSignal<InkMark | null>(null)
  const [erased, setErased] = createSignal(new Set<string>())
  const [tool, setTool] = createSignal<DrawingTool>('pen')
  const [color, setColor] = createSignal<string>(INK_PALETTE[0])
  const [width, setWidth] = createSignal(6)
  const [full, setFull] = createSignal(false)
  const [space, setSpace] = createSignal(false)
  const [zoom, setZoom] = createSignal(1)
  const [fit, setFit] = createSignal(1)
  const [loaded, setLoaded] = createSignal(!props.imageUrl)
  const [imageError, setImageError] = createSignal(false)
  const [notice, setNotice] = createSignal('')
  const strokes = createMemo(() => doc.strokesOn(props.cardId).filter((s) => !erased().has(s.id)))
  const writable = () => doc.canWriteObject(doc.getCard(props.cardId))
  const undo = () => { cancel(); if (doc.canUndoDrawing(props.cardId)) doc.undo() }
  const redo = () => { cancel(); if (doc.canRedoDrawing(props.cardId)) doc.redo() }
  const done = () => { cancel(); void doc.flush().catch(() => {}); props.onDone() }

  function cancel() {
    const p = pointer; pointer = null
    if (p !== null && surface?.hasPointerCapture(p)) surface.releasePointerCapture(p)
    pan = null; last = undefined; setDraft(null); setErased(new Set<string>())
  }
  function point(e: PointerEvent): InkPoint {
    const r = surface.getBoundingClientRect()
    return { x: Math.max(0, Math.min(props.width, (e.clientX - r.left) / r.width * props.width)), y: Math.max(0, Math.min(props.height, (e.clientY - r.top) / r.height * props.height)) }
  }
  function erase(p: InkPoint) {
    const r = surface.getBoundingClientRect()
    const hits = new Set(erased())
    for (const s of strokes()) if (hitInkStroke(s, p, 10 * props.width / r.width, last ?? p)) hits.add(s.id)
    setErased(hits); last = p
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 || pointer !== null) return
    e.preventDefault(); e.stopPropagation(); surface.focus()
    pointer = e.pointerId; surface.setPointerCapture(pointer)
    if (space()) { pan = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; return }
    if (!writable() || !loaded() || imageError()) { cancel(); return }
    setNotice('')
    const p = point(e)
    if (tool() === 'eraser') { erase(p); return }
    const inkWidth = Math.min(2000, width() * Math.max(props.width, props.height) / 1000 * (tool() === 'highlighter' ? 3 : 1))
    const s: InkMark = { id: newId(), tool: tool() as 'pen' | 'highlighter', color: color(), width: Math.max(0.1, inkWidth), opacity: tool() === 'highlighter' ? 0.3 : 1, points: [p], order: Math.max(Date.now(), ...strokes().map((s) => s.order + 1)), bounds: inkBounds([p], Math.max(0.1, inkWidth)) }
    setDraft(s)
  }
  function move(e: PointerEvent) {
    if (pointer !== e.pointerId) return
    e.preventDefault()
    if (pan) { viewport.scrollLeft = pan.left - e.clientX + pan.x; viewport.scrollTop = pan.top - e.clientY + pan.y; return }
    const p = point(e)
    if (tool() === 'eraser') return erase(p)
    const s = draft()
    if (!s) return
    const previous = s.points.at(-1)!
    if (Math.hypot(p.x - previous.x, p.y - previous.y) * fit() * zoom() < 0.8) return
    // Bound long gestures without dropping their tail. Decimate the older
    // samples and continue in the same editable stroke/undo transaction.
    const kept = s.points.length >= MAX_INK_POINTS - 1 ? s.points.filter((_, i) => i % 2 === 0) : s.points
    const points = [...kept, p]
    setDraft({ ...s, points, bounds: inkBounds(points, s.width) })
  }
  function up(e: PointerEvent) {
    if (pointer !== e.pointerId) return
    if (!pan) move(e)
    const s = draft(), ids = [...erased()]
    const card = doc.getCard(props.cardId)
    if (!pan && card && writable()) {
      if (s) doc.commit([doc.createChange({ ...s, kind: 'stroke', boardId: card.boardId, cardId: card.id, createdAt: Date.now() } satisfies Stroke)])
      else if (ids.length) doc.update(Object.fromEntries(ids.filter((id) => doc.get(id)?.kind === 'stroke').map((id) => [id, { deletedAt: Date.now() }])))
    }
    cancel()
  }
  createEffect(() => { if (!writable()) { cancel(); setNotice('View only. Your completed marks are kept.'); } })
  createEffect(() => { props.imageUrl; setLoaded(!props.imageUrl); setImageError(false) })
  onMount(() => {
    const focus = document.activeElement as HTMLElement | null
    dialog.querySelector<HTMLButtonElement>('button')?.focus()
    // Small source images need a useful editing surface too. Fit may enlarge
    // the viewport; persisted points remain in the original logical pixels.
    const ro = new ResizeObserver(() => setFit(Math.min(Math.max(0.000001, (viewport.clientWidth - 40) / props.width), Math.max(0.000001, (viewport.clientHeight - 40) / props.height))))
    ro.observe(viewport)
    const blur = () => { cancel(); setSpace(false) }
    const vis = () => { if (document.visibilityState === 'hidden') blur() }
    const keyup = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false) }
    window.addEventListener('blur', blur); window.addEventListener('keyup', keyup); document.addEventListener('visibilitychange', vis)
    onCleanup(() => { cancel(); ro.disconnect(); window.removeEventListener('blur', blur); window.removeEventListener('keyup', keyup); document.removeEventListener('visibilitychange', vis); if (focus?.isConnected) focus.focus() })
  })
  function keys(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (pointer !== null) cancel(); else done(); return }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
    if (e.code === 'Space' && !(e.target as HTMLElement).closest('select,input,textarea')) {
      // A mouse user may have just chosen a toolbar tool. Space+drag must
      // still pan; keep ordinary Space activation when a button retains focus.
      if (!(e.target as HTMLElement).closest('button')) e.preventDefault()
      if (!space()) { cancel(); setSpace(true) }
    }
    agentDialogKeys(e)
  }
  // Without an image, the paper colour follows the live field so picks show at once.
  const paperColor = () => props.imageUrl ? null : sketchPaperColor(props.backgroundField?.value ?? props.background ?? 'paper', cardColors.light.none.bg)
  // A press outside the editor finishes, like clicking away from a note.
  return <div class="dialog-backdrop ink-backdrop" classList={{ full: full() }} onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) done() }}>
    <section ref={dialog} class="ink-editor" role="dialog" aria-modal="true" aria-label={props.title ?? 'Annotate image'} data-testid="stroke-editor" onClick={(e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button')
      if (!button) return
      // Wait for native click focus and reactive disabled states. Safari can
      // blur a pointer-focused button; exhausted Undo/Redo buttons lose focus
      // in other engines too. Keep the next shortcut within this dialog.
      queueMicrotask(() => {
        if (!dialog.isConnected) return
        const target = button.isConnected && !button.matches(':disabled') ? button : surface
        target.focus({ preventScroll: true })
      })
    }} onKeyDown={keys} onKeyUp={(e) => { e.stopPropagation(); if (e.code === 'Space') setSpace(false) }}>
      <header class="ink-heading"><Show when={props.titleField && writable()} fallback={<h2>{props.title ?? 'Annotate image'}</h2>}><input class="ink-title" data-testid="sketch-title-field" aria-label="Sketch title" placeholder="Untitled sketch" maxLength={1000} value={props.titleField!.value} onInput={(e) => props.titleField!.onInput(e.currentTarget.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); surface.focus({ preventScroll: true }) } }} onKeyUp={(e) => e.stopPropagation()} /></Show><span role="status">{doc.localSaveError() ? 'Save problem. Keep this window open.' : notice() || (syncState() === 'offline' ? 'Offline. Marks will sync when you reconnect.' : '')}</span>
        <div class="ink-actions" role="group" aria-label="Drawing actions">
          <IconButton testid="ink-undo" icon={ToolIcons.undo} label="Undo" title="Undo (⌘/Ctrl+Z)" disabled={!writable() || !doc.canUndoDrawing(props.cardId)} onClick={undo} />
          <IconButton testid="ink-redo" icon={ToolIcons.redo} label="Redo" title="Redo (⇧⌘/Ctrl+Z)" disabled={!writable() || !doc.canRedoDrawing(props.cardId)} onClick={redo} />
          <span class="ink-sep" aria-hidden="true" />
          <IconButton testid="ink-zoom-out" icon={ToolIcons.minus} label="Zoom out drawing" title="Zoom out" disabled={zoom() <= 0.5} onClick={() => { cancel(); setZoom(Math.max(0.5, zoom() / 2)) }} />
          <IconButton testid="ink-fit" icon={ToolIcons.fit} label="Fit" title="Fit to window" onClick={() => { cancel(); setZoom(1) }} />
          <IconButton testid="ink-zoom-in" icon={ToolIcons.plus} label="Zoom in drawing" title="Zoom in" disabled={zoom() >= 4} onClick={() => { cancel(); setZoom(Math.min(4, zoom() * 2)) }} />
          <IconButton testid="ink-full" icon={full() ? ToolIcons.shrink : ToolIcons.expand} label={full() ? 'Exit full screen' : 'Full screen'} pressed={full()} onClick={() => setFull(!full())} />
          <span class="ink-sep" aria-hidden="true" />
          <IconButton testid="ink-done" icon={ToolIcons.check} label="Done" title="Done (Escape, or click outside)" onClick={done} />
        </div>
      </header>
      <fieldset disabled={!writable()} class="ink-settings"><InkTools tool={tool()} setTool={(t) => { cancel(); setTool(t) }} color={color()} setColor={setColor} width={width()} setWidth={setWidth} paper={props.backgroundField} /></fieldset>
      <div ref={viewport} class="ink-viewport" data-testid="ink-viewport"><div class="ink-pad"><div ref={surface} class="ink-surface" classList={{ 'ink-paper': !!paperColor(), panning: space(), erasing: tool() === 'eraser' }} style={{ '--ink-paper': paperColor() ?? 'transparent', width: `${props.width * fit() * zoom()}px`, height: `${props.height * fit() * zoom()}px` }} tabindex="0" role="img" aria-label="Drawing surface. Drag to draw; hold Space and drag to pan." data-testid="ink-surface" data-image-ready={loaded()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>
        <Show when={props.imageUrl}><img src={props.imageUrl} alt="Original image" draggable={false} onLoad={() => setLoaded(true)} onError={() => { cancel(); setImageError(true) }} /></Show>
        <InkLayer strokes={draft() ? [...strokes(), draft()!] : strokes()} width={props.width} height={props.height} />
      </div></div></div>
      <Show when={imageError()}><p class="ink-feedback" role="alert">The original image could not load. Close and reopen to retry; your marks are kept.</p></Show>
      <Show when={!loaded() && !imageError()}><p class="ink-feedback" role="status">Loading original image…</p></Show>
      <Show when={doc.localSaveError()}><div class="ink-feedback" role="alert"><span>{doc.localSaveError()}</span><button class="bar-btn" onClick={() => void doc.flush().catch(() => {})}>Retry saving</button></div></Show>
      <Show when={props.originalUrl}><footer><a href={props.originalUrl} target="_blank" rel="noopener" download="" data-testid="download-original">Download original</a></footer></Show>
    </section>
  </div>
}
