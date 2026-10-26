// What a card says, as plain text: for search, the trash list and the clipboard.
// One switch for every card type, so a new type registers in one place. Cards
// from a newer app (an unknown type) fall through to the defaults.

import type { Card, Id } from './model.ts'
import { mdToText, noteMarkdown } from './markdown.ts'
import { swatchHex, swatchName } from './swatch.ts'
import { sketchOf } from './sketch.ts'

// Cards are synced from everyone's devices: a malformed one must not break search
// or the trash list for the whole workspace, so it degrades to a generic answer.
function guarded(fn: () => unknown, fallback: string): string {
  try {
    const out = fn()
    return typeof out === 'string' && out ? out : fallback
  } catch {
    return fallback
  }
}

/** All the searchable text on a card, one part per line. */
export const cardText = (c: Card): string => guarded(() => rawCardText(c), '')

/** A one-line name for a card. `boardTitle` names the board a board card opens. */
export const cardLabel = (c: Card, boardTitle: (boardId: Id) => string): string => guarded(() => rawCardLabel(c, boardTitle), 'Card')

const KIND: Record<string, string> = { note: 'Note', todo: 'To-do list', board: 'Board', image: 'Image', link: 'Link', column: 'Column', area: 'Area', file: 'File', movie: 'Movie', swatch: 'Colour' }

/** What a screen reader says for a card: its kind, then its name ("Note: Trip to the coast"). */
export const cardSpokenName = (c: Card, boardTitle: (boardId: Id) => string): string => guarded(() => {
  const kind = KIND[c.type] ?? 'Card'
  const label = cardLabel(c, boardTitle)
  return label === kind ? kind : `${kind}: ${label}`
}, 'Card')

function rawCardText(c: Card): string {
  switch (c.type) {
    case 'note':
      return mdToText(noteMarkdown(c as Card<'note'>))
    case 'todo': {
      const t = (c as Card<'todo'>).content
      return [t.title, ...t.items.map((i) => i.text)].filter(Boolean).join('\n')
    }
    case 'link': {
      const l = (c as Card<'link'>).content
      return [l.title, l.description, l.url].filter(Boolean).join('\n')
    }
    case 'area':
    case 'column':
      return (c as Card<'column'>).content.title
    case 'image':
      return (c as Card<'image'>).content.caption ?? ''
    case 'file':
      return (c as Card<'file'>).content.name
    case 'movie': {
      const m = (c as Card<'movie'>).content
      return [m.title, m.year, m.info?.genres?.join(', '), m.info?.overview].filter(Boolean).join('\n')
    }
    case 'swatch':
      return [swatchName(c as Card<'swatch'>), swatchHex(c as Card<'swatch'>)].filter(Boolean).join('\n')
    case 'sketch':
      return sketchOf(c).title
    default:
      return ''
  }
}

function rawCardLabel(c: Card, boardTitle: (boardId: Id) => string): string {
  switch (c.type) {
    case 'note':
      return mdToText(noteMarkdown(c as Card<'note'>)).split('\n')[0] || 'Empty note'
    case 'todo': {
      const t = (c as Card<'todo'>).content
      return t.title || t.items[0]?.text || 'To-do list'
    }
    case 'board':
      return boardTitle((c as Card<'board'>).content.boardId)
    case 'image':
      return (c as Card<'image'>).content.caption || 'Image'
    case 'link': {
      const l = (c as Card<'link'>).content
      return l.title || l.url
    }
    case 'area':
      return (c as Card<'area'>).content.title || 'Area'
    case 'column':
      return (c as Card<'column'>).content.title || 'Column'
    case 'file':
      return (c as Card<'file'>).content.name || 'File'
    case 'movie': {
      const m = (c as Card<'movie'>).content
      return m.title ? (m.year ? `${m.title} (${m.year})` : m.title) : 'Movie or show'
    }
    case 'swatch':
      return swatchName(c as Card<'swatch'>) || swatchHex(c as Card<'swatch'>)
    case 'sketch':
      return sketchOf(c).title || 'Sketch'
    case 'ink':
      return 'Drawing'
    default:
      return 'Card'
  }
}
