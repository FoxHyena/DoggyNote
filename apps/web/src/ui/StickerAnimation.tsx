import { createEffect, createSignal, onCleanup } from 'solid-js'
import type { AnimationItem } from 'lottie-web'
import type { StickerAsset } from '@doggynote/core'
import { assetUrl } from '../state/api.ts'

/** Only a selected canvas sticker or one large preview plays, for at most two loops.
 * The still remains visible until a transparent frame is ready. No expression engine. */
export function StickerAnimation(props: { sticker: StickerAsset; enabled: boolean; onReady: (ready: boolean) => void }) {
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
  createEffect(() => {
    props.onReady(false)
    if (!props.enabled || reduced() || !visible() || hidden() || props.sticker.format === 'static') return
    let stopped = false, animation: AnimationItem | undefined, video: HTMLVideoElement | undefined
    const controller = new AbortController()
    void (async () => {
      try {
        const url = await assetUrl(props.sticker.assetId, 'full')
        if (stopped) return
        if (props.sticker.format === 'webm') {
          // Chromium's VP9 alpha path is supported. WebKit/Tauri deliberately use
          // the transparent still rather than risking an opaque video rectangle.
          if (!/Chrome|Chromium/.test(navigator.userAgent)) return
          video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'none'; video.crossOrigin = 'anonymous'; video.src = url
          let loops = 0
          video.oncanplay = () => {
            if (stopped || !video) return
            if (!Number.isFinite(video.duration) || video.duration > 3 || video.videoWidth > 512 || video.videoHeight > 512) { video.pause(); props.onReady(false); return }
            // Codec support alone does not guarantee alpha decoding. Keep the still
            // unless an actual decoded frame contains transparent and visible pixels.
            try {
              const probe = document.createElement('canvas'); probe.width = 32; probe.height = 32
              const ctx = probe.getContext('2d', { willReadFrequently: true })!
              ctx.drawImage(video, 0, 0, 32, 32)
              const pixels = ctx.getImageData(0, 0, 32, 32).data
              let transparent = false, painted = false
              for (let i = 3; i < pixels.length; i += 4) { transparent ||= pixels[i] < 16; painted ||= pixels[i] > 32 }
              if (transparent && painted) props.onReady(true)
              else { video.pause(); props.onReady(false) }
            } catch { video.pause(); props.onReady(false) }
          }
          video.onerror = () => props.onReady(false)
          video.onended = () => { if (++loops < 2 && !stopped) void video?.play().catch(() => props.onReady(false)); else props.onReady(false) }
          host.append(video); await video.play()
        } else {
          const [player, response] = await Promise.all([import('lottie-web/build/player/lottie_light_canvas'), fetch(url, { signal: controller.signal, credentials: 'same-origin' })])
          if (!response.ok || stopped) return
          const data = await response.json()
          if (stopped) return
          animation = player.default.loadAnimation({ container: host, renderer: 'canvas', animationData: data, loop: 2, autoplay: true, rendererSettings: { dpr: Math.min(2, devicePixelRatio) } })
          animation.addEventListener('drawnFrame', () => { if (!stopped) props.onReady(true) })
          animation.addEventListener('complete', () => props.onReady(false))
          animation.addEventListener('data_failed', () => props.onReady(false))
          animation.setSubframe(false)
        }
      } catch { if (!stopped) props.onReady(false) }
    })()
    onCleanup(() => { stopped = true; controller.abort(); animation?.destroy(); if (video) { video.pause(); video.removeAttribute('src'); video.load() }; host.replaceChildren(); props.onReady(false) })
  })
  return <div ref={host} class="sticker-animation" aria-hidden="true" />
}
