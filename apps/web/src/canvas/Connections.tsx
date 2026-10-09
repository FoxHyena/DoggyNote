import { For, Show, createMemo } from 'solid-js'
import { center, edgePoint, type Connection } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { boardId, isSelected } from '../state/ui.ts'
import { layoutTick, rectOf } from './layout.ts'
import { connectPreview } from './dnd.ts'

// All connectors for the board in one SVG. Each line recomputes only when one
// of its two cards moves or resizes.

function ConnLine(props: { conn: Connection }) {
  const geo = createMemo(() => {
    layoutTick()
    const a = rectOf(props.conn.from)
    const b = rectOf(props.conn.to)
    if (!a || !b) return null
    const p1 = edgePoint(a, center(b), 6)
    const p2 = edgePoint(b, center(a), 8)
    return `M${p1.x},${p1.y} L${p2.x},${p2.y}`
  })
  return (
    <Show when={geo()}>
      <g class="conn" classList={{ selected: isSelected(props.conn.id) }} data-connection-id={props.conn.id} data-testid="connection">
        <path class="conn-hit" d={geo()!} />
        <path class="conn-line" d={geo()!} marker-end={props.conn.arrow === 'end' ? 'url(#dn-arrow)' : undefined} />
      </g>
    </Show>
  )
}

export function Connections() {
  const preview = createMemo(() => {
    const p = connectPreview()
    if (!p) return null
    const a = rectOf(p.from)
    if (!a) return null
    const s = edgePoint(a, p.to, 6)
    return `M${s.x},${s.y} L${p.to.x},${p.to.y}`
  })

  return (
    <svg class="connections" width="1" height="1" aria-hidden="true">
      <defs>
        <marker id="dn-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      <For each={doc.connectionsOn(boardId())}>{(c) => <ConnLine conn={c} />}</For>
      <Show when={preview()}>
        <path class="conn-line conn-preview" d={preview()!} marker-end="url(#dn-arrow)" />
      </Show>
    </svg>
  )
}
