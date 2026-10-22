import { Show, Suspense, lazy } from 'solid-js'
import { sketchContent, type Card } from '@doggynote/core'
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
  const content = () => sketchContent(props.card.content)
  // Title and paper changes are live, through the card's edit session (state/ui.ts).
  const set = (fields: Partial<Card<'sketch'>['content']>) => doc.transient(props.card.id, { content: { ...content(), ...fields } } as Partial<Card>)
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
            setTitle={(title) => set({ title })}
            setBackground={(background) => set({ background })}
            onDone={endEdit}
          />
        </Suspense>
      </Show>
    </div>
  )
}
