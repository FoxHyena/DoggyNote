import { describe, expect, it } from 'vitest'
import { CARD_COLORS, cardColors, contrast, nextMode, parseMode, resolveTheme, surfaces, themeCss } from './index.ts'

const THEMES = ['dark', 'light'] as const

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })

  for (const t of THEMES) {
    const s = surfaces[t]
    it(`${t}: body text clears 4.5:1 on canvas, panel and card`, () => {
      for (const bg of [s.bg, s.panel, s.card, s.cardHover]) expect(contrast(s.text, bg)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${t}: muted text clears 4.5:1 on card`, () => {
      expect(contrast(s.textMuted, s.card)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(s.textMuted, s.bg)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${t}: accent text clears 4.5:1 on accent`, () => {
      expect(contrast(s.accentText, s.accent)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${t}: grid dots are subtle but visible on the canvas (1.25–2.2:1)`, () => {
      const c = contrast(s.gridDot, s.bg)
      expect(c).toBeGreaterThanOrEqual(1.25)
      expect(c).toBeLessThanOrEqual(2.2)
    })
    it(`${t}: selection outline clears 3:1 on canvas`, () => {
      expect(contrast(s.selection, s.bg)).toBeGreaterThanOrEqual(3)
    })
    for (const c of CARD_COLORS) {
      it(`${t}: ${c} card text clears 4.5:1`, () => {
        expect(contrast(cardColors[t][c].text, cardColors[t][c].bg)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('theme mode', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextMode('system')).toBe('light')
    expect(nextMode('light')).toBe('dark')
    expect(nextMode('dark')).toBe('system')
  })
  it('resolves system from the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })
  it('defaults unknown stored values to dark', () => {
    expect(parseMode(null)).toBe('dark')
    expect(parseMode('purple')).toBe('dark')
    expect(parseMode('system')).toBe('system')
  })
})

describe('themeCss', () => {
  it('emits every token for both themes', () => {
    const css = themeCss()
    expect(css).toContain('[data-theme="light"]')
    expect(css.match(/--dn-bg:/g)).toHaveLength(2)
    expect(css.match(/--dn-card-collar-text:/g)).toHaveLength(2)
  })
})
