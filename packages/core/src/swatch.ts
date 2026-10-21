import type { Card } from './model.ts'

// Colour cards. The swatch colour is document data that people pick, so it is
// deliberately independent of the theme: it reads the same in light and dark.

export const DEFAULT_SWATCH_HEX = '#2F5D50'

/**
 * The quick picks in a colour card's panel: two rows of seven, the last slot
 * being the custom picker. Any other colour comes from the picker or the HEX field.
 */
export const SWATCH_PRESETS = [
  '#E5484D', '#F76B15', '#FFC53D', '#46A758', '#2F5D50', '#0090FF', '#3E63DD',
  '#8E4EC6', '#D6409F', '#8D6E63', '#1C1C1C', '#8B8D98', '#FFFFFF',
] as const

/** `#abc`, `ABCDEF`, ` #aabbcc ` → `#AABBCC`. Anything else is null. */
export function normalizeSwatchHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`
  if (/^[\da-f]{3}$/i.test(hex)) return `#${[...hex].map((c) => c + c).join('').toUpperCase()}`
  return null
}

/** The colour to draw. Synced data from other devices: never hand an unchecked string to CSS or a canvas. */
export function swatchHex(card: Pick<Card<'swatch'>, 'content'>): string {
  return normalizeSwatchHex(card.content?.hex) ?? DEFAULT_SWATCH_HEX
}

export function swatchName(card: Pick<Card<'swatch'>, 'content'>): string {
  const name = card.content?.name
  return typeof name === 'string' ? name : ''
}
