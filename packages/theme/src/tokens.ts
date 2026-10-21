// Every colour in the app comes from here. Components read CSS variables
// (`var(--dn-bg)`), never hex values, so the two themes can't drift apart.

export type ThemeName = 'light' | 'dark'

export const SURFACE_TOKENS = [
  'bg', // canvas
  'panel', // toolbar, top bar
  'card',
  'cardHover',
  'border',
  'text',
  'textMuted',
  'accent',
  'accentText', // text drawn on top of `accent`
  'selection',
  'gridDot', // background dots: quiet, but visible
  'scrim', // dims the app behind a phone sheet (translucent)
  'stickerShadow', // hard, offset shadow under placed stickers (translucent)
  'stickerOutline', // the die-cut border drawn around every sticker
] as const

export type SurfaceToken = (typeof SURFACE_TOKENS)[number]

export const surfaces: Record<ThemeName, Record<SurfaceToken, string>> = {
  dark: {
    bg: '#1c1b1a',
    panel: '#242220',
    card: '#2c2a27',
    cardHover: '#34312d',
    border: '#3d3934',
    text: '#ece7e1',
    textMuted: '#a69d93',
    accent: '#e8a849', // golden retriever
    accentText: '#1c1b1a',
    selection: '#e8a849',
    gridDot: '#3d3934',
    scrim: '#0b0a0999',
    stickerShadow: '#00000099',
    stickerOutline: '#ffffff',
  },
  light: {
    bg: '#f3efe9',
    panel: '#fbf9f6',
    card: '#ffffff',
    cardHover: '#f7f3ee',
    border: '#ddd5ca',
    text: '#2a2521',
    textMuted: '#6b6158',
    accent: '#9a5f0c',
    accentText: '#ffffff',
    selection: '#b06c10',
    gridDot: '#d3cabe',
    scrim: '#2a252159',
    stickerShadow: '#2a252129',
    stickerOutline: '#ffffff',
  },
}

// Card colours (column headers, coloured notes). Each has a background and the
// text colour drawn on it, tuned separately per theme.
export const CARD_COLORS = ['none', 'gold', 'collar', 'ball', 'sky', 'lilac', 'peach'] as const
export type CardColor = (typeof CARD_COLORS)[number]
/** A synced colour if it's one of ours, else the fallback: it goes straight into CSS. */
export const cardColor = (c: unknown, fallback: CardColor = 'none'): CardColor =>
  (CARD_COLORS as readonly unknown[]).includes(c) ? (c as CardColor) : fallback

export const cardColors: Record<ThemeName, Record<CardColor, { bg: string; text: string }>> = {
  dark: {
    none: { bg: surfaces.dark.card, text: surfaces.dark.text },
    gold: { bg: '#dcbd62', text: '#2a2208' },
    collar: { bg: '#d9765f', text: '#2b0e07' },
    ball: { bg: '#86b89f', text: '#0f2419' },
    sky: { bg: '#7fa7d1', text: '#0c1c2e' },
    lilac: { bg: '#a99bd6', text: '#1b1430' },
    peach: { bg: '#e6a87c', text: '#2e1607' },
  },
  light: {
    none: { bg: surfaces.light.card, text: surfaces.light.text },
    gold: { bg: '#f4dc8f', text: '#3a2e05' },
    collar: { bg: '#f2b2a2', text: '#4a150a' },
    ball: { bg: '#b9dcc9', text: '#12301f' },
    sky: { bg: '#bcd4ee', text: '#10263f' },
    lilac: { bg: '#d6cdf0', text: '#261b47' },
    peach: { bg: '#f6cfb1', text: '#45200a' },
  },
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

/** CSS custom properties for one theme, e.g. `--dn-bg: #1c1b1a;`. */
export function themeVars(name: ThemeName): string {
  const lines: string[] = []
  for (const k of SURFACE_TOKENS) lines.push(`--dn-${kebab(k)}: ${surfaces[name][k]};`)
  for (const c of CARD_COLORS) {
    lines.push(`--dn-card-${c}-bg: ${cardColors[name][c].bg};`)
    lines.push(`--dn-card-${c}-text: ${cardColors[name][c].text};`)
  }
  return lines.join('\n')
}

/** Full stylesheet: dark on `:root`, light under `[data-theme="light"]`. */
export function themeCss(): string {
  return `:root, :root[data-theme="dark"] {\ncolor-scheme: dark;\n${themeVars('dark')}\n}\n` +
    `:root[data-theme="light"] {\ncolor-scheme: light;\n${themeVars('light')}\n}\n`
}
