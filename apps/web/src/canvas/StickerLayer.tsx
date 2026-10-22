import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import { LOD_ZOOM, STICKER_MAX, STICKER_MIN, defaultStickerWidth, normalizeAngle, cullRect, intersects, stickerBounds, stickerGroupRing, stickerHeight, stickerLocal, stickerRingRadius, transformStickerGroup, viewRect, type Sticker, type Vec } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { boardId, camera, select, selection, viewport } from '../state/ui.ts'
import { exporting } from '../state/export.ts'
import { stickerCenter } from '../state/stickers.ts'
import { playbackPaused } from '../state/stickerPlayback.ts'
import { Icon, ToolIcons } from '../ui/icons.tsx'
import { StickerImage, stickerAlphaHit } from '../ui/StickerImage.tsx'

export const [manipulatingSticker, setManipulatingSticker] = createSignal<string | null>(null)

/** How far the current group has turned, so its grip follows. Starts over with each new selection. */
export const [groupTurn, setGroupTurn] = createSignal(0)

/** The selected stickers share one ring: around the sticker itself, or around the whole group. */
export type StickerRing = { ids: string[]; center: Vec; radius: number; grip: number; single: Sticker | null }
export function selectionRing(): StickerRing | null {
  const list = doc.stickersOn(boardId()).filter((s) => selection().has(s.id)), zoom = camera().zoom
  if (!list.length) return null
  if (list.length === 1) { const s = list[0]; return { ids: [s.id], center: stickerCenter(s), radius: stickerRingRadius(s, zoom), grip: s.angle, single: s } }
  const g = stickerGroupRing(list)
  return { ids: list.map((s) => s.id), center: g.center, radius: g.radius + 10 / zoom, grip: groupTurn(), single: null }
}

/**
 * Keyboard turning and resizing on the focused ring: left/right turn, up/down resize, Shift for
 * bigger steps. A burst of presses previews live and lands as one undo step, after a pause or on blur.
 */
let keyEdit: { key: string; ids: string[]; snap: Record<string, Partial<Sticker>>; timer: ReturnType<typeof setTimeout> } | null = null
function commitRingKeys() {
  if (!keyEdit) return
  clearTimeout(keyEdit.timer); doc.commitFrom(keyEdit.snap); doc.unmarkBusy(keyEdit.ids); keyEdit = null
}
function ringKey(e: KeyboardEvent, ring: StickerRing) {
  const turn = { ArrowLeft: -1, ArrowRight: 1 }[e.key], grow = { ArrowDown: -1, ArrowUp: 1 }[e.key]
  // Any other key (such as Undo) first lands the burst, so it acts on a committed step.
  // Modifiers alone don't: Shift+arrow sends a Shift keydown first.
  if (!turn && !grow) return ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) ? undefined : commitRingKeys()
  e.preventDefault(); e.stopPropagation()
  const key = ring.ids.join(' ')
  if (keyEdit?.key !== key) {
    commitRingKeys()
    keyEdit = { key, ids: ring.ids, snap: Object.fromEntries(ring.ids.map((id) => [id, doc.snapshot(id, ['w', 'x', 'y', 'angle']) as Partial<Sticker>])), timer: 0 as unknown as ReturnType<typeof setTimeout> }
    doc.markBusy(ring.ids)
  }
  clearTimeout(keyEdit.timer); keyEdit.timer = setTimeout(commitRingKeys, 1500)
  const degrees = (turn ?? 0) * (e.shiftKey ? 15 : 1), step = (grow ?? 0) * (e.shiftKey ? 10 : 1)
  const s = ring.single
  if (!s) {
    // A group turns about its center and grows its ring by the same steps.
    const list = ring.ids.map((id) => doc.get(id) as Sticker), g = stickerGroupRing(list)
    const next = transformStickerGroup(list, g.center, g.radius ? (g.radius + step) / g.radius : 1, degrees)
    for (const id of ring.ids) doc.transient(id, next[id])
    if (degrees) setGroupTurn(groupTurn() + degrees)
    return
  }
  if (turn) return doc.transient(s.id, { angle: normalizeAngle(s.angle + degrees) })
  const max = Math.min(STICKER_MAX, STICKER_MAX * s.content.width / s.content.height)
  const w = Math.max(STICKER_MIN, Math.min(max, s.w + step))
  const center = stickerCenter(s), h = w * s.content.height / s.content.width
  doc.transient(s.id, { w, x: center.x - w / 2, y: center.y - h / 2 })
}

/** Straight and back to a fresh sticker's size, about the same center. */
function resetSticker(s: Sticker) {
  const w = defaultStickerWidth(s), h = w * s.content.height / s.content.width, c = stickerCenter(s)
  doc.update({ [s.id]: { angle: 0, w, x: c.x - w / 2, y: c.y - h / 2 } })
}
const changed = (s: Sticker) => Math.round(s.angle) !== 0 || Math.abs(s.w - defaultStickerWidth(s)) >= 1

