import { boardInkHeight, isBoardInkSize } from '@doggynote/core'
import type { CardProps } from '../canvas/CardView.tsx'
import * as doc from '../state/doc.ts'
import { boardErasing } from '../state/drawing.ts'
import { InkLayer } from '../drawing/InkLayer.tsx'
import './sketch.css'

/** A mark drawn on the board. Only its line catches the pointer, so it never blocks the cards around it. */
export function InkCard(props: CardProps<'ink'>) {
  const logical = () => (isBoardInkSize(props.card.content) ? props.card.content : { width: props.card.w, height: props.card.h })
  return (
    <div class="ink-card-box" style={{ height: `${boardInkHeight(logical(), props.card.w)}px` }}>
      <InkLayer hit strokes={doc.strokesOn(props.card.id).filter((s) => !boardErasing().has(s.id))} width={logical().width} height={logical().height} />
    </div>
  )
}
