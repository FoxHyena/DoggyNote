import { Show, Suspense, lazy } from 'solid-js'
import { sketchOf, type Card } from '@doggynote/core'
import type { CardProps } from '../canvas/CardView.tsx'
import * as doc from '../state/doc.ts'
import { exporting } from '../state/export.ts'
import { endEdit } from '../state/ui.ts'
import { InkLayer } from '../drawing/InkLayer.tsx'
import './sketch.css'

// Only the sketch being edited loads the editor and its tools.
const StrokeEditor = lazy(() => import('../drawing/StrokeEditor.tsx').then((m) => ({ default: m.StrokeEditor })))

/** A drawing on paper. Double-click opens it in the sketch editor; the card itself is a light SVG. */
export function SketchCard(props: CardProps<'sketch'>) {
  const content = () => sketchOf(props.card)
  // Title and paper are live, through the card's edit session (state/ui.ts). Each
  // is its own field, so only the one that changed is ever sent.
  const set = (fields: Pick<Card, 'sketchTitle'> | Pick<Card, 'sketchPaper'>) => doc.transient(props.card.id, fields as Partial<Card>)
  return (
    <div class="sketch-card">
      <div class="sketch-paper" data-testid="sketch-paper" style={{ background: content().background, 'aspect-ratio': `${content().width} / ${content().height}` }}>
        <InkLayer strokes={doc.strokesOn(props.card.id)} width={content().width} height={content().height} />
      </div>
      <Show when={content().title}>
        <p class="sketch-title" data-testid="sketch-card-title">{content().title}</p>
      </Show>
      <Show when={props.editing && !props.readOnly && !props.lod && !exporting()}>
        <Suspense>
          <StrokeEditor
            card={props.card}
            title={content().title}
            background={content().background}
            width={content().width}
            height={content().height}
            setTitle={(title) => set({ sketchTitle: title })}
            setBackground={(hex) => set({ sketchPaper: hex })}
            onDone={endEdit}
          />
        </Suspense>
      </Show>
    </div>
  )
}
