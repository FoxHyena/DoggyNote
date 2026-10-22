// A dog moment: buried cards sink into the Buried bones button, which gives a little bump.
// Only copies animate, on top of the page, so the canvas and its cards never get a transform.

const MAX_GHOSTS = 8
const SINK_MS = 380
const STAGGER_MS = 30

type Ghost = { el: HTMLElement; cx: number; cy: number; scale: number }

/** Copy the on-screen cards about to be buried. Call the result once they're gone. */
export function prepareBuryMotion(ids: Iterable<string>): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}
  const ghosts: Ghost[] = []
  for (const id of ids) {
    if (ghosts.length >= MAX_GHOSTS) break
    const sel = CSS.escape(id)
    const src = document.querySelector<HTMLElement>(`[data-card-id="${sel}"], [data-sticker-id="${sel}"]`)
    // Canvases don't survive a copy; below the low-detail zoom there's no DOM card at all.
    if (!src || !src.offsetWidth || src.querySelector('canvas')) continue
    const r = src.getBoundingClientRect()
    if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) continue
    const el = src.cloneNode(true) as HTMLElement
    for (const n of [el, ...el.querySelectorAll<HTMLElement>('[id], [data-testid], [data-card-id], [data-sticker-id]')]) {
      n.removeAttribute('id')
      n.removeAttribute('data-testid')
      n.removeAttribute('data-card-id')
      n.removeAttribute('data-sticker-id')
    }
    // Selection chrome stays behind: only the card itself goes in the hole.
    for (const n of el.querySelectorAll('.resize-handle, .connect-handle')) n.remove()
    el.classList.remove('selected', 'editing', 'dragging', 'resizing')
    el.classList.add('bury-ghost')
    el.setAttribute('aria-hidden', 'true')
    el.inert = true
    const w = src.offsetWidth
    const h = src.offsetHeight
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const scale = r.width / w
    Object.assign(el.style, { position: 'fixed', left: `${cx - w / 2}px`, top: `${cy - h / 2}px`, width: `${w}px`, height: `${h}px`, transform: `scale(${scale})` })
    ghosts.push({ el, cx, cy, scale })
  }

  return () => {
    const target = [...document.querySelectorAll<HTMLElement>('[data-testid="tool-trash"]')].find((t) => t.offsetWidth > 0)
    const t = target?.getBoundingClientRect()
    ghosts.forEach((g, i) => {
      document.body.append(g.el)
      // No button on screen (read-only, hidden dock): sink straight down instead.
      const dx = t ? t.left + t.width / 2 - g.cx : 0
      const dy = t ? t.top + t.height / 2 - g.cy : 120
      const sink = g.el.animate(
        [
          { transform: `scale(${g.scale})`, opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(${g.scale * 0.08}) rotate(-12deg)`, opacity: 0.3 },
        ],
        { duration: SINK_MS, delay: i * STAGGER_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
      )
      sink.onfinish = sink.oncancel = () => g.el.remove()
    })
    const icon = target?.querySelector<SVGElement>('svg')
    if (!icon) return
    icon.style.transformOrigin = 'center'
    icon.animate(
      [{ transform: 'none' }, { transform: 'scale(1.22) rotate(-8deg)', offset: 0.4 }, { transform: 'none' }],
      { duration: 360, delay: ghosts.length ? SINK_MS - 60 + (ghosts.length - 1) * STAGGER_MS : 0, easing: 'ease-out' },
    )
  }
}
