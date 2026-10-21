import { For } from 'solid-js'
import { inkPath, isInkMark, sortedInkStrokes, type InkMark } from '@doggynote/core'

/** A passive viewport; a board of images never mounts per-card editors. */
export function InkLayer(props: { strokes: readonly InkMark[]; width: number; height: number; preserveAspectRatio?: 'none' | 'xMidYMid meet' }) {
  return <svg class="ink-layer" data-testid="ink-layer" viewBox={`0 0 ${props.width} ${props.height}`} preserveAspectRatio={props.preserveAspectRatio ?? 'none'} aria-hidden="true" style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', 'pointer-events': 'none', overflow: 'hidden' }}>
    <For each={sortedInkStrokes(props.strokes.filter(isInkMark))}>{(s) => <path data-stroke-id={s.id} d={inkPath(s)} fill="none" stroke={s.color} stroke-width={s.width} stroke-opacity={s.opacity} stroke-linecap="round" stroke-linejoin="round" />}</For>
  </svg>
}

/** Caller supplies the logical-to-canvas transform, including any letterboxing. */
export function drawInkStroke(ctx: CanvasRenderingContext2D, stroke: InkMark) {
  if (!isInkMark(stroke)) return
  ctx.save()
  ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.globalAlpha = stroke.opacity
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(inkPath(stroke)))
  ctx.restore()
}
