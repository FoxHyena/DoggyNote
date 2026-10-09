import { createSignal } from 'solid-js'
import { isTauri } from './platform.ts'

// Snap-to-grid: a per-device preference, like the theme.

const KEY = 'doggynote.snap'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export const [snapToGrid, setSnapSignal] = createSignal(read())

export function toggleSnap() {
  const next = !snapToGrid()
  setSnapSignal(next)
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    // storage unavailable: still works for this session
  }
}

let lastTick = 0
/** A light trackpad "tick" when a dragged edge lands on a new grid point (desktop only). */
export function snapTick() {
  if (!isTauri) return
  const now = performance.now()
  if (now - lastTick < 35) return
  lastTick = now
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke(cmd: string): Promise<unknown> } }).__TAURI_INTERNALS__
  void internals?.invoke('haptic').catch(() => undefined)
}
