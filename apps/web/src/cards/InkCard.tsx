import { canvasInkHeight } from '@doggynote/core'
import type { CardProps } from '../canvas/CardView.tsx'
import * as doc from '../state/doc.ts'
import { InkLayer } from '../drawing/InkLayer.tsx'
import '../drawing/canvas-ink.css'
import { canvasErasing } from '../state/canvasDrawing.ts'

/** Passive geometry only; the board owns the single active input controller. */
export function InkCard(props: CardProps<'ink'>) {
  return <div class="canvas-ink-surface" style={{ height: `${canvasInkHeight(props.card.content, props.card.w)}px` }} aria-label="Canvas drawing — stays on the board">
    <InkLayer strokes={doc.strokesOn(props.card.id).filter((s) => !canvasErasing().has(s.id))} width={props.card.content.width} height={props.card.content.height} />
  </div>
}
