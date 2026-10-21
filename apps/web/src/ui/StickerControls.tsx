import { Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { stickerRingRadius, usableSticker, worldToScreen, type Sticker } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { armedSticker, cancelStickerPlacement, duplicateSticker, reorderSticker, placeSticker, stickerGhost, stickerCenter, STICKER_TOUCH_OFFSET } from '../state/stickers.ts'
import { boardId, camera, select, selection, viewport } from '../state/ui.ts'
import { phone, touch } from '../state/device.ts'
import { trashSelection } from '../state/actions.ts'
import { contains } from '@doggynote/core'
import { rectOf } from '../canvas/layout.ts'
import { viewStickerPack } from './StickerTray.tsx'
import { StickerImage } from './StickerImage.tsx'
import { Icon, ToolIcons } from './icons.tsx'
import { manipulatingSticker } from '../canvas/StickerLayer.tsx'

// One selected sticker: a compact bar of icon actions just above its ring (a bottom sheet on phones).
// Turning and resizing belong to the ring itself (drag it, or use the arrow keys while it has focus).
export function StickerControls() {
  const [barSize, setBarSize] = createSignal({ width: 420, height: 46 })
  const selected = createMemo(() => {
    if (selection().size !== 1) return null
    const o = doc.get([...selection()][0])
    return usableSticker(o) && !o.deletedAt && !o.purged ? o : null
  })
  const underneath = (s: Sticker) => {
    const point = stickerCenter(s)
    const card = [...doc.cardsOn(boardId())].sort((a, b) => b.z - a.z).find((c) => { const r = rectOf(c.id); return r && contains(r, point) })
    if (card) select([card.id])
  }
  // Float above the ring (below it when there's no room), centred and kept on screen.
  const pos = createMemo(() => {
    const s = selected(), v = viewport(), cam = camera()
    if (!s) return { left: v.width / 2, top: 12 }
    const c = stickerCenter(s), r = stickerRingRadius(s, cam.zoom)
    const top = worldToScreen(cam, { x: c.x, y: c.y - r }).y, bottom = worldToScreen(cam, { x: c.x, y: c.y + r }).y, x = worldToScreen(cam, c).x
    const bar = barSize(), half = Math.min(bar.width, v.width - 16) / 2
    let y = top - bar.height - 12
    if (y < 8) y = Math.min(bottom + 12, v.height - bar.height - 8)
    return { left: Math.min(Math.max(x, half + 8), Math.max(half + 8, v.width - half - 8)), top: Math.max(8, Math.min(y, v.height - bar.height - 8)) }
  })
  // Icons on the floating bar; the phone sheet adds a short label, always part of the accessible name.
  const action = (label: string, short: string, icon: JSX.Element, run: () => void, title = label) =>
    <button class="bar-btn sticker-bar-btn" aria-label={label} title={title} onClick={run}><Icon size={18}>{icon}</Icon><span class="sticker-bar-label" aria-hidden="true">{short}</span></button>
  return <>
    <Show when={armedSticker()}><div class="sticker-placement" role="status" data-testid="sticker-placement"><StickerImage sticker={armedSticker()!} /><span>Tap your board to place</span><button class="bar-btn" onClick={() => { placeSticker(armedSticker()!); queueMicrotask(() => document.querySelector<HTMLElement>('[data-testid="sticker-controls"]')?.focus({ preventScroll: true })) }}>Place at center</button><button class="bar-btn" onClick={cancelStickerPlacement}>Cancel</button></div></Show>
    <Show when={stickerGhost()}><div class="sticker-ghost" data-testid="sticker-ghost" style={{ left: `${stickerGhost()!.at.x}px`, top: `${stickerGhost()!.at.y - (stickerGhost()!.touch ? STICKER_TOUCH_OFFSET : 0)}px` }}><StickerImage sticker={stickerGhost()!.sticker} /></div></Show>
    <Show when={selected() && !armedSticker() && !manipulatingSticker()}>
      <div ref={(el) => {
        // The phone launcher sits above the sheet, so it publishes its height.
        const o = new ResizeObserver(() => { setBarSize({ width: el.offsetWidth, height: el.offsetHeight }); document.documentElement.style.setProperty('--dn-sticker-sheet', `${el.offsetHeight}px`) })
        o.observe(el); onCleanup(() => o.disconnect())
      }}
        class="sticker-controls" classList={{ 'selection-bar': !phone(), 'sticker-controls-sheet': phone(), 'sticker-controls-touch': touch() }}
        style={phone() ? undefined : { left: `${pos().left}px`, top: `${pos().top}px` }}
        data-testid="sticker-controls" role="group" tabindex="-1" aria-label="Sticker controls"
        onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}>
        <div class="sticker-bar-actions">
          {action('Forward', 'Forward', ToolIcons.forward(), () => reorderSticker(selected()!, 1), 'Bring forward')}
          {action('Backward', 'Back', ToolIcons.backward(), () => reorderSticker(selected()!, -1), 'Send backward')}
          {action('Select underneath', 'Under', ToolIcons.layers(), () => underneath(selected()!), 'Select the card underneath')}
          <div class="bar-sep" />
          {action('View pack', 'Pack', ToolIcons.sticker(), () => viewStickerPack(selected()!.content.packName))}
          {action('Duplicate', 'Duplicate', ToolIcons.duplicate(), () => duplicateSticker(selected()!))}
          {action('Bury', 'Bury', ToolIcons.trash(), trashSelection, `Move to ${COPY.trash} (Delete)`)}
        </div>
      </div>
    </Show>
  </>
}

