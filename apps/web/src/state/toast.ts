import { createSignal } from 'solid-js'

// One short message at the bottom of the screen ("That file is too big"),
// optionally with one action ("Undo").

export type ToastAction = { label: string; run: () => void }

export const [toast, setToast] = createSignal<string | null>(null)
export const [toastAction, setToastAction] = createSignal<ToastAction | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

export function showToast(message: string, ms = 5000, action: ToastAction | null = null) {
  setToast(message)
  setToastAction(action)
  clearTimeout(timer)
  timer = setTimeout(() => {
    setToast(null)
    setToastAction(null)
  }, ms)
}
