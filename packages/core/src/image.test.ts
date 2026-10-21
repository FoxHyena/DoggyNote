import { describe, expect, it } from 'vitest'
import { imageCaption, imageSourceHost, imageSourceUrl } from './image.ts'
import { cardText, cardLabel } from './cardtext.ts'
import { agentObjectSchema } from './agent.ts'
import type { Card } from './model.ts'

const card: Card<'image'> = { id: 'image', kind: 'card', type: 'image', boardId: 'home', x: 0, y: 0, w: 260, h: 200, z: 1, color: 'none', createdAt: 1, content: { assetId: 'asset', width: 640, height: 480, caption: 'Legacy caption' } }

describe('image attribution', () => {
  it('preserves legacy captions, explicit clears and multiline text; malformed metadata is harmless', () => {
    expect(imageCaption(card)).toBe('Legacy caption')
    expect(imageCaption({ ...card, imageCaption: '' })).toBe('')
    expect(imageCaption({ ...card, imageCaption: 'Warm side lighting;\nuse for the opening scene' })).toContain('\n')
    expect(imageCaption({ ...card, imageCaption: {} } as unknown as Card<'image'>)).toBe('')
    expect(imageCaption({ ...card, imageCaption: 'x'.repeat(12_000) })).toHaveLength(10_000)
  })
  it('accepts only explicit safe web URLs without credentials, control characters or local paths', () => {
    expect(imageSourceUrl(' https://www.example.com/research?q=lighting#photo ')).toBe('https://www.example.com/research?q=lighting#photo')
    expect(imageSourceHost('https://www.example.com/a')).toBe('example.com')
    for (const value of [undefined, {}, '', '/Users/research/photo.png', 'C:\\photo.png', 'file:///Users/photo.png', 'blob:https://example.com/a', 'data:image/png,x', 'javascript:alert(1)', 'https://name:secret@example.com', 'https://example.com/\nprivate', 'https://example.com\\evil', '//example.com', 'example.com', 'https://']) expect(imageSourceUrl(value)).toBeNull()
  })
  it('shared search and trash text honor current metadata, legacy fallback and safe sources', () => {
    expect(cardText({ ...card, imageCaption: 'Warm light\nOpening scene', imageSourceUrl: 'https://example.com/original' })).toBe('Warm light\nOpening scene\nhttps://example.com/original')
    expect(cardLabel({ ...card, imageCaption: 'Warm light\nOpening scene' }, () => '')).toBe('Warm light')
    expect(cardText({ ...card, imageCaption: '', imageSourceUrl: 'file:///Users/private/photo.png' })).toBe('')
    expect(cardText(card)).toBe('Legacy caption')
  })
  it('proposal validation preserves metadata while refusing unsafe attribution', () => {
    expect(agentObjectSchema.safeParse({ ...card, imageCaption: 'Scene one', imageSourceUrl: 'https://example.com/original' }).success).toBe(true)
    expect(agentObjectSchema.safeParse({ ...card, imageSourceUrl: 'file:///private/photo.png' }).success).toBe(false)
    expect(agentObjectSchema.safeParse({ ...card, imageCaption: null, imageSourceUrl: '' }).success).toBe(true)
  })
})
