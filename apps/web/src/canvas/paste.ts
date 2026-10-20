import { DEFAULT_SIZE, movieRefFromUrl, safeHref, type Id, type MovieRef, type Vec } from '@doggynote/core'
import { createCard, createNoteWithText, type Placement } from '../state/actions.ts'
import { importImage } from '../state/assets.ts'
import { unfurl } from '../state/unfurl.ts'
import { resolveMovie } from '../state/movies.ts'
import { select } from '../state/ui.ts'
import { addFiles } from '../state/files.ts'
import { pasteClip, readClip, takePlainPaste } from '../state/clipboard.ts'

// Paste and drop onto the canvas: images become image cards, a URL becomes a
// link card, other text becomes a note.

export const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i

/** Add images as cards (on the current board, or `onBoard`, e.g. the Toy box). */
export async function addImages(files: File[], at: Vec, onBoard?: Id): Promise<Id[]> {
  const ids: Id[] = []
  let offset = 0
  for (const f of files) {
    try {
      const img = await importImage(f)
      const w = Math.min(DEFAULT_SIZE.image.w, img.width)
      ids.push(
        createCard('image', { at: { x: at.x + offset, y: at.y + offset } }, {
          content: { assetId: img.assetId, width: img.width, height: img.height, sizes: img.sizes },
          edit: false,
          extra: { w, h: Math.round((w * img.height) / img.width) },
          boardId: onBoard,
        }),
      )
      offset += 24
    } catch (err) {
      console.error('[doggynote] image import failed', err)
    }
  }
  if (ids.length && !onBoard) select(ids)
  return ids
}

/** `title` shows until the preview arrives, and stays if the page has none. */
export function addLink(url: string, place: Placement, onBoard?: Id, title?: string): Id {
  const id = createCard('link', place, { content: { url, status: 'pending', ...(title ? { title } : {}) }, edit: false, boardId: onBoard })
  void unfurl(id)
  return id
}

/** A TMDB or IMDb link: a movie card that fetches its own details. */
export function addMovie(ref: MovieRef, place: Placement, onBoard?: Id): Id {
  const content = 'imdbId' in ref ? { kind: 'movie', title: '', imdbId: ref.imdbId, status: 'pending' } : { kind: ref.kind, tmdbId: ref.tmdbId, title: '', status: 'pending' }
  const id = createCard('movie', place, { content, edit: false, boardId: onBoard })
  void resolveMovie(id)
  return id
}

/** A movie link becomes a movie card, any other URL a link card, anything else a note. */
export function addText(text: string, at: Vec, onBoard?: Id, title?: string) {
  const t = text.trim()
  if (!t) return
  const href = safeHref(t)
  const movie = href && !/\s/.test(t) ? movieRefFromUrl(href) : null
  if (movie) addMovie(movie, { at }, onBoard)
  else if (href && !/\s/.test(t)) addLink(href, { at }, onBoard, title)
  else if (onBoard) createCard('note', { at }, { content: { md: t }, edit: false, boardId: onBoard })
  else createNoteWithText(t, { at })
}

/** Images become image cards, anything else a file card. Returns false if there were no files. */
export function addAnyFiles(files: File[], at: Vec, onBoard?: Id): boolean {
  if (!files.length) return false
  const images = files.filter((f) => IMAGE_TYPES.test(f.type))
  const others = files.filter((f) => !IMAGE_TYPES.test(f.type))
  if (images.length) void addImages(images, at, onBoard)
  if (others.length) addFiles(others, { x: at.x + images.length * 24, y: at.y + images.length * 24 }, onBoard)
  return true
}

/** Paste onto the canvas: copied cards first, then files, then text. `columnId`: the column under the pointer. */
export function handleCanvasPaste(e: ClipboardEvent, at: Vec, columnId?: Id): boolean {
  const dt = e.clipboardData
  if (!dt) return false
  // ⌘⇧V: just the words, as a note (no copied cards, no link preview). An empty
  // paste (some systems fire one for the keys themselves) leaves the flag for the real one.
  const plain = dt.getData('text/plain').trim()
  if (plain && takePlainPaste()) {
    createNoteWithText(plain, { at })
    return true
  }
  const clip = readClip(dt)
  if (clip) {
    pasteClip(clip, at, { columnId })
    return true
  }
  if (addAnyFiles([...dt.files], at)) return true
  const text = dt.getData('text/plain')
  if (text) {
    addText(text, at)
    return true
  }
  return false
}

export function handleCanvasDrop(e: DragEvent, at: Vec) {
  const dt = e.dataTransfer
  if (!dt) return
  if (addAnyFiles([...dt.files], at)) return
  const uri = dt.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'))
  if (uri) return void addText(uri, at)
  const text = dt.getData('text/plain')
  if (text) addText(text, at)
}
