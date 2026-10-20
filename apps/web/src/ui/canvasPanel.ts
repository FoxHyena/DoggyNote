import { createEffect, onCleanup, type Accessor } from 'solid-js'

/** Modeless canvas panels dismiss with Escape and return focus to their opener. */
export function installCanvasPanel(open: Accessor<boolean>, close: () => void, root: () => HTMLElement | undefined, opener: () => HTMLElement | null) {
  createEffect(() => {
    if (!open()) return
    const previousFocus = (document.activeElement && document.activeElement !== document.body ? document.activeElement : opener()) as HTMLElement | null
    queueMicrotask(() => { const r = root(); (r?.querySelector<HTMLElement>('textarea') ?? r?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true }) })
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      const focusedPanel = document.activeElement?.closest('.trash')
      if (focusedPanel && focusedPanel !== root()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', key, true)
    onCleanup(() => {
      window.removeEventListener('keydown', key, true)
      queueMicrotask(() => { if (previousFocus?.isConnected) previousFocus.focus() })
    })
  })
}
