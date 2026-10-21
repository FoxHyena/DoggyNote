import { expect, it } from 'vitest'
import { contrastRatio, inkFor, relativeLuminance } from './contrast.ts'

it('computes WCAG relative luminance', () => {
  expect(relativeLuminance('#000000')).toBe(0)
  expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
  expect(relativeLuminance('#fff')).toBeCloseTo(1, 5)
  expect(relativeLuminance('#FFFF00')).toBeCloseTo(0.9278, 3)
  expect(relativeLuminance('#777777')).toBeCloseTo(0.1845, 3)
  expect(relativeLuminance('red')).toBeNull()
})

it('matches known contrast ratios', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
  expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2)
  expect(contrastRatio('#FFFFFF', '#777777')).toBeCloseTo(4.48, 2)
})

it('picks the ink with more contrast, including the awkward middle', () => {
  expect(inkFor('#FFFF00')).toBe('#000000') // pure yellow
  expect(inkFor('#0000FF')).toBe('#FFFFFF') // pure blue
  expect(inkFor('#777777')).toBe('#000000') // mid-grey: black 4.68 vs white 4.48
  expect(inkFor('#757575')).toBe('#FFFFFF') // a shade darker flips
  expect(inkFor('#FFFFFF')).toBe('#000000')
  expect(inkFor('#000000')).toBe('#FFFFFF')
  expect(inkFor('#D6409F')).toBe('#000000')
  expect(inkFor('#2F5D50')).toBe('#FFFFFF')
  for (const bg of ['#FFFF00', '#777777', '#757575', '#123456', '#E5484D', '#46A758']) {
    expect(Math.max(contrastRatio('#000000', bg), contrastRatio('#FFFFFF', bg))).toBeGreaterThanOrEqual(4.5)
  }
})
