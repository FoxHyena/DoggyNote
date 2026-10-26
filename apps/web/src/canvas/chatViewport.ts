import { phone } from '../state/device.ts'
import { camera, setCamera, viewport } from '../state/ui.ts'
import { resetPageScroll, visible } from '../state/viewport.ts'
import { rectOf } from './layout.ts'

/** Client-pixel room left by the app chrome, floating tools and software keyboard. */
export function chatRoom() {
  const canvas = viewport(), visual = visible()
  const left = canvas.left + 12, right = Math.min(canvas.left + canvas.width, visual.width) - 12
  const top = Math.max(canvas.top, visual.top) + 12
  let bottom = Math.min(canvas.top + canvas.height, visual.top + visual.height) - 12
  if (phone()) for (const control of document.querySelectorAll<HTMLElement>('.canvas-controls, .mobile-sticker-launcher, .mobile-dock')) {
    const rect = control.getBoundingClientRect()
    if (rect.height && rect.top > top && rect.right > left && rect.left < right) bottom = Math.min(bottom, rect.top - 12)
  }
  return { left, right, top, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

/** Local framing changes only the camera, never shared note dimensions. */
export function frameChat(id: string) {
  const rect = rectOf(id), canvas = viewport()
  if (!rect || canvas.width < 40 || canvas.height < 40) return
  const room = chatRoom(), current = camera()
  const zoom = Math.max(0.36, Math.min(1, Math.max(current.zoom, 0.8), room.width / rect.w, phone() ? room.height / rect.h : 1))
  const clamp = (value: number, start: number, end: number) => start > end ? end : Math.min(end, Math.max(start, value))
  const x = clamp(current.x, rect.x + rect.w - (room.right - canvas.left) / zoom, rect.x - (room.left - canvas.left) / zoom)
  const y = clamp(current.y, rect.y + rect.h - (room.bottom - canvas.top) / zoom, rect.y - (room.top - canvas.top) / zoom)
  setCamera({ x, y, zoom })
}

/** Native focus can scroll overflow-hidden ancestors; the board's camera owns that movement. */
export function resetChatFocusScroll() {
  const canvas = document.querySelector<HTMLElement>('[data-testid="canvas"]')
  if (canvas) { canvas.scrollLeft = 0; canvas.scrollTop = 0 }
  resetPageScroll()
}

export function revealChatComposer(compose: HTMLTextAreaElement) {
  resetChatFocusScroll()
  const room = chatRoom(), current = camera(), field = compose.getBoundingClientRect()
  const bottom = compose.parentElement!.getBoundingClientRect().bottom
  const dy = Math.max(0, bottom - room.bottom)
  const dx = field.left < room.left ? field.left - room.left : Math.max(0, field.right - room.right)
  const next = { ...current, x: current.x + dx / current.zoom, y: current.y + dy / current.zoom }
  if (Math.abs(dx) > 1 || dy > 1) setCamera(next)
  return next
}
