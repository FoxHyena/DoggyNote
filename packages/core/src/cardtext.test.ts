import { describe, expect, it } from 'vitest'
import { cardLabel, cardText, isKnownCardType, type Card } from './index.ts'

const card = (type: string, content: unknown) => ({ id: 'c', kind: 'card', type, boardId: 'b', x: 0, y: 0, w: 1, h: 1, z: 0, color: 'none', createdAt: 0, content }) as unknown as Card

describe('card text', () => {
  it('collects the searchable text of each type', () => {
    expect(cardText(card('note', { md: '# Walk\n**twice** a day' }))).toBe('Walk\ntwice a day')
    expect(cardText(card('todo', { title: 'Errands', items: [{ id: '1', text: 'Kibble', done: false }] }))).toBe('Errands\nKibble')
    expect(cardText(card('link', { url: 'https://dog.example', title: 'Dogs' }))).toBe('Dogs\nhttps://dog.example')
  })

  it('names cards in one line, with a board title from the caller', () => {
    expect(cardLabel(card('todo', { title: '', items: [] }), () => '')).toBe('To-do list')
    expect(cardLabel(card('board', { boardId: 'x' }), (id) => `Board ${id}`)).toBe('Board x')
  })

  it('degrades for card types from a newer app', () => {
    expect(isKnownCardType('note')).toBe(true)
    expect(isKnownCardType('swatch')).toBe(true)
    expect(isKnownCardType('hologram')).toBe(false)
    expect(cardText(card('hologram', {}))).toBe('')
    expect(cardLabel(card('hologram', {}), () => '')).toBe('Card')
  })
  it('recognizes creative cards and retains their search and trash descriptions', () => {
    expect(isKnownCardType('ink')).toBe(true)
    expect(isKnownCardType('sketch')).toBe(true)
    expect(cardLabel(card('ink', { width: 100, height: 80 }), () => '')).toBe('Canvas drawing')
    expect(cardText(card('sketch', { title: 'Opening frame', width: 320, height: 240, background: 'paper' }))).toBe('Opening frame')
    expect(cardLabel(card('sketch', { title: '' }), () => '')).toBe('Sketch')
  })
})

describe('malformed synced cards', () => {
  it('never throw', () => {
    expect(cardText(card('todo', { title: 'x', items: null }))).toBe('')
    expect(typeof cardLabel(card('note', null), () => '')).toBe('string')
    expect(cardLabel(card('board', null), () => '')).toBe('Card')
  })
})

it('keeps additive image-caption and creative descriptions in the shared text path', () => {
  const image = card('image', { caption: 'Legacy caption' })
  expect(cardText({ ...image, imageCaption: 'Current caption' } as unknown as Card)).toBe('Current caption')
  expect(cardLabel({ ...image, imageCaption: 'Current caption' } as unknown as Card, () => '')).toBe('Current caption')
  expect(cardText({ ...image, imageCaption: '' } as unknown as Card)).toBe('')
  expect(cardLabel({ ...image, imageCaption: '' } as unknown as Card, () => '')).toBe('Image')
  expect(cardText({ ...card('swatch', {}), swatchName: 'Forest', swatchHex: '#2F5D50', swatchCaption: 'Packaging' } as unknown as Card)).toBe('Forest\n#2F5D50\nPackaging')
  expect(cardLabel({ ...card('swatch', {}), swatchName: {}, swatchHex: '#2F5D50' } as unknown as Card, () => '')).toBe('#2F5D50')
  expect(cardText(card('sketch', { title: 'Opening scene sketch' }))).toBe('Opening scene sketch')
  expect(cardText(card('future', { title: { bad: true } }))).toBe('')
})

it('keeps independent image caption/source fields searchable after baseline integration', () => {
  const image = { ...card('image', { assetId: 'asset', width: 800, height: 500, caption: 'Legacy caption' }), imageCaption: 'Warm side lighting', imageSourceUrl: 'https://example.test/original' } as Card<'image'>
  expect(cardText(image)).toBe('Warm side lighting\nhttps://example.test/original')
  expect(cardLabel(image, () => '')).toBe('Warm side lighting')
  expect(cardText({ ...image, imageCaption: '', imageSourceUrl: 'file:///private/asset' })).toBe('')
})