export function stickerAt(point: Vec, touch = false): Sticker | undefined {
  return [...doc.stickersOn(boardId())].sort((a, b) => b.z - a.z || b.id.localeCompare(a.id)).find((s) => {
    const local = stickerLocal(s, point)
    return stickerAlphaHit(s.content.assetId, local.x, local.y, touch ? 7 / (camera().zoom * s.w) : 0, touch ? 7 / (camera().zoom * stickerHeight(s)) : 0)
  })
}

/** Geometric ring picking also works when a webview retargets thin SVG strokes. */
export function stickerRingAt(point: Vec, touch = false): StickerRing | undefined {
  const ring = selectionRing(), zoom = camera().zoom
  if (!ring) return undefined
  const distance = Math.hypot(point.x - ring.center.x, point.y - ring.center.y)
  return Math.abs(distance - ring.radius) <= (touch ? 14 : 9) / zoom ? ring : undefined
}

export function StickerLayer(props: { readOnly: boolean }) {
  const cull = createMemo(() => {
    const c = camera(), v = viewport(), step = 2 ** Math.round(Math.log2(256 / c.zoom))
    return cullRect(viewRect(c, v.width, v.height), 160 / c.zoom, step)
  }, undefined, { equals: (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h })
  const ring = createMemo(selectionRing)
  createEffect(on(selection, () => setGroupTurn(0), { defer: true }))
  const visible = createMemo(() => doc.stickersOn(boardId()).filter((s) => exporting() || intersects(stickerBounds(s), cull())).sort((a, b) => a.z - b.z || a.id.localeCompare(b.id)))
  return <div class="sticker-layer" data-testid="sticker-layer">
    <For each={exporting() || camera().zoom >= LOD_ZOOM ? visible() : []}>{(s) => <div class="placed-sticker" data-sticker-id={s.id} data-testid="placed-sticker" classList={{ selected: selection().has(s.id) && !props.readOnly }} style={{ left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${stickerHeight(s)}px` }}>
      <div class="sticker-rotation" style={{ transform: `rotate(${s.angle}deg)` }}>
        <div class="sticker-visual"><StickerImage sticker={s.content} animate={camera().zoom >= LOD_ZOOM && !exporting() && !playbackPaused(s.id)} /></div>
      </div>
      <button class="sticker-accessible-pick" aria-label={`Select ${s.content.emoji || 'sticker'} from ${s.content.packName}`} onFocus={() => { if (!props.readOnly) select([s.id]) }} onClick={() => { if (!props.readOnly) select([s.id]) }} disabled={props.readOnly} />
    </div>}</For>
    <div class="sticker-selection-layer">
      <Show when={!props.readOnly && !exporting() && ring()}>{(r) => {
        const diameter = () => r().radius * 2
        const gripAngle = () => (r().grip - 45) * Math.PI / 180
        return <><svg class="sticker-transform-ring" data-testid="sticker-ring" data-ring={r().single ? 'single' : 'group'} viewBox={`0 0 ${diameter()} ${diameter()}`} style={{ left: `${r().center.x - r().radius}px`, top: `${r().center.y - r().radius}px`, width: `${diameter()}px`, height: `${diameter()}px`, '--sticker-ui-scale': String(1 / camera().zoom) }}>
          <circle class="sticker-ring-line" cx={r().radius} cy={r().radius} r={r().radius} />
          <circle class="sticker-ring-hit" data-sticker-handle="transform" data-sticker-target={r().ids.join(' ')} data-testid="sticker-transform" cx={r().radius} cy={r().radius} r={r().radius} tabindex="0" role="button"
            aria-label={r().single ? 'Turn and resize sticker' : `Turn and resize ${r().ids.length} stickers`} aria-description="Left and right arrows turn, up and down resize. Hold Shift for bigger steps."
            onKeyDown={(e) => ringKey(e, r())} onBlur={commitRingKeys}><title>{r().single ? 'Drag anywhere on the circle to turn and resize. Drag the sticker itself to move.' : 'Drag the circle to turn and resize them together. Drag any of them to move them all.'}</title></circle>
          <circle class="sticker-ring-grip" cx={r().radius * (1 + Math.cos(gripAngle()))} cy={r().radius * (1 + Math.sin(gripAngle()))} r={9 / camera().zoom} />
        </svg>
        {/* A turned or resized sticker offers a way back, at the ring's top-left. */}
        <Show when={r().single && changed(r().single!) && r().single}>{(s) =>
          <button class="sticker-ring-reset" aria-label="Reset size and rotation" title="Reset size and rotation" data-testid="sticker-reset"
            style={{ left: `${r().center.x - r().radius * Math.SQRT1_2}px`, top: `${r().center.y - r().radius * Math.SQRT1_2}px`, '--sticker-ui-scale': String(1 / camera().zoom) }}
            onPointerDown={(e) => e.stopPropagation()} onClick={() => resetSticker(s())}><Icon size={16}>{ToolIcons.restore()}</Icon></button>
        }</Show>
        </>
      }}</Show>
    </div>
  </div>
}
