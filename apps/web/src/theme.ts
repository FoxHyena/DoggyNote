import { createSignal, onCleanup } from 'solid-js'
import { THEME_STORAGE_KEY, nextMode, parseMode, resolveTheme, themeCss, type ThemeMode } from '@doggynote/theme'

/** The resolved theme in use ('light' | 'dark'), for code that reads colours directly (canvas drawing). */
export const [theme, setTheme] = createSignal<'light' | 'dark'>('dark')

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function readStored(): ThemeMode {
  try {
    return parseMode(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'dark'
  }
}

export function installThemeCss() {
  const style = document.createElement('style')
  style.id = 'dn-theme'
  style.textContent = themeCss()
  document.head.prepend(style)
}

/** Theme mode signal. Applies `data-theme` on <html> and follows the OS while on "system". */
export function createTheme() {
  const [mode, setMode] = createSignal<ThemeMode>(readStored())

  const apply = () => {
    const t = resolveTheme(mode(), media().matches)
    document.documentElement.dataset.theme = t
    setTheme(t)
  }
  apply()

  const mq = media()
  mq.addEventListener('change', apply)
  onCleanup(() => mq.removeEventListener('change', apply))

  const cycle = () => {
    const m = nextMode(mode())
    setMode(m)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, m)
    } catch {
      // Private mode or blocked storage: the toggle still works for this session.
    }
    apply()
  }

  return { mode, cycle }
}
