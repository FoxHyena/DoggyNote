import { For, Show } from 'solid-js'
import { inkPath, type InkMark } from '@doggynote/core'

/**
 * Strokes as one SVG, scaled from the owner's logical space to whatever box it
 * sits in. Passive: the board never mounts an editor per card. `hit` adds a
 * wider invisible path per stroke, so a mark on the board can be picked up by
 * its line rather than its whole box.
 */
export function InkLayer(props: { strokes: readonly InkMark[]; width: number; height: number; hit?: boolean; draft?: InkMark | null }) {
  return (
    <svg class="ink-layer" classList={{ 'ink-hit': props.hit }} data-testid="ink-layer" viewBox={`0 0 ${props.width} ${props.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <For each={props.strokes}>
        {(s) => (
          <>
            <path data-stroke-id={s.id} d={inkPath(s)} fill="none" stroke={s.color} stroke-width={s.width} stroke-opacity={s.opacity} stroke-linecap="round" stroke-linejoin="round" />
            <Show when={props.hit}>
              <path class="ink-hit-path" d={inkPath(s)} fill="none" stroke="transparent" stroke-width={s.width + 12} stroke-linecap="round" stroke-linejoin="round" />
            </Show>
          </>
        )}
      </For>
      <Show when={props.draft}>
        {(d) => <path data-testid="ink-draft" d={inkPath(d())} fill="none" stroke={d().color} stroke-width={d().width} stroke-opacity={d().opacity} stroke-linecap="round" stroke-linejoin="round" />}
      </Show>
    </svg>
  )
}

/** Draw one stroke on a canvas whose transform already maps the owner's logical space. */
const paths = new WeakMap<InkMark, Path2D>()
export function drawInkStroke(ctx: CanvasRenderingContext2D, stroke: InkMark) {
  let path = paths.get(stroke)
  if (!path) {
    path = new Path2D(inkPath(stroke))
    paths.set(stroke, path)
  }
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.width
  ctx.globalAlpha = stroke.opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(path)
}
