import { createSignal } from 'solid-js'

// The part of the window the user can actually see. On phones the on-screen
// keyboard shrinks the visual viewport (and iOS may scroll it), while the
// layout stays put. Fixed bars that must sit on the keyboard use --vv-bottom.

export type Visible = { top: number; height: number; width: number; bottom: number }

const vv = window.visualViewport
const read = (): Visible => {
  const top = vv?.offsetTop ?? 0
  const height = vv?.height ?? innerHeight
  return { top, height, width: vv?.width ?? innerWidth, bottom: Math.max(0, innerHeight - top - height) }
}

export const [visible, setVisible] = createSignal<Visible>(read(), {
  equals: (a, b) => a.top === b.top && a.height === b.height && a.width === b.width && a.bottom === b.bottom,
})

let frame = 0
function update() {
  frame = 0
  const v = read()
  setVisible(v)
  if (document.documentElement.classList.contains('ios-standalone')) {
    document.documentElement.style.setProperty('--app-height', `${Math.round(innerHeight)}px`)
  }
  document.documentElement.style.setProperty('--vv-bottom', `${Math.round(v.bottom)}px`)
  document.documentElement.style.setProperty('--vv-height', `${Math.round(v.height)}px`)
  keepFieldInView()
}

// Phone sheets sit on the keyboard (mobile.css, --vv-bottom) and scroll inside
// themselves. The field being typed in, with its form's confirm button, scrolls
// into view within its sheet; the page itself never scrolls. Focus stays
// wherever the tap put it, so iOS still raises the keyboard.
const SHEETS = '.menu, .nav-menu, .share-panel, .export-panel, .save-details, .popover, .trash, .dialog'
const sheetField = () => {
  const el = document.activeElement
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && el.closest(SHEETS) ? el : null
}
function keepFieldInView() {
  const field = sheetField()
  if (!field) return
  ;(field.closest('form') ?? field).scrollIntoView({ block: 'nearest', inline: 'nearest' })
  resetPageScroll()
}
const schedule = () => (frame ||= requestAnimationFrame(update))
vv?.addEventListener('resize', schedule)
vv?.addEventListener('scroll', schedule)
window.addEventListener('resize', schedule)
window.addEventListener('pageshow', schedule)
document.addEventListener('focusin', () => { if (sheetField()) requestAnimationFrame(keepFieldInView) })
window.addEventListener('scroll', () => { if (sheetField()) resetPageScroll() })
update()

/** iOS sometimes scrolls the page to show a focused field; the app never scrolls, so undo it. */
export function resetPageScroll() {
  if (scrollX || scrollY) scrollTo(0, 0)
}
