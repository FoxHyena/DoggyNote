import { createEffect, onCleanup, type Accessor } from 'solid-js'

/** Small popovers share keyboard dismissal, focus restoration and arrow navigation. */
export function installMenu(open: Accessor<boolean>, close: () => void, root: () => HTMLElement, trigger: () => HTMLButtonElement) {
  createEffect(() => {
    if (!open()) return
    queueMicrotask(() => { if (open()) root().querySelector<HTMLButtonElement>('.menu button:not(:disabled)')?.focus() })
    const outside = (e: PointerEvent) => { if (!root().contains(e.target as Node)) close() }
    const focusOutside = (e: FocusEvent) => { if (!root().contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); trigger().focus() }
      else if (!root().contains(e.target as Node)) return
      else if ((e.target as Element)?.closest('[role="radio"]')) return
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); e.stopImmediatePropagation()
        const items = [...root().querySelectorAll<HTMLButtonElement>('.menu button:not(:disabled)')]
        const i = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? (e.key === 'ArrowUp' ? items.length - 1 : 0) : (i + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
        items[next]?.focus()
      } else if (['Enter',' ','Backspace','Delete'].includes(e.key)) { if (e.key === 'Backspace' || e.key === 'Delete') e.preventDefault(); e.stopPropagation() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)
    window.addEventListener('keydown', key, true)
    onCleanup(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); window.removeEventListener('keydown', key, true) })
  })
}
