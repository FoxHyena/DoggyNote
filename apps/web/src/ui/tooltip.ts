// One shared tooltip for icon buttons (`data-tip`). Native `title` tooltips are slow,
// easy to miss and don't appear in the desktop app's web view at all.

let tip: HTMLDivElement | null = null
let timer = 0
let current: HTMLElement | null = null
// Right after one tooltip hides, the next shows at once, like native toolbars.
let warmUntil = 0

function hide() {
  clearTimeout(timer)
  if (tip) warmUntil = performance.now() + 500
  current = null
  tip?.remove()
  tip = null
}

function show(el: HTMLElement) {
  const text = el.dataset.tip
  if (!text || !el.isConnected) return
  tip ??= Object.assign(document.createElement('div'), { className: 'dn-tooltip', role: 'tooltip' })
  tip.textContent = text
  document.body.append(tip)
  const r = el.getBoundingClientRect()
  // A control that just unmounted or collapsed has no place to point at.
  if (!r.width && !r.height) { hide(); return }
  const t = tip.getBoundingClientRect()
  const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8)
  // Above the button, or below it when there's no room.
  const top = r.top - t.height - 6 >= 8 ? r.top - t.height - 6 : r.bottom + 6
  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
}

export function installTooltips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null
    if (el === current) return
    hide()
    if (!el) return
    current = el
    if (performance.now() < warmUntil) show(el)
    else timer = window.setTimeout(() => show(el), 150)
  }, true)
  for (const type of ['pointerdown', 'keydown', 'wheel', 'blur'] as const) window.addEventListener(type, hide, true)
}
