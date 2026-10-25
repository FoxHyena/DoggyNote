import { createEffect, onCleanup, onMount } from 'solid-js'
import { phone } from '../state/device.ts'

type Sample = { y: number; t: number }
type Drag = { id: number; start: number; base: number; moved: boolean; samples: Sample[] }

/** Only the grip owns dragging; the rest of a sheet keeps native touch scrolling. */
export function SheetGrip(props: { onDismiss: () => void; disabled?: boolean }) {
  let grip!: HTMLDivElement
  let sheet: HTMLElement | undefined
  let drag: Drag | undefined
  let animation: Animation | undefined
  let version = 0
  let closing = false
  let original: { transform: string; opacity: string; animation: string; transition: string }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')

  const freeze = () => {
    if (!sheet) return { y: 0, opacity: '1' }
    const style = getComputedStyle(sheet)
    const y = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42
    const opacity = style.opacity
    version++
    animation?.cancel()
    animation = undefined
    // Cancel the CSS entrance too, after reading its presentation values.
    sheet.getAnimations().forEach((a) => a.cancel())
    sheet.style.animation = 'none'
    sheet.style.transition = 'none'
    sheet.style.transform = `translateY(${y}px)`
    sheet.style.opacity = opacity
    return { y, opacity }
  }

  const release = () => {
    const id = drag?.id
    drag = undefined
    if (id !== undefined && grip.hasPointerCapture(id)) grip.releasePointerCapture(id)
  }

  const reset = () => {
    version++
    release()
    animation?.cancel()
    animation = undefined
    closing = false
    if (sheet && original) {
      sheet.style.transform = original.transform
      sheet.style.opacity = original.opacity
      sheet.style.transition = original.transition
      sheet.style.animation = original.animation
    }
  }

  const settle = (dismiss: boolean) => {
    if (!sheet?.isConnected) return
    const from = freeze()
    const token = version
    closing = dismiss
    const target = dismiss ? sheet.getBoundingClientRect().height : 0
    const finish = () => {
      if (token !== version || !sheet?.isConnected) return
      sheet.style.transform = `translateY(${target}px)`
      sheet.style.opacity = '1'
      animation?.cancel()
      animation = undefined
      closing = false
      if (dismiss && !props.disabled && phone()) {
        props.onDismiss()
        // An owner may refuse dismissal while it finishes a task.
        queueMicrotask(() => { if (token === version && sheet?.isConnected) settle(false) })
      } else {
        sheet.style.transform = original.transform
        sheet.style.opacity = original.opacity
        sheet.style.transition = original.transition
      }
    }
    if (reduce.matches) return finish()
    animation = sheet.animate([
      { transform: `translateY(${from.y}px)`, opacity: from.opacity },
      { transform: `translateY(${target}px)`, opacity: 1 },
    ], { duration: 180, easing: 'ease-out', fill: 'forwards' })
    animation.onfinish = finish
  }

  const down = (event: PointerEvent) => {
    if (!phone() || props.disabled || event.button !== 0 || drag || !sheet) return
    event.preventDefault()
    event.stopPropagation()
    const from = freeze()
    closing = false
    drag = { id: event.pointerId, start: event.clientY, base: from.y, moved: false, samples: [{ y: event.clientY, t: performance.now() }] }
    // Synthetic WebKit pointer input cannot be captured; real pointers can.
    try { grip.setPointerCapture(event.pointerId) } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
    }
  }
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id || !sheet) return
    const delta = event.clientY - drag.start
    if (!drag.moved && Math.abs(delta) < 6) return
    drag.moved = true
    event.preventDefault()
    const now = performance.now()
    drag.samples = drag.samples.filter((sample) => now - sample.t <= 100)
    drag.samples.push({ y: event.clientY, t: now })
    sheet.style.transform = `translateY(${Math.max(0, drag.base + delta)}px)`
  }
  const up = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    const now = performance.now()
    const recent = drag.samples.filter((sample) => now - sample.t <= 100)
    const first = recent[0]
    const velocity = first ? (event.clientY - first.y) / Math.max(1, now - first.t) : 0
    const offset = Math.max(0, drag.base + event.clientY - drag.start)
    const dismiss = drag.moved && velocity >= -0.6 && (offset > 80 || velocity > 0.6)
    release()
    settle(dismiss)
  }
  const cancel = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    release()
    settle(false)
  }

  createEffect(() => { if (!phone() || props.disabled) reset() })
  onMount(() => {
    sheet = grip.parentElement!
    original = { transform: sheet.style.transform, opacity: sheet.style.opacity, animation: sheet.style.animation, transition: sheet.style.transition }
    sheet.dataset.phoneSheet = ''
    const preference = () => { if (reduce.matches && animation) settle(closing) }
    window.addEventListener('pointermove', move, { capture: true, passive: false })
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
    grip.addEventListener('lostpointercapture', cancel)
    reduce.addEventListener('change', preference)
    onCleanup(() => {
      reset()
      sheet?.removeAttribute('data-phone-sheet')
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
      grip.removeEventListener('lostpointercapture', cancel)
      reduce.removeEventListener('change', preference)
    })
  })
  return <div ref={grip} class="sheet-grip" data-testid="sheet-grip" aria-hidden="true" onPointerDown={down} />
}
