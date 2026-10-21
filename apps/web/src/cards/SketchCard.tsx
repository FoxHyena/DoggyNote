import { Show, Suspense, createEffect, createSignal, lazy, on } from 'solid-js'
import { Portal } from 'solid-js/web'
import { sketchContent, sketchPaperColor } from '@doggynote/core'
import { cardColors } from '@doggynote/theme'
import type { CardProps } from '../canvas/CardView.tsx'
import * as doc from '../state/doc.ts'
import { exporting } from '../state/export.ts'
import { beginEdit, endEdit } from '../state/ui.ts'
import { InkLayer } from '../drawing/InkLayer.tsx'
import './sketch.css'

const StrokeEditor = lazy(() => import('../drawing/StrokeEditor.tsx').then((m) => ({ default: m.StrokeEditor })))

/** Passive cards only mount a light SVG. A single active sketch mounts the tools. */
export function SketchCard(props: CardProps<'sketch'>) {
  let titleInput: HTMLInputElement | undefined
  let paper: HTMLDivElement | undefined
  const [editingTitle, setEditingTitle] = createSignal(false)
  createEffect(on(() => props.editing, (active) => { if (!active) setEditingTitle(false) }, { defer: true }))
  const openDrawing = () => {
    // Finish the title before mounting/focusing the modal. Safari mouse clicks
    // do not focus buttons, so a later input blur must not end the new session.
    titleInput?.blur()
    endEdit(); setEditingTitle(false)
    paper?.closest<HTMLElement>('[data-card-id]')?.focus({ preventScroll: true })
    beginEdit(props.card.id)
  }
  const endTitle = () => { if (editingTitle()) { endEdit(); setEditingTitle(false) } }
  const content = () => sketchContent(props.card.content)
  const strokes = () => doc.strokesOn(props.card.id)
  const writable = () => !exporting() && !props.readOnly && doc.canWriteObject(props.card)
  return <div class="sketch-card" style={{ height: '100%', '--sketch-paper': cardColors.light.none.bg, '--sketch-ink': cardColors.light.none.text }}>
    <div ref={paper} class="sketch-paper" classList={{ transparent: content().background === 'transparent' }} style={{ '--sketch-paper': sketchPaperColor(content().background, cardColors.light.none.bg) ?? 'transparent' }} data-testid="sketch-paper" onDblClick={(e) => { if (writable()) { e.stopPropagation(); openDrawing() } }}>
      <InkLayer preserveAspectRatio="xMidYMid meet" strokes={strokes()} width={content().width} height={content().height} />
      <Show when={!strokes().length && writable()}><span class="sketch-empty" data-editor-chrome>Double-click to sketch</span></Show>
    </div>
    {/* The title is named inside the sketch editor; the card shows it only once it exists. */}
    <Show when={content().title}>
    <footer class="sketch-caption">
      <Show when={writable()} fallback={<span>{content().title}</span>}>
        <input ref={titleInput} data-nodrag aria-label="Sketch title" placeholder="Sketch" maxLength={1000} value={content().title} onFocus={() => { setEditingTitle(true); beginEdit(props.card.id) }} onInput={(e) => doc.transient(props.card.id, { content: { ...content(), title: e.currentTarget.value } })} onBlur={endTitle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } }} />
      </Show>
    </footer>
    </Show>
    <Show when={props.editing && writable() && !editingTitle()}><Portal><Suspense fallback={<div class="dialog-backdrop" role="status">Opening drawing tools…</div>}><StrokeEditor title={content().title || 'Sketch'} background={content().background} cardId={props.card.id} width={content().width} height={content().height} titleField={{ value: content().title, onInput: (title) => doc.transient(props.card.id, { content: { ...content(), title } }) }} backgroundField={{ value: content().background, onChange: (background) => doc.transient(props.card.id, { content: { ...content(), background } }) }} onDone={endEdit} /></Suspense></Portal></Show>
  </div>
}
