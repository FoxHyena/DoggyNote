import { createSignal } from 'solid-js'
import { compareVersions } from '@doggynote/core'
import { api } from './api.ts'
import * as doc from './doc.ts'
import { isTauri } from './platform.ts'
import { syncNow } from './sync.ts'
import { endEdit } from './ui.ts'

// Keeping clients current.
// - Desktop: the Tauri updater checks the server's latest.json on launch and
//   every 6 h, downloads in the background, then offers a restart.
// - Browser: polls /api/version; when the server has moved on, offers a reload.
// - Either: if this client is older than the server's minClient, it must update.
// Builds without VITE_APP_VERSION (local dev, test builds) never check.

export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) || 'dev'

type Pending = { kind: 'desktop' | 'web'; version: string }
export const [pendingUpdate, setPendingUpdate] = createSignal<Pending | null>(null)
export const [updateRequired, setUpdateRequired] = createSignal(false)

type DesktopUpdate = { version: string; download(): Promise<void>; install(): Promise<void> }
let desktopUpdate: DesktopUpdate | null = null
let lastWebCheck = 0

async function checkServer() {
  const v = await api<{ version: string; minClient: string }>('/api/version').catch(() => null)
  if (!v) return
  if (compareVersions(APP_VERSION, v.minClient) < 0) setUpdateRequired(true)
  if (!isTauri && v.version !== 'dev' && v.version !== APP_VERSION) setPendingUpdate({ kind: 'web', version: v.version })
}

async function checkDesktop() {
  if (desktopUpdate) return
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return
    await update.download()
    desktopUpdate = update
    setPendingUpdate({ kind: 'desktop', version: update.version })
  } catch (e) {
    console.warn('[doggynote] update check failed', e)
  }
}

export function startUpdateChecks() {
  if (APP_VERSION === 'dev') return
  const run = () => {
    void checkServer()
    if (isTauri) void checkDesktop()
  }
  run()
  setInterval(run, isTauri ? 6 * 3_600_000 : 30 * 60_000)
  window.addEventListener('focus', () => {
    if (Date.now() - lastWebCheck < 5 * 60_000) return
    lastWebCheck = Date.now()
    void checkServer()
  })
}

/** Save everything, then restart into the new version (desktop) or reload (browser). */
export async function applyUpdate() {
  endEdit()
  await doc.flush()
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 3000))])
  if (desktopUpdate) {
    await desktopUpdate.install()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
    return
  }
  location.reload()
}
