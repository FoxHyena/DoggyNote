import { createSignal } from 'solid-js'

// What the user is touching the app with, and how much room there is.
// `html[data-input]` drives touch-only CSS: it follows the last pointer, so an
// iPad with a trackpad switches back and forth.

type Input = 'touch' | 'mouse'

const initial: Input = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse'
export const [inputMode, setInputMode] = createSignal<Input>(initial)
document.documentElement.dataset.input = initial

window.addEventListener(
  'pointerdown',
  (e) => {
    const next: Input = e.pointerType === 'touch' ? 'touch' : 'mouse'
    if (next === inputMode()) return
    setInputMode(next)
    document.documentElement.dataset.input = next
  },
  { capture: true, passive: true },
)

export const touch = () => inputMode() === 'touch'

/** Phone layout: narrow, or a phone on its side. Matches `--phone` in mobile.css. */
const PHONE = '(max-width: 599px), (pointer: coarse) and (max-height: 500px)'
const phoneQuery = matchMedia(PHONE)
export const [phone, setPhone] = createSignal(phoneQuery.matches)
phoneQuery.addEventListener('change', (e) => setPhone(e.matches))

const PATTERNS = { tick: 4, lift: 12, drop: 8, success: [10, 40, 10] } as const

/** A short buzz on phones that have one (Android; iOS has no web vibration). */
export function haptic(kind: keyof typeof PATTERNS) {
  if (!touch()) return
  try {
    navigator.vibrate?.(PATTERNS[kind] as number | number[])
  } catch {
    // not allowed before a user gesture; harmless
  }
}
