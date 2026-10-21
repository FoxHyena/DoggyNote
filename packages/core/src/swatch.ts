import type { Card } from './model.ts'

/** Document color, deliberately independent of theme tokens. No color-space conversion. */
export const DEFAULT_SWATCH_HEX = '#2F5D50'

export function normalizeSwatchHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`
  if (/^[\da-f]{3}$/i.test(hex)) return `#${[...hex].map((c) => c + c).join('').toUpperCase()}`
  return null
}

/** Never pass unchecked synced strings to CSS, canvas, search or clipboard. */
export function swatchHex(card: Pick<Card, 'swatchHex'>): string {
  return normalizeSwatchHex(card.swatchHex) ?? DEFAULT_SWATCH_HEX
}

export const swatchText = (value: unknown): string => typeof value === 'string' ? value : ''

export function swatchDescription(card: Pick<Card, 'swatchHex' | 'swatchName' | 'swatchCaption'>): string {
  return [swatchText(card.swatchName), swatchHex(card), swatchText(card.swatchCaption)].filter(Boolean).join('\n')
}

/** Keep drafts short enough for a HEX field but allow unfinished/invalid text to survive restart. */
export function validSwatchFields(card: Record<string, unknown>): boolean {
  return typeof card.swatchHex === 'string' && /^#[\dA-F]{6}$/.test(card.swatchHex)
    && typeof card.swatchName === 'string' && card.swatchName.length <= 1000
    && typeof card.swatchCaption === 'string' && card.swatchCaption.length <= 10_000
    && (card.swatchHexDraft == null || (typeof card.swatchHexDraft === 'string' && card.swatchHexDraft.length <= 100))
}
