import { createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { agentDialogKeys } from './agentDialog.ts'
import './popover.css'

/**
 * A small panel that drops down from the button that opened it, instead of a
 * full-screen dialog. Clicking outside or Escape closes it and returns focus.
 */
export function Popover(props: { anchor: HTMLElement; label: string; testid?: string; class?: string; close: () => void; children: JSX.Element }) {
  let panel!: HTMLDivElement
  const [pos, setPos] = createSignal({ left: 0, top: 0 })
  const place = () => {
    const a = props.anchor.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    const left = Math.min(Math.max(8, a.left + a.width / 2 - p.width / 2), innerWidth - p.width - 8)
    // Below the button, or above it when the window runs out.
    const top = a.bottom + 6 + p.height <= innerHeight - 8 ? a.bottom + 6 : Math.max(8, a.top - 6 - p.height)
    setPos({ left, top })
  }
  onMount(() => {
    place()
    const ro = new ResizeObserver(place)
    ro.observe(panel)
    // Content may focus its own field first (e.g. the HEX input); otherwise the first control.
    if (!panel.contains(document.activeElement)) [...panel.querySelectorAll<HTMLElement>('input, select, textarea, button')].find((el) => el.tabIndex >= 0)?.focus({ preventScroll: true })
    const outside = (e: PointerEvent) => { if (!panel.contains(e.target as Node) && !props.anchor.contains(e.target as Node)) props.close() }
    // A field marked data-local-escape (e.g. an inline rename) cancels itself first.
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as Element | null)?.closest?.('[data-local-escape]')) { e.preventDefault(); e.stopPropagation(); props.close() } }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', place)
    onCleanup(() => {
      ro.disconnect()
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', place)
      queueMicrotask(() => { if (props.anchor.isConnected) props.anchor.focus({ preventScroll: true }) })
    })
  })
  return <Portal>
    <div ref={panel} class={`popover ${props.class ?? ''}`} role="dialog" aria-label={props.label} data-testid={props.testid} style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
      onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { agentDialogKeys(e); if (e.key !== 'Escape' && !e.metaKey && !e.ctrlKey) e.stopPropagation() }}>
      {props.children}
    </div>
  </Portal>
}
