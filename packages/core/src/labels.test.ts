import { expect, it } from 'vitest'
import { LABEL_FIELD, LABEL_PRESETS, pickLabelColor, boardLabels, cardLabels, labelColor, labelToken, validLabelField, withoutLabelTombstones } from './labels.ts'
import type { Board, Card } from './model.ts'

const id = 'a1b2c3d4e5f6'
const board = (extra: Record<string, unknown> = {}) => ({ id: 'b', kind: 'board', parentId: null, title: 'B', icon: 'paw', color: 'none', createdAt: 1, ...extra }) as Board
const card = (extra: Record<string, unknown> = {}) => ({ id: 'c', kind: 'card', type: 'note', boardId: 'b', x: 0, y: 0, w: 200, h: 80, z: 1, color: 'none', createdAt: 1, content: { md: '' }, ...extra }) as Card

it('makes tokens whose field names stay within 32 characters', () => {
  const token = labelToken()
  expect(token).toMatch(/^[a-f0-9]{12}$/)
  for (const key of [`label${token}`, `labelName${token}`, `labelColor${token}`]) {
    expect(key.length).toBeLessThanOrEqual(32)
    expect(LABEL_FIELD.test(key)).toBe(true)
  }
})

it('validates definitions on boards and memberships on cards', () => {
  expect(validLabelField('board', `labelName${id}`, 'Lighting')).toBe(true)
  expect(validLabelField('board', `labelName${id}`, '  ')).toBe(false)
  expect(validLabelField('board', `labelName${id}`, 'x'.repeat(61))).toBe(false)
  expect(validLabelField('board', `labelName${id}`, null)).toBe(true)
  expect(validLabelField('board', `labelColor${id}`, 'sky')).toBe(true)
  expect(validLabelField('board', `labelColor${id}`, '#12AB3F')).toBe(true)
  for (const bad of ['red', '#12ab3f', 'url(x)', 3]) expect(validLabelField('board', `labelColor${id}`, bad)).toBe(false)
  expect(validLabelField('card', `labelName${id}`, 'Lighting')).toBe(false)
  expect(validLabelField('card', `label${id}`, true)).toBe(true)
  expect(validLabelField('card', `label${id}`, null)).toBe(true)
  expect(validLabelField('card', `label${id}`, 'yes')).toBe(false)
  expect(validLabelField('board', `label${id}`, true)).toBe(false)
  expect(validLabelField('card', 'labelBad', true)).toBe(false)
})

it('reads labels from the card’s own board only, skipping removed ones', () => {
  const other = 'ffffffffffff'
  const b = board({ [`labelName${id}`]: 'Lighting', [`labelColor${id}`]: 'gold', [`labelName${other}`]: null, [`labelColor${other}`]: 'sky' })
  expect(boardLabels(b)).toEqual([{ id, name: 'Lighting', color: 'gold' }])
  const c = card({ [`label${id}`]: true, [`label${other}`]: true })
  expect(cardLabels(c, b).map((l) => l.name)).toEqual(['Lighting'])
  expect(cardLabels(card({ boardId: 'elsewhere', [`label${id}`]: true }), b)).toEqual([])
  expect(cardLabels(card({ [`label${id}`]: false }), b)).toEqual([])
})

it('never hands an unchecked colour to CSS', () => {
  expect(labelColor('lilac')).toBe('lilac')
  expect(labelColor('#abc')).toBe('#AABBCC')
  expect(labelColor('red; background: url(x)')).toBe('sky')
  expect(labelColor(undefined)).toBe('sky')
})

it('drops label tombstones from whole-object copies', () => {
  expect(withoutLabelTombstones({ a: 1, [`label${id}`]: false, [`labelName${id}`]: null, labelfffffffffff0: true })).toEqual({ a: 1, labelfffffffffff0: true })
})

it('gives a new label a random preset the board isn’t using yet', () => {
  expect(LABEL_PRESETS).not.toContain('none')
  expect(pickLabelColor([], () => 0)).toBe(LABEL_PRESETS[0])
  expect(pickLabelColor([], () => 0.9999)).toBe(LABEL_PRESETS.at(-1))
  const used = LABEL_PRESETS.slice(0, 4).map((color) => ({ color }))
  for (const r of [0, 0.3, 0.6, 0.9999]) expect(LABEL_PRESETS.slice(4)).toContain(pickLabelColor(used, () => r))
  // Custom colours don't use up a preset.
  expect(pickLabelColor([{ color: '#123456' }], () => 0)).toBe(LABEL_PRESETS[0])
  // All taken: any preset.
  const all = LABEL_PRESETS.map((color) => ({ color }))
  expect(LABEL_PRESETS).toContain(pickLabelColor(all, () => 0.5))
})
