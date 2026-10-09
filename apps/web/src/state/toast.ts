import { createSignal } from 'solid-js'

// One short message at the bottom of the screen ("That file is too big").

export const [toast, setToast] = createSignal<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

export function showToast(message: string, ms = 5000) {
  setToast(message)
  clearTimeout(timer)
  timer = setTimeout(() => setToast(null), ms)
}
