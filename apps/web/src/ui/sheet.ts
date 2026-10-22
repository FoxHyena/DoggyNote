import { phone } from '../state/device.ts'

// Phone sheets (menus, panels, dialogs) can be pulled down to close, from the
// grip along their top edge. Every sheet already closes on Escape or with its
// Close button, so dismissing reuses that instead of knowing each component.

const SHEETS = '.menu, .share-panel, .export-panel, .save-details, .trash, .dialog'
const GRIP = 28
const CLOSE_AT = 80
const SETTLE_MS = 180

export function installSheetDrag() {
  let active: { sheet: HTMLElement; pointerId: number | null; cancel: () => void } | null = null
  const onDown = (e: PointerEvent) => {
    if (!phone() || e.button !== 0 || (active && active.pointerId !== null)) return
    const target = (e.target as Element | null)?.closest<HTMLElement>(SHEETS)
    if (!target) return
    const sheet = target
    const gripY = e.clientY - sheet.getBoundingClientRect().top
    if (gripY < 0 || gripY > GRIP) return
    // Re-grabbing a departing sheet keeps its current position and revokes the
    // previous dismissal. Read before cancelling the old transition.
    const transform = getComputedStyle(sheet).transform
    const initialY = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42
    active?.cancel()
    const original = { transform: sheet.style.transform, transition: sheet.style.transition }
    const startY = e.clientY
    let last = { y: startY, t: performance.now() }
    let speed = 0
    let dragging = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const session = { sheet, pointerId: e.pointerId as number | null, cancel: cleanup }
    const observer = new MutationObserver(() => { if (!sheet.isConnected) cleanup() })

    function release() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      sheet.removeEventListener('lostpointercapture', cancel)
      sheet.removeEventListener('touchmove', preventScroll)
      session.pointerId = null
      if (sheet.hasPointerCapture(e.pointerId)) sheet.releasePointerCapture(e.pointerId)
    }
    function cleanup() {
      release()
      clearTimeout(timer)
      observer.disconnect()
      sheet.removeEventListener('transitionend', ended)
      sheet.style.transition = original.transition
      sheet.style.transform = original.transform
      if (active === session) active = null
    }
    let closing = false
    function finish() {
      cleanup()
      if (closing && sheet.isConnected) dismiss(sheet)
    }
    function ended(ev: TransitionEvent) {
      if (ev.target === sheet && ev.propertyName === 'transform') finish()
    }
    function settle(close: boolean) {
      release()
      closing = close
      if (!sheet.isConnected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish()
      sheet.addEventListener('transitionend', ended)
      sheet.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
      sheet.style.transform = close ? 'translateY(100%)' : 'translateY(0px)'
      // A fallback for an unchanged transform or a browser-suppressed event.
      timer = setTimeout(finish, SETTLE_MS + 50)
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      if (!dragging && Math.abs(ev.clientY - startY) < 6) return
      if (!dragging) {
        dragging = true
        // Synthetic cancellation tests have no native pointer to capture.
        try { sheet.setPointerCapture(e.pointerId) } catch { /* no active native pointer */ }
      }
      ev.preventDefault()
      const dy = Math.max(0, initialY + ev.clientY - startY)
      const now = performance.now()
      speed = (ev.clientY - last.y) / Math.max(1, now - last.t)
      last = { y: ev.clientY, t: now }
      sheet.style.transform = `translateY(${dy}px)`
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      if (!dragging && initialY === 0) return cleanup()
      const dy = Math.max(0, initialY + ev.clientY - startY)
      settle(dragging && (dy > CLOSE_AT || speed > 0.6))
    }
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      if (dragging || initialY !== 0) settle(false)
      else cleanup()
    }
    // Claim only a grip-origin gesture. The body of the sheet still scrolls.
    const preventScroll = (ev: TouchEvent) => ev.preventDefault()

    active = session
    observer.observe(document.body, { childList: true, subtree: true })
    sheet.getAnimations().forEach((animation) => animation.cancel())
    sheet.style.transition = 'none'
    sheet.style.transform = `translateY(${initialY}px)`
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    sheet.addEventListener('lostpointercapture', cancel)
    sheet.addEventListener('touchmove', preventScroll, { passive: false })
  }
  document.addEventListener('pointerdown', onDown, true)
  return () => {
    document.removeEventListener('pointerdown', onDown, true)
    active?.cancel()
  }
}

function dismiss(sheet: HTMLElement) {
  if (!sheet.isConnected) return
  const close = sheet.querySelector<HTMLElement>('[data-sheet-close], [aria-label^="Close"], [title="Close"], [data-testid$="-close"]')
  if (close) close.click()
  else (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  // A sheet that stayed (nothing closed it) springs back.
  requestAnimationFrame(() => {
    if (sheet.isConnected) sheet.style.transform = ''
  })
}
