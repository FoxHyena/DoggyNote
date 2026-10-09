import { For, Show, createMemo } from 'solid-js'
import { SIDES, autoSides, connectorPath, sideAnchor, type Connection } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { boardId, isSelected } from '../state/ui.ts'
import { layoutTick, rectOf } from './layout.ts'
import { connectPreview } from './dnd.ts'

// All connectors for the board in one SVG. Each end attaches to the middle of
// a card side: the side it was dropped on, or (if never pinned) whichever
// sides face each other right now. Each line recomputes only when one of its
// two cards moves or resizes.

function ConnLine(props: { conn: Connection }) {
  const geo = createMemo(() => {
    layoutTick()
    const a = rectOf(props.conn.from)
    const b = rectOf(props.conn.to)
    if (!a || !b) return null
    const [autoA, autoB] = autoSides(a, b)
    return connectorPath(a, props.conn.fromSide ?? autoA, { rect: b, side: props.conn.toSide ?? autoB }).d
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
    layoutTick()
    const p = connectPreview()
    if (!p) return null
    const a = rectOf(p.from)
    if (!a) return null
    const t = p.target && rectOf(p.target.id)
    const path = connectorPath(a, p.fromSide, t ? { rect: t, side: p.target!.side } : p.to)
    return { d: path.d, target: t ? { rect: t, side: p.target!.side } : null }
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
        <path class="conn-line conn-preview" d={preview()!.d} marker-end="url(#dn-arrow)" data-testid="connection-preview" />
        {/* While hovering a card: its four anchors, with the one it'll snap to lit. */}
        <Show when={preview()!.target}>
          <For each={SIDES}>
            {(side) => {
              const pt = () => sideAnchor(preview()!.target!.rect, side)
              return (
                <circle
                  class="anchor"
                  classList={{ hot: preview()!.target!.side === side }}
                  data-testid="anchor"
                  data-side={side}
                  cx={pt().x}
                  cy={pt().y}
                  r={preview()!.target!.side === side ? 6 : 4}
                />
              )
            }}
          </For>
        </Show>
      </Show>
    </svg>
  )
}
