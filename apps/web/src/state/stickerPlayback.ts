import { createEffect, createRoot, createSignal, on, type Accessor } from 'solid-js'
import { phone } from './device.ts'
import { camera } from './ui.ts'

// Animated stickers loop while they're on screen, but only this many play at once.
// The rest wait on their still and start, in order, as slots free up.
const limit = () => phone() ? 6 : 12
type Claim = { granted: Accessor<boolean>; set: (on: boolean) => void; priority: boolean }
const playing = new Set<Claim>(), waiting: Claim[] = []

function pump() {
  while (waiting.length && playing.size < limit()) {
    const next = waiting.shift()!
    playing.add(next); next.set(true)
  }
}

/** A slot to play in. A priority claim (the tray's large preview) never waits. Release it when playback ends. */
export function claimPlayback(priority = false): { granted: Accessor<boolean>; release(): void } {
  const [granted, set] = createSignal(false)
  const claim: Claim = { granted, set, priority }
  if (priority || playing.size < limit()) { playing.add(claim); set(true) }
  else waiting.push(claim)
  return {
    granted,
    release() {
      playing.delete(claim)
      const at = waiting.indexOf(claim)
      if (at >= 0) waiting.splice(at, 1)
      set(false); pump()
    },
  }
}

/** For tests: how many players hold a slot. */
export const playbackCount = () => playing.size

// Paused by this viewer, this session only. Never synced: pausing can't change anyone's board.
const [paused, setPaused] = createSignal<ReadonlySet<string>>(new Set())
export const playbackPaused = (key: string) => paused().has(key)
export function togglePlayback(key: string) {
  const next = new Set(paused())
  if (!next.delete(key)) next.add(key)
  setPaused(next)
}

// Panning and zooming only move the world div (rule 3). Players hold their frame while the
// camera moves, so pan stays smooth, and carry on once it has been still for a moment.
const [moving, setMoving] = createSignal(false)
export const cameraMoving = moving
createRoot(() => {
  let rest: ReturnType<typeof setTimeout> | undefined
  createEffect(on(camera, () => {
    setMoving(true); clearTimeout(rest)
    rest = setTimeout(() => setMoving(false), 200)
  }, { defer: true }))
})
