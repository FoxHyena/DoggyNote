import { For, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import type { PackSticker } from '../state/stickers.ts'

/** Window the artwork, not just its paint: offscreen tiles have no image/decoder.
 * One extra row/column on each side keeps scrolling smooth. A held or focused
 * tile stays mounted even if scrolling moves it outside that window. */
export function StickerGrid(props: {
  stickers: PackSticker[]
  horizontal?: boolean
  initialScroll?: { x: number; y: number }
  ref?: (el: HTMLDivElement) => void
  focusRef?: (focus: ((assetId: string) => void) | undefined) => void
  onScroll?: () => void
  children: (sticker: PackSticker) => JSX.Element
}) {
  let scroll!: HTMLDivElement, grid!: HTMLDivElement
  let tabDirection = 0
  const [geometry, setGeometry] = createSignal({ width: 320, height: 342, x: 0, y: 0, size: 74, gap: 8, rowGap: 8 })
  const [held, setHeld] = createSignal<string | null>(null), [focused, setFocused] = createSignal<string | null>(null)
  const measure = () => {
    const style = getComputedStyle(scroll), gridStyle = getComputedStyle(grid)
    const width = scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const height = scroll.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    const gap = parseFloat(gridStyle.columnGap) || 0, rowGap = parseFloat(gridStyle.rowGap) || 0
    const size = props.horizontal ? parseFloat(gridStyle.getPropertyValue('--sticker-tile-size')) || 80 : (width - gap * 3) / 4
    const next = { width, height, x: scroll.scrollLeft, y: scroll.scrollTop, size: Math.max(1, size), gap, rowGap }
    setGeometry((old) => Object.keys(next).every((k) => old[k as keyof typeof old] === next[k as keyof typeof next]) ? old : next)
  }
  const columns = () => props.horizontal ? 1 : 4
  const stride = () => geometry().size + (props.horizontal ? geometry().gap : geometry().rowGap)
  const total = () => Math.ceil(props.stickers.length / columns())
  const extent = () => Math.max(0, total() * stride() - (props.horizontal ? geometry().gap : geometry().rowGap))
  const items = createMemo(() => {
    const g = geometry(), count = columns(), offset = props.horizontal ? g.x : g.y, room = props.horizontal ? g.width : g.height
    const first = Math.max(0, Math.floor(offset / stride()) - 1) * count
    const end = Math.min(props.stickers.length, (Math.ceil((offset + room) / stride()) + 1) * count)
    return props.stickers.filter((s, i) => (i >= first && i < end) || s.assetId === held() || s.assetId === focused())
  })
  const position = (s: PackSticker) => {
    const index = props.stickers.indexOf(s), row = Math.floor(index / columns()), col = index % columns()
    return { left: `${props.horizontal ? row * stride() : col * (geometry().size + geometry().gap)}px`, top: `${props.horizontal ? 0 : row * stride()}px`, width: `${geometry().size}px`, height: `${geometry().size}px` }
  }
  const assetAt = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-sticker-asset]')?.dataset.stickerAsset ?? null : null
  const focusSticker = (index: number) => {
    const sticker = props.stickers[index]
    if (!sticker) return
    setFocused(sticker.assetId)
    const g = geometry(), start = Math.floor(index / columns()) * stride(), end = start + g.size
    const offset = props.horizontal ? g.x : g.y, room = props.horizontal ? g.width : g.height
    const next = start < offset ? start : end > offset + room ? end - room : offset
    if (props.horizontal) scroll.scrollLeft = next
    else scroll.scrollTop = next
    measure()
    grid.querySelector<HTMLButtonElement>(`[data-sticker-asset="${sticker.assetId}"]`)?.focus({ preventScroll: true })
  }
  const key = (e: KeyboardEvent) => {
    const asset = assetAt(e.target), index = props.stickers.findIndex((s) => s.assetId === asset)
    if (index < 0 || e.altKey || e.metaKey || e.ctrlKey) return
    const step = e.key === 'Tab' ? e.shiftKey ? -1 : 1
      : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1
      : e.key === 'ArrowDown' ? columns() : e.key === 'ArrowUp' ? -columns() : 0
    let next = e.key === 'Home' ? 0 : e.key === 'End' ? props.stickers.length - 1 : index + step
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    const direction = e.key === 'End' ? -1 : e.key === 'Home' ? 1 : Math.sign(step)
    while (next >= 0 && next < props.stickers.length && !props.stickers[next].available) next += direction
    // At either end, let Tab leave the grid normally.
    if (next < 0 || next >= props.stickers.length) { if (e.key !== 'Tab') e.preventDefault(); return }
    e.preventDefault()
    focusSticker(next)
  }
  const focusIn = (e: FocusEvent) => {
    // Tab entering a virtual window must still begin/end at the full list's
    // boundary, just as it did when every offscreen button was mounted.
    if (tabDirection && !grid.contains(e.relatedTarget as Node | null)) {
      let index = tabDirection > 0 ? 0 : props.stickers.length - 1
      while (index >= 0 && index < props.stickers.length && !props.stickers[index].available) index += tabDirection
      focusSticker(index)
    } else setFocused(assetAt(e.target))
  }
  onMount(() => {
    props.ref?.(scroll)
    measure()
    if (props.initialScroll) {
      scroll.scrollLeft = props.initialScroll.x; scroll.scrollTop = props.initialScroll.y
      measure()
    }
    props.focusRef?.((assetId) => focusSticker(props.stickers.findIndex((s) => s.assetId === assetId)))
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    const release = () => queueMicrotask(() => setHeld(null))
    const tabDown = (e: KeyboardEvent) => { tabDirection = e.key === 'Tab' ? e.shiftKey ? -1 : 1 : 0 }
    const tabUp = () => { tabDirection = 0 }
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release)
    window.addEventListener('keydown', tabDown, true); window.addEventListener('keyup', tabUp, true)
    onCleanup(() => {
      props.focusRef?.(undefined); observer.disconnect()
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release)
      window.removeEventListener('keydown', tabDown, true); window.removeEventListener('keyup', tabUp, true)
    })
  })
  createEffect(() => { props.horizontal; if (scroll && grid) measure() })
  return <div class="sticker-scroll" ref={scroll} onScroll={() => { measure(); props.onScroll?.() }}>
    <div class="sticker-grid sticker-virtual-grid" ref={grid} role="list" aria-label="Sticker artwork" data-sticker-count={props.stickers.length}
      style={{ width: props.horizontal ? `${extent()}px` : '100%', height: `${props.horizontal ? geometry().size : extent()}px` }}
      onPointerDown={(e) => setHeld(assetAt(e.target))} onKeyDown={key}
      onFocusIn={focusIn} onFocusOut={(e) => { if (!grid.contains(e.relatedTarget as Node | null)) setFocused(null) }}>
      <For each={items()}>{(s) => <div class="sticker-virtual-cell" style={position(s)} role="listitem" aria-setsize={props.stickers.length} aria-posinset={props.stickers.indexOf(s) + 1}>{props.children(s)}</div>}</For>
    </div>
  </div>
}
