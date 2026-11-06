import type { Vec } from '@doggynote/core'

const active = new Set<Animation>()
export function cancelBoardMoveMotion() { for (const animation of active) animation.cancel(); active.clear() }

/** Only inert copies move; canvas geometry never acquires animation transforms. */
export function prepareBoardMoveMotion(ids: readonly string[], target: Vec): () => void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  const ghosts: { el: HTMLElement; rect: DOMRect }[] = []
  const addStack = (at: DOMRect) => {
    const el = document.createElement('div')
    el.className = 'board-move-stack'
    el.textContent = `${ids.length} ${ids.length === 1 ? 'item' : 'items'}`
    ghosts.push({ el, rect: new DOMRect(at.x + at.width / 2 - 36, at.y + at.height / 2 - 27, 72, 54) })
  }
  for (const id of ids) {
    if (ghosts.length === 8) break
    const src = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"], [data-sticker-id="${CSS.escape(id)}"]`)
    if (!src) continue
    const rect = src.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight) continue
    if (ids.length > 8 || src.querySelector('canvas')) { addStack(rect); break }
    const el = src.cloneNode(true) as HTMLElement
    for (const n of [el, ...el.querySelectorAll<HTMLElement>('*')]) {
      for (const a of [...n.attributes]) if (a.name === 'id' || a.name.startsWith('data-') || a.name.startsWith('aria-')) n.removeAttribute(a.name)
    }
    for (const n of el.querySelectorAll('.resize-handle, .connect-handle, input, textarea')) n.remove()
    el.classList.remove('selected', 'editing', 'dragging', 'resizing')
    // Render into the screen-sized box; compensate for zoom without changing the original.
    Object.assign(el.style, { width: `${src.offsetWidth}px`, height: `${src.offsetHeight}px` })
    ghosts.push({ el, rect })
  }
  return () => {
    for (const { el, rect } of ghosts) {
      el.classList.add('board-move-ghost'); el.inert = true; el.setAttribute('aria-hidden', 'true')
      const width = parseFloat(el.style.width) || rect.width, height = parseFloat(el.style.height) || rect.height
      const sx = rect.width / width, sy = rect.height / height
      Object.assign(el.style, { left: `${rect.x + rect.width / 2 - width / 2}px`, top: `${rect.y + rect.height / 2 - height / 2}px`, width: `${width}px`, height: `${height}px` })
      document.body.append(el)
      const dx = target.x - rect.x - rect.width / 2, dy = target.y - rect.y - rect.height / 2
      const animation = el.animate([
        { transform: `scale(${sx}, ${sy})`, opacity: 1 },
        { transform: reduce.matches ? `scale(${sx}, ${sy})` : `translate(${dx}px, ${dy}px) scale(${sx * 0.12}, ${sy * 0.12})`, opacity: 0 },
      ], { duration: reduce.matches ? 120 : 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' })
      active.add(animation)
      const cleanup = () => { active.delete(animation); el.remove(); reduce.removeEventListener('change', reduced); window.removeEventListener('pagehide', cancel) }
      const reduced = () => { animation.finish() }
      const cancel = () => { animation.cancel() }
      animation.onfinish = animation.oncancel = cleanup
      reduce.addEventListener('change', reduced); window.addEventListener('pagehide', cancel, { once: true })
    }
  }
}
