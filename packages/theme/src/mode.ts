import type { ThemeName } from './tokens.ts'

export type ThemeMode = 'system' | ThemeName

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
export const THEME_STORAGE_KEY = 'doggynote.theme'

/** The toggle cycles System → Light → Dark → System. */
export function nextMode(mode: ThemeMode): ThemeMode {
  return THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ThemeName {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return mode
}

export function parseMode(raw: string | null | undefined): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'dark'
}
