import { normalizeSwatchHex } from './swatch.ts'

// WCAG 2 relative luminance and contrast, for picking legible text on colours
// people choose (label chips). DOM-free so the server and tests can use it.

/** Relative luminance (0 black … 1 white) of a `#rgb`/`#rrggbb` colour; null if it isn't one. */
export function relativeLuminance(hex: string): number | null {
  const norm = normalizeSwatchHex(hex)
  if (!norm) return null
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(norm.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a) ?? 0
  const lb = relativeLuminance(b) ?? 0
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export const INK_BLACK = '#000000'
export const INK_WHITE = '#FFFFFF'

/** Black or white, whichever reads better on `background`. Ties go to black. */
export function inkFor(background: string): typeof INK_BLACK | typeof INK_WHITE {
  return contrastRatio(INK_BLACK, background) >= contrastRatio(INK_WHITE, background) ? INK_BLACK : INK_WHITE
}
