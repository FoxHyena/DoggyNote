import { describe, expect, it } from 'vitest'
import { CARD_COLORS, cardColor, cardColorVars, cardColors, contrast, customText, nextMode, normalizeHex, parseMode, resolveTheme, surfaces, themeCss } from './index.ts'

const THEMES = ['dark', 'light'] as const

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })

  for (const t of THEMES) {
    const s = surfaces[t]
    it(`${t}: collaborator labels and outlines are readable`, () => {
      for (const color of [s.personSky, s.personBall, s.personLilac, s.personCollar, s.personGold, s.personPeach]) {
        expect(contrast(s.personInk, color)).toBeGreaterThanOrEqual(4.5)
        for (const bg of [s.bg, s.card]) expect(contrast(color, bg)).toBeGreaterThanOrEqual(3)
      }
    })
    it(`${t}: body text clears 4.5:1 on canvas, panel and card`, () => {
      for (const bg of [s.bg, s.panel, s.card, s.cardHover]) expect(contrast(s.text, bg)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${t}: muted text clears 4.5:1 on card`, () => {
      expect(contrast(s.textMuted, s.card)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(s.textMuted, s.bg)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${t}: inline error text clears 4.5:1 on panel, card and hovered rows`, () => {
      for (const bg of [s.panel, s.card, s.cardHover, s.bg]) expect(contrast(s.errorText, bg)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${t}: accent text clears 4.5:1 on accent`, () => {
      expect(contrast(s.accentText, s.accent)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${t}: grid dots are subtle but visible on the canvas (1.25–2.2:1)`, () => {
      const c = contrast(s.gridDot, s.bg)
      expect(c).toBeGreaterThanOrEqual(1.25)
      expect(c).toBeLessThanOrEqual(2.2)
    })
    it(`${t}: the sheet scrim dims without blacking out`, () => {
      const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/.exec(s.scrim)
      expect(m).not.toBeNull()
      const alpha = parseInt(m![1], 16) / 255
      expect(alpha).toBeGreaterThan(0.2)
      expect(alpha).toBeLessThan(0.7)
    })
    it(`${t}: the sticker shadow stays a quiet edge on canvas and cards`, () => {
      const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/.exec(s.stickerShadow)
      expect(m).not.toBeNull()
      const alpha = parseInt(m![2], 16) / 255, over = (bg: string) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(m![1].slice(i, i + 2), 16) * alpha + parseInt(bg.slice(1 + i, 3 + i), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('')
      for (const bg of [s.bg, s.card]) {
        expect(contrast(over(bg), bg)).toBeGreaterThanOrEqual(1.12)
        expect(contrast(over(bg), bg)).toBeLessThanOrEqual(1.6)
      }
    })
    it(`${t}: the sticker outline is an opaque light border that stands off the canvas`, () => {
      expect(s.stickerOutline).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrast(s.stickerOutline, '#000000')).toBeGreaterThanOrEqual(15)
    })
    it(`${t}: selection outline clears 3:1 on canvas`, () => {
      expect(contrast(s.selection, s.bg)).toBeGreaterThanOrEqual(3)
    })
    it(`${t}: the unread dot clears 3:1 on every surface it sits on`, () => {
      // It always wears a ring of panel colour, so the gold comment badge never touches it.
      for (const bg of [s.bg, s.panel, s.card, s.cardHover]) expect(contrast(s.unread, bg)).toBeGreaterThanOrEqual(3)
    })
    it(`${t}: proposal outlines clear 3:1 on canvas and card, and their chip text 4.5:1`, () => {
      for (const d of [s.diffAdded, s.diffChanged, s.diffRemoved]) {
        expect(contrast(d, s.bg)).toBeGreaterThanOrEqual(3)
        expect(contrast(d, s.card)).toBeGreaterThanOrEqual(3)
        expect(contrast(s.diffInk, d)).toBeGreaterThanOrEqual(4.5)
      }
    })
    for (const c of CARD_COLORS) {
      it(`${t}: ${c} card text clears 4.5:1`, () => {
        expect(contrast(cardColors[t][c].text, cardColors[t][c].bg)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('custom card colours', () => {
  // Every 17th step per channel, plus the awkward mid-greys where black and white ink tie.
  const spread: string[] = []
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) spread.push('#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''))
  spread.push('#777777', '#767676', '#808080', '#8a8a8a', '#ff0000', '#00ff00', '#0000ff', '#e5484d', '#0090ff', '#ffc53d')
  for (const t of THEMES) {
    it(`${t}: customText clears 4.5:1 on any picked colour`, () => {
      for (const hex of spread) expect(contrast(surfaces[t][customText(hex)], hex), hex).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('accepts a normalised hex and refuses anything else', () => {
    expect(cardColor('#aBc')).toBe('#AABBCC')
    expect(cardColor(' #12ab9f ')).toBe('#12AB9F')
    expect(cardColor('sky')).toBe('sky')
    for (const bad of ['red', '#12345', 'url(x)', '#1234567', 7, null, { a: 1 }]) expect(cardColor(bad)).toBe('none')
    expect(normalizeHex('zzz')).toBeNull()
  })
  it('gives CSS a preset variable or the hex with a text token', () => {
    expect(cardColorVars('gold')).toEqual({ bg: 'var(--dn-card-gold-bg)', text: 'var(--dn-card-gold-text)' })
    expect(cardColorVars('#ffffff')).toEqual({ bg: '#FFFFFF', text: 'var(--dn-custom-ink-dark)' })
    expect(cardColorVars('#000000')).toEqual({ bg: '#000000', text: 'var(--dn-custom-ink-light)' })
    expect(cardColorVars('nope;}', 'gold').bg).toBe('var(--dn-card-gold-bg)')
  })
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
