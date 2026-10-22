import { createEffect, createMemo, createRoot, createSignal, onCleanup } from 'solid-js'
import type { AnimationItem } from 'lottie-web'
import type { StickerAsset } from '@doggynote/core'
import { assetUrl } from '../state/api.ts'
import { cameraMoving, claimPlayback } from '../state/stickerPlayback.ts'
import { playWebm } from './webmAlpha.ts'

/** Whether this engine's <video> keeps WebM alpha. Learned from the first decoded frames, then reused. */
let nativeAlpha: boolean | undefined

/** Loops while it's on screen and holds a playback slot. No expression engine.
 * The still remains visible until a transparent frame is ready, and whenever playback can't start. */
export function StickerAnimation(props: { sticker: StickerAsset; enabled: boolean; priority?: boolean; onReady: (ready: boolean) => void }) {
  let host!: HTMLDivElement
  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)')
  const [reduced, setReduced] = createSignal(reduceQuery.matches), [visible, setVisible] = createSignal(false), [hidden, setHidden] = createSignal(document.hidden)
  const change = () => setReduced(reduceQuery.matches), visibility = () => setHidden(document.hidden)
  reduceQuery.addEventListener('change', change); document.addEventListener('visibilitychange', visibility)
  onCleanup(() => { reduceQuery.removeEventListener('change', change); document.removeEventListener('visibilitychange', visibility); props.onReady(false) })
  createEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(host); onCleanup(() => observer.disconnect())
  })
  // Synced rows arrive as fresh objects; only new artwork restarts playback.
  const artwork = createMemo(() => props.sticker, undefined, { equals: (a, b) => a.assetId === b.assetId && a.format === b.format })
  createEffect(() => {
    props.onReady(false)
    const sticker = artwork()
    if (!props.enabled || reduced() || !visible() || hidden() || sticker.format === 'static') return
    const slot = claimPlayback(props.priority)
    onCleanup(() => slot.release())
    // New players start once the camera is still; one already playing just holds its frame.
    const start = createMemo<boolean>((started) => started || (slot.granted() && !cameraMoving()), false)
    createEffect(() => { if (start()) play(sticker) })
  })

  function play(sticker: StickerAsset) {
    let stopped = false, animation: AnimationItem | undefined, video: HTMLVideoElement | undefined
    const controller = new AbortController()
    const ready = (on: boolean) => { if (!stopped) props.onReady(on) }
    const size = () => Math.min(512, Math.ceil(Math.max(host.clientWidth, host.clientHeight, 64) * Math.min(2, devicePixelRatio)))
    const fetchBytes = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' })
      return response.ok ? response : null
    }
    // WebKit drops WebM alpha: decode the colour and alpha streams ourselves.
    const decoded = async (url: string) => {
      const response = await fetchBytes(url)
      if (!response || stopped) return
      const bytes = await response.arrayBuffer()
      if (stopped) return
      const canvas = document.createElement('canvas')
      host.append(canvas)
      if (!await playWebm(bytes, canvas, size(), controller.signal, () => ready(true), () => ready(false), cameraMoving)) { canvas.remove(); ready(false) }
    }
    const native = (url: string) => new Promise<boolean>((resolve) => {
      const v = video = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = url
      const probe = document.createElement('canvas'); probe.width = probe.height = 32
      const ctx = probe.getContext('2d', { willReadFrequently: true })!
      let frames = 0, settled = false
      const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok) } }
      // Any see-through pixel in the first few frames means alpha survived decoding.
      const check = () => {
        if (stopped || settled) return
        try {
          ctx.clearRect(0, 0, 32, 32); ctx.drawImage(v, 0, 0, 32, 32)
          const pixels = ctx.getImageData(0, 0, 32, 32).data
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 250) { nativeAlpha = true; ready(true); return settle(true) }
        } catch { return settle(false) }
        if (++frames >= 3) { nativeAlpha = false; return settle(false) }
        next()
      }
      // Media events, not frame callbacks: the video stays invisible until it proves transparent.
      const next = () => v.addEventListener('timeupdate', check, { once: true })
      v.addEventListener('loadeddata', check, { once: true })
      v.onerror = () => settle(false)
      host.append(v)
      v.play().catch(() => settle(false))
    })
    void (async () => {
      try {
        const url = await assetUrl(sticker.assetId, 'full')
        if (stopped) return
        if (sticker.format === 'webm') {
          if (nativeAlpha !== false && await native(url)) {
            const held = video!
            createRoot((dispose) => { createEffect(() => { if (cameraMoving()) held.pause(); else void held.play().catch(() => {}) }); controller.signal.addEventListener('abort', dispose) })
            return
          }
          if (stopped) return
          if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = undefined }
          await decoded(url)
        } else {
          const [player, response] = await Promise.all([import('lottie-web/build/player/lottie_light_canvas'), fetchBytes(url)])
          if (!response || stopped) return
          const data = await response.json()
          if (stopped) return
          animation = player.default.loadAnimation({ container: host, renderer: 'canvas', animationData: data, loop: true, autoplay: true, rendererSettings: { dpr: Math.min(2, devicePixelRatio) } })
          animation.addEventListener('drawnFrame', () => ready(true))
          animation.addEventListener('data_failed', () => ready(false))
          animation.setSubframe(false)
          const held = animation
          createRoot((dispose) => { createEffect(() => { if (cameraMoving()) held.pause(); else held.play() }); controller.signal.addEventListener('abort', dispose) })
        }
      } catch { ready(false) }
    })()
    onCleanup(() => { stopped = true; controller.abort(); animation?.destroy(); if (video) { video.pause(); video.removeAttribute('src'); video.load() }; host.replaceChildren(); props.onReady(false) })
  }
  return <div ref={host} class="sticker-animation" aria-hidden="true" />
}
