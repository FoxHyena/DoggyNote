import { areaAt } from '../state/areas.ts'
import { DEFAULT_SIZE, guessHeader, looksTabular, movieRefFromUrl, parseTsv, safeHref, tableFromGrid, tableColumns, type Card, type Id, type MovieRef, type Vec } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import { createCard, createNoteWithText, type Placement } from '../state/actions.ts'
import { importImage } from '../state/assets.ts'
import { unfurl } from '../state/unfurl.ts'
import { resolveMovie } from '../state/movies.ts'
import { revealCard } from './Canvas.tsx'
import { select } from '../state/ui.ts'
import { addFiles } from '../state/files.ts'
import { memoryClip, pasteClip, readClip, takePlainPaste } from '../state/clipboard.ts'
import { showToast } from '../state/toast.ts'

// Paste and drop onto the canvas: images become image cards, a URL becomes a
// link card, other text becomes a note.

export const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i

/** Add images as cards (on the current board, or `onBoard`, e.g. the Toy box). */
export async function addImages(files: File[], at: Vec, onBoard?: Id, areaId?: Id): Promise<Id[]> {
  areaId ??= !onBoard ? areaAt(at)?.id : undefined
  const ids: Id[] = []
  let offset = 0
  for (const f of files) {
    try {
      const img = await importImage(f)
      const w = Math.min(DEFAULT_SIZE.image.w, img.width)
      ids.push(
        createCard('image', { at: { x: at.x + offset, y: at.y + offset }, areaId }, {
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
  // Once it has its poster (and its height), bring the whole card into view.
  void resolveMovie(id).then(() => onBoard || requestAnimationFrame(() => requestAnimationFrame(() => revealCard(id))))
  return id
}

/** Tab-separated text (copied from a spreadsheet) becomes a table card, its first row the column names if it reads like names. */
export function addTable(text: string, place: Placement, onBoard?: Id): Id {
  const grid = parseTsv(text)
  const patch = tableFromGrid(grid, { header: guessHeader(grid), fallbackName: (i) => `${COPY.table.columnFallback} ${i + 1}` })
  // Wider grids get a wider card, so columns start out readable.
  const w = Math.min(960, Math.max(DEFAULT_SIZE.table.w, tableColumns(patch).length * 140))
  return createCard('table', place, { content: { title: '' }, edit: false, extra: { ...patch, w } as Partial<Card>, boardId: onBoard })
}

/** Tab-separated text becomes a table, a movie link a movie card, any other URL a link card, anything else a note. */
export function addText(text: string, at: Vec, onBoard?: Id, title?: string) {
  const t = text.trim()
  if (!t) return
  if (looksTabular(text)) return void addTable(text, { at }, onBoard)
  const href = safeHref(t)
  const movie = href && !/\s/.test(t) ? movieRefFromUrl(href) : null
  if (movie) addMovie(movie, { at }, onBoard)
  else if (href && !/\s/.test(t)) addLink(href, { at }, onBoard, title)
  else if (onBoard) createCard('note', { at }, { content: { md: t }, edit: false, boardId: onBoard })
  else createNoteWithText(t, { at })
}

/** Images become image cards, anything else a file card. Returns false if there were no files. */
export function addAnyFiles(files: File[], at: Vec, onBoard?: Id, areaId?: Id): boolean {
  if (!files.length) return false
  const images = files.filter((f) => IMAGE_TYPES.test(f.type))
  const others = files.filter((f) => !IMAGE_TYPES.test(f.type))
  if (images.length) void addImages(images, at, onBoard, areaId)
  if (others.length) addFiles(others, { x: at.x + images.length * 24, y: at.y + images.length * 24 }, onBoard, areaId)
  return true
}

/** Paste onto the canvas: copied cards first, then files, then text. `columnId`: the column under the pointer. */
export function handleCanvasPaste(dt: DataTransfer | null, at: Vec, columnId?: Id): boolean {
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

/**
 * The card menu's Paste: read the system clipboard (the browser may ask first) and
 * paste it as ⌘V would. If it can't be read, the last clip copied here, as long as
 * nothing else can have been copied since (see `memoryClip`).
 */
export async function pasteFromSystem(at: Vec, columnId?: Id) {
  let items: ClipboardItems
  try {
    items = await navigator.clipboard.read()
  } catch {
    const clip = memoryClip()
    if (clip) pasteClip(clip, at, { columnId })
    else showToast('DoggyNote wasn’t allowed to read the clipboard. Press ⌘V to paste instead.')
    return
  }
  const dt = new DataTransfer()
  for (const item of items) {
    for (const type of item.types) {
      const blob = await item.getType(type).catch(() => null)
      if (!blob) continue
      if (type === 'text/plain' || type === 'text/html') dt.setData(type, await blob.text())
      else if (IMAGE_TYPES.test(type)) dt.items.add(new File([blob], `pasted.${type.split('/')[1]}`, { type }))
    }
  }
  if (!handleCanvasPaste(dt, at, columnId)) showToast('Nothing on the clipboard to paste.')
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
