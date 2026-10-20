import { phone } from '../state/device.ts'

// Phone sheets (menus, panels, dialogs) can be pulled down to close, from the
// grip along their top edge. Every sheet already closes on Escape or with its
// Close button, so dismissing reuses that instead of knowing each component.

const SHEETS = '.menu, .share-panel, .export-panel, .save-details, .trash, .dialog'
const GRIP = 28
const CLOSE_AT = 80

export function installSheetDrag() {
  const onDown = (e: PointerEvent) => {
    if (!phone() || e.button !== 0) return
    const sheet = (e.target as Element | null)?.closest<HTMLElement>(SHEETS)
    if (!sheet || e.clientY - sheet.getBoundingClientRect().top > GRIP) return
    const startY = e.clientY
    let last = { y: startY, t: performance.now() }
    let speed = 0
    let dragging = false
    const move = (ev: PointerEvent) => {
      const dy = Math.max(0, ev.clientY - startY)
      if (!dragging && dy < 6) return
      dragging = true
      const now = performance.now()
      speed = (ev.clientY - last.y) / Math.max(1, now - last.t)
      last = { y: ev.clientY, t: now }
      sheet.style.transition = 'none'
      sheet.style.transform = `translateY(${dy}px)`
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!dragging) return
      const dy = ev.clientY - startY
      sheet.style.transition = 'transform 180ms ease-out'
      if (dy > CLOSE_AT || speed > 0.6) {
        sheet.style.transform = 'translateY(100%)'
        setTimeout(() => dismiss(sheet), 120)
      } else sheet.style.transform = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  document.addEventListener('pointerdown', onDown, true)
  return () => document.removeEventListener('pointerdown', onDown, true)
}

function dismiss(sheet: HTMLElement) {
  const close = sheet.querySelector<HTMLElement>('[data-sheet-close], [aria-label^="Close"], [title="Close"], [data-testid$="-close"]')
  if (close) close.click()
  else (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  // A sheet that stayed (nothing closed it) springs back.
  requestAnimationFrame(() => {
    if (sheet.isConnected) sheet.style.transform = ''
  })
}
