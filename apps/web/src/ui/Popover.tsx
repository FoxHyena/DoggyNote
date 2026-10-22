import { createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { agentDialogKeys } from './agentDialog.ts'
import './popover.css'
import { placeFloating } from './floatingPlacement.ts'
import type { Rect } from '@doggynote/core'

/**
 * A small panel anchored to the thing it edits (a card, a button), instead of a
 * full-screen dialog. It sits below the anchor, or above it when the window runs
 * out. Clicking outside or Escape closes it and returns focus to the anchor.
 * A field marked `data-local-escape` handles its own Escape first.
 * `follow` is a reactive source to re-place on, e.g. the camera for a card.
 * `align: 'start'` lines it up with the anchor's left edge instead of its centre.
 */
export function Popover(props: { anchor: () => HTMLElement; label: string; testid?: string; class?: string; close: () => void; follow?: () => unknown; align?: 'center' | 'start'; avoid?: () => Rect[]; children: JSX.Element }) {
  let panel!: HTMLDivElement
  const [pos, setPos] = createSignal({ left: 0, top: 0 })
  const place = () => {
    if (!panel) return
    const a = props.anchor().getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    const want = props.align === 'start' ? a.left : a.left + a.width / 2 - p.width / 2
    const left = Math.min(Math.max(8, want), innerWidth - p.width - 8)
    // The part of the screen above the keyboard, if one is up.
    const vv = window.visualViewport
    const viewTop = vv?.offsetTop ?? 0
    const viewBottom = viewTop + (vv?.height ?? innerHeight)
    const below = a.bottom + 8 + p.height <= viewBottom - 8
    const top = below ? a.bottom + 8 : Math.max(viewTop + 8, Math.min(a.top - 8 - p.height, viewBottom - 8 - p.height))
    const avoid = props.avoid?.()
    const at = avoid ? placeFloating({ width: p.width, height: p.height }, { x: 8, y: viewTop + 8, w: innerWidth - 16, h: viewBottom - viewTop - 16 }, [
      { x: left, y: top }, { x: left, y: below ? a.top - 8 - p.height : a.bottom + 8 },
      { x: a.right + 8, y: a.top }, { x: a.left - 8 - p.width, y: a.top },
    ], avoid) : { x: left, y: top }
    setPos({ left: at.x, top: at.y })
  }
  createEffect(on(() => props.follow?.(), () => requestAnimationFrame(place), { defer: true }))
  onMount(() => {
    place()
    const ro = new ResizeObserver(place)
    ro.observe(panel)
    // The content may focus its own field first, or mark one `data-autofocus`; otherwise the first control.
    if (!panel.contains(document.activeElement)) (panel.querySelector<HTMLElement>('[data-autofocus]') ?? [...panel.querySelectorAll<HTMLElement>('input, select, textarea, button')].find((el) => el.tabIndex >= 0))?.focus({ preventScroll: true })
    const outside = (e: PointerEvent) => {
      if (!panel.contains(e.target as Node) && !props.anchor().contains(e.target as Node)) props.close()
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || (e.target as Element | null)?.closest?.('[data-local-escape]')) return
      e.preventDefault()
      e.stopPropagation()
      props.close()
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    onCleanup(() => {
      ro.disconnect()
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      // Back to the anchor, unless the click that closed it focused something else.
      queueMicrotask(() => {
        const active = document.activeElement
        if ((!active || active === document.body || panel.contains(active)) && props.anchor().isConnected) props.anchor().focus({ preventScroll: true })
      })
    })
  })
  return (
    <Portal>
      <div
        ref={panel}
        class={`popover ${props.class ?? ''}`}
        role="dialog"
        aria-label={props.label}
        data-testid={props.testid}
        style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => agentDialogKeys(e)}
      >
        {props.children}
      </div>
    </Portal>
  )
}
