import { For, Show, createMemo, mapArray, type Accessor } from 'solid-js'
import { SIDES, autoSides, connectorPath, sideAnchor, type Connection } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { connectionEndpoint } from '../state/columns.ts'
import { boardId, isSelected } from '../state/ui.ts'
import { layoutTick, rectOf } from './layout.ts'
import { connectPreview } from './dnd.ts'

type ConnectionLine = { conn: Connection; geo: Accessor<(ReturnType<typeof connectorPath> & { collapsed: boolean }) | null> }

/** Both paint layers share per-connection memos, including column remapping. */
export function createConnectionGeometry() {
  const lines = mapArray(() => doc.connectionsOn(boardId()), (conn): ConnectionLine => {
    const geo = createMemo(() => {
      layoutTick()
      const from = connectionEndpoint(conn.from)
      const to = connectionEndpoint(conn.to)
      if (!from || !to || from === to) return null
      const a = rectOf(from)
      const b = rectOf(to)
      if (!a || !b) return null
      const [autoA, autoB] = autoSides(a, b)
      return { ...connectorPath(a, from === conn.from ? conn.fromSide ?? autoA : autoA, { rect: b, side: to === conn.to ? conn.toSide ?? autoB : autoB }), collapsed: from !== conn.from || to !== conn.to }
    })
    return { conn, geo }
  })
  const preview = createMemo(() => {
    layoutTick()
    const p = connectPreview()
    if (!p) return null
    const a = rectOf(p.from)
    if (!a) return null
    const t = p.target && rectOf(p.target.id)
    const path = connectorPath(a, p.fromSide, t ? { rect: t, side: p.target!.side } : p.to)
    return { ...path, target: t ? { rect: t, side: p.target!.side } : null }
  })
  return { lines, preview }
}

function ConnLine(props: { line: ConnectionLine; foreground: boolean }) {
  const geo = props.line.geo, conn = props.line.conn
  return <Show when={geo() && (!props.foreground || conn.arrow === 'end')}>
    <g class={props.foreground ? 'conn-end' : 'conn'} classList={{ selected: isSelected(conn.id) }} data-collapsed-endpoint={geo()?.collapsed ? 'true' : undefined}
      data-connection-id={props.foreground ? undefined : conn.id} data-connection-end-id={props.foreground ? conn.id : undefined} data-testid={props.foreground ? 'connection-end' : 'connection'}>
      <Show when={!props.foreground}><path class="conn-hit" d={geo()!.d} /></Show>
      <path class="conn-line" stroke-dasharray={geo()!.collapsed ? '6 4' : undefined} d={props.foreground ? geo()!.tail : geo()!.d}
        marker-end={conn.arrow === 'end' ? `url(#${isSelected(conn.id) ? 'dn-arrow-selected' : 'dn-arrow'})` : undefined} />
    </g>
  </Show>
}

/** Bodies stay behind cards; short arrow ends and target anchors sit above
 * columns, below stickers. The foreground layer never receives pointer input. */
export function Connections(props: { geometry: ReturnType<typeof createConnectionGeometry>; foreground?: boolean }) {
  const preview = props.geometry.preview
  return (
    <svg class="connections" classList={{ 'connection-ends': !!props.foreground }} width="1" height="1" aria-hidden="true">
      <Show when={!props.foreground}>
        <defs>
          <marker id="dn-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
          <marker id="dn-arrow-selected" class="conn-arrow-selected" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
      </Show>
      <For each={props.geometry.lines()}>{(line) => <ConnLine line={line} foreground={!!props.foreground} />}</For>
      <Show when={preview() && (!props.foreground || preview()!.target)}>
        <path class="conn-line conn-preview" d={props.foreground ? preview()!.tail : preview()!.d} marker-end="url(#dn-arrow-selected)" data-testid={props.foreground ? 'connection-end-preview' : 'connection-preview'} />
        {/* While hovering a card: its four anchors, with the one it'll snap to lit. */}
        <Show when={props.foreground && preview()!.target}>
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
