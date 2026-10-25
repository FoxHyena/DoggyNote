import { describe, expect, it } from 'vitest'
import { cardLabel, cardSpokenName, cardText, isKnownCardType, type Card } from './index.ts'

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
    expect(isKnownCardType('hologram')).toBe(false)
    expect(cardText(card('hologram', {}))).toBe('')
    expect(cardLabel(card('hologram', {}), () => '')).toBe('Card')
  })
})

describe('malformed synced cards', () => {
  it('never throw', () => {
    expect(cardText(card('todo', { title: 'x', items: null }))).toBe('')
    expect(typeof cardLabel(card('note', null), () => '')).toBe('string')
    expect(cardLabel(card('board', null), () => '')).toBe('Card')
  })
})

describe('cardSpokenName', () => {
  it('says the kind, then the name, without repeating itself', () => {
    expect(cardSpokenName(card('note', { md: '# Trip to the coast\nPack towels' }), () => '')).toBe('Note: Trip to the coast')
    expect(cardSpokenName(card('todo', { title: '', items: [] }), () => '')).toBe('To-do list')
    expect(cardSpokenName(card('board', { boardId: 'b1' }), () => 'Holiday plans')).toBe('Board: Holiday plans')
  })
})
