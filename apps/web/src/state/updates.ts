import { createSignal } from 'solid-js'
import { compareVersions } from '@doggynote/core'
import { api } from './api.ts'
import { isTauri } from './platform.ts'
import { saveBeforeLeaving } from './lifecycle.ts'

// Keeping clients current.
// - Desktop: the Tauri updater checks the server's latest.json, downloads in
//   the background, then offers a restart.
// - Browser: polls /api/version; when the server has moved on, offers a reload.
// - Both check on launch, every 30 min, and on coming back to the window (at
//   most every 5 min). macOS suspends timers in a hidden app, so a Mac app left
//   open for days relies on the return check.
// - Either: if this client is older than the server's minClient, it must update.
// Builds without VITE_APP_VERSION (local dev, test builds) never check.

export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) || 'dev'

type Pending = { kind: 'desktop' | 'web'; version: string }
export const [pendingUpdate, setPendingUpdate] = createSignal<Pending | null>(null)
export const [updateRequired, setUpdateRequired] = createSignal(false)

type DesktopUpdate = { version: string; download(): Promise<void>; install(): Promise<void> }
let desktopUpdate: DesktopUpdate | null = null
let checkingDesktop = false
let lastCheck = 0

async function checkServer() {
  const v = await api<{ version: string; minClient: string }>('/api/version').catch(() => null)
  if (!v) return
  if (compareVersions(APP_VERSION, v.minClient) < 0) setUpdateRequired(true)
  if (!isTauri && v.version !== 'dev' && v.version !== APP_VERSION) setPendingUpdate({ kind: 'web', version: v.version })
}

async function checkDesktop() {
  if (desktopUpdate || checkingDesktop) return
  checkingDesktop = true
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return
    await update.download()
    desktopUpdate = update
    setPendingUpdate({ kind: 'desktop', version: update.version })
  } catch (e) {
    console.warn('[doggynote] update check failed', e)
  } finally {
    checkingDesktop = false
  }
}

export function startUpdateChecks() {
  if (APP_VERSION === 'dev') return
  const run = () => {
    lastCheck = Date.now()
    void checkServer()
    if (isTauri) void checkDesktop()
  }
  run()
  setInterval(run, 30 * 60_000)
  const onReturn = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck >= 5 * 60_000) run()
  }
  window.addEventListener('focus', onReturn)
  document.addEventListener('visibilitychange', onReturn)
}

/** Save everything, then restart into the new version (desktop) or reload (browser). */
export async function applyUpdate() {
  await saveBeforeLeaving()
  if (desktopUpdate) {
    await desktopUpdate.install()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
    return
  }
  location.reload()
}
