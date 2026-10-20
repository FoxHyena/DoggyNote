import { createSignal } from 'solid-js'

// Add to Home Screen. Android (Chrome) offers an install prompt we can show
// from our own button; iOS only installs from Safari's Share menu.

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<unknown> }

let deferred: InstallPrompt | null = null
export const [canPrompt, setCanPrompt] = createSignal(false)

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as InstallPrompt
  setCanPrompt(true)
})
window.addEventListener('appinstalled', () => setCanPrompt(false))

/** Already running from the home screen. */
export const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export const isIOS = /iP(hone|ad|od)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export async function promptInstall() {
  const p = deferred
  if (!p) return
  deferred = null
  setCanPrompt(false)
  await p.prompt()
  await p.userChoice.catch(() => undefined)
}
