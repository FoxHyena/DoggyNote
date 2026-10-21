import { expect, it } from 'vitest'
import { DEFAULT_SWATCH_HEX, SWATCH_PRESETS, normalizeSwatchHex, swatchHex, swatchName } from './swatch.ts'
import { agentObjectSchema } from './agent.ts'
import { cardLabel, cardText } from './cardtext.ts'
import type { Card } from './model.ts'

it('normalizes HEX in its short and long forms', () => {
  for (const [input, expected] of [['#2F5D50', '#2F5D50'], ['2f5d50', '#2F5D50'], [' #abc ', '#AABBCC'], ['fff', '#FFFFFF']]) expect(normalizeSwatchHex(input)).toBe(expected)
  for (const input of ['', '#', '#2F', '#2F5D', '#12345678', '#12gg45', 'red', 'url(https://bad)', null, {}, 123]) expect(normalizeSwatchHex(input)).toBeNull()
  for (const p of SWATCH_PRESETS) expect(normalizeSwatchHex(p)).toBe(p)
})

it('draws malformed synced content as the default colour, never as raw CSS', () => {
  expect(swatchHex({ content: { hex: 'url(https://bad)', name: { no: 1 } } } as never)).toBe(DEFAULT_SWATCH_HEX)
  expect(swatchHex({} as never)).toBe(DEFAULT_SWATCH_HEX)
  expect(swatchName({ content: { hex: '#000000', name: ['no'] } } as never)).toBe('')
})

const card = { id: 'swatch', kind: 'card', boardId: 'board', type: 'swatch', x: 0, y: 0, w: 200, h: 190, z: 1, color: 'none', createdAt: 1, content: { hex: '#2F5D50', name: 'Forest' } } as const

it('is searchable by its name and HEX', () => {
  expect(cardText(card as unknown as Card)).toBe('Forest\n#2F5D50')
  expect(cardLabel(card as unknown as Card, () => '')).toBe('Forest')
  expect(cardLabel({ ...card, content: { hex: '#ABCDEF' } } as unknown as Card, () => '')).toBe('#ABCDEF')
})

it('lets an agent propose a colour card, but only with a canonical HEX', () => {
  expect(agentObjectSchema.safeParse(card).success).toBe(true)
  expect(agentObjectSchema.safeParse({ ...card, content: { hex: 'url(no)' } }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...card, content: { hex: '#2F5D50', html: '<script>' } }).success).toBe(false)
})
