import { expect, it } from 'vitest'
import { DEFAULT_SWATCH_HEX, normalizeSwatchHex, swatchDescription, swatchHex, validSwatchFields } from './swatch.ts'
import { agentObjectSchema } from './agent.ts'

it('normalizes HEX without rounding or losing color precision', () => {
  for (const [input, expected] of [['#2F5D50', '#2F5D50'], ['2f5d50', '#2F5D50'], [' #abc ', '#AABBCC'], ['fff', '#FFFFFF'], ['#000000', '#000000'], ['#00ff80', '#00FF80']]) expect(normalizeSwatchHex(input)).toBe(expected)
  for (const input of ['', '#', '#2F', '#2F5D', '#12345678', '#12gg45', 'red', 'rgb(0,0,0)', 'url(https://bad)', null, {}, 123]) expect(normalizeSwatchHex(input)).toBeNull()
})

it('safely describes malformed synced fields without CSS injection or crashes', () => {
  const malformed = { swatchHex: 'url(https://bad)', swatchName: { secret: 'no' }, swatchCaption: ['no'] } as never
  expect(swatchHex(malformed)).toBe(DEFAULT_SWATCH_HEX)
  expect(swatchDescription(malformed)).toBe(DEFAULT_SWATCH_HEX)
})

const fields = { swatchHex: '#2F5D50', swatchName: 'Forest', swatchCaption: 'Primary packaging', swatchHexDraft: '#2F' }
it('validates canonical document values while permitting durable unfinished edits', () => {
  expect(validSwatchFields(fields)).toBe(true)
  for (const patch of [{ swatchHex: '#abc' }, { swatchHex: 'red' }, { swatchName: [] }, { swatchCaption: 1 }, { swatchHexDraft: {} }, { swatchHexDraft: 'x'.repeat(101) }]) expect(validSwatchFields({ ...fields, ...patch })).toBe(false)
})

it('allows reviewable swatch proposals and rejects malformed/unknown fields', () => {
  const card = { id: 'swatch', kind: 'card', boardId: 'board', type: 'swatch', content: {}, x: 0, y: 0, w: 220, h: 220, z: 1, color: 'none', createdAt: 1, ...fields }
  expect(agentObjectSchema.safeParse(card).success).toBe(true)
  expect(agentObjectSchema.safeParse({ ...card, swatchHex: 'url(no)' }).success).toBe(false)
  expect(agentObjectSchema.safeParse({ ...card, content: { html: '<script>' } }).success).toBe(false)
})
