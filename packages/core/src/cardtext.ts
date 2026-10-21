// What a card says, as plain text: for search, the trash list and the clipboard.
// One switch for every card type, so a new type registers in one place. Cards
// from a newer app (an unknown type) fall through to the defaults.

import { swatchDescription, swatchHex, swatchText } from './swatch.ts'
import { imageCaption, imageSourceUrl } from './image.ts'
import type { Card, Id } from './model.ts'
import { mdToText, noteMarkdown } from './markdown.ts'

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

function rawCardText(c: Card): string {
  switch (c.type) {
    case 'swatch':
      return swatchDescription(c)
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
    case 'column':
      return (c as Card<'column'>).content.title
    case 'sketch':
      return (c as Card<'sketch'>).content.title
    case 'image':
      return [imageCaption(c as Card<'image'>), imageSourceUrl(c.imageSourceUrl)].filter(Boolean).join('\n')
    case 'file':
      return (c as Card<'file'>).content.name
    case 'movie': {
      const m = (c as Card<'movie'>).content
      return [m.title, m.year, m.info?.genres?.join(', '), m.info?.overview].filter(Boolean).join('\n')
    }
    default: {
      const value = c as unknown as Record<string, unknown>
      const content = value.content as Record<string, unknown> | null
      return [value.swatchName, value.swatchHex, value.swatchCaption, content?.title].filter((text): text is string => typeof text === 'string').join('\n')
    }
  }
}

function rawCardLabel(c: Card, boardTitle: (boardId: Id) => string): string {
  switch (c.type) {
    case 'swatch':
      return swatchText(c.swatchName) || swatchHex(c)
    case 'note':
      return mdToText(noteMarkdown(c as Card<'note'>)).split('\n')[0] || 'Empty note'
    case 'todo': {
      const t = (c as Card<'todo'>).content
      return t.title || t.items[0]?.text || 'To-do list'
    }
    case 'board':
      return boardTitle((c as Card<'board'>).content.boardId)
    case 'image':
      return imageCaption(c as Card<'image'>).split('\n')[0] || 'Image'
    case 'ink':
      return 'Canvas drawing'
    case 'sketch':
      return (c as Card<'sketch'>).content.title || 'Sketch'
    case 'link': {
      const l = (c as Card<'link'>).content
      return l.title || l.url
    }
    case 'column':
      return (c as Card<'column'>).content.title || 'Column'
    case 'file':
      return (c as Card<'file'>).content.name || 'File'
    case 'movie': {
      const m = (c as Card<'movie'>).content
      return m.title ? (m.year ? `${m.title} (${m.year})` : m.title) : 'Movie or show'
    }
    default:
      return 'Card'
  }
}
