import { DEFAULT_SIZE, safeHref, type Id, type Vec } from '@doggynote/core'
import { createCard, createNoteWithText, type Placement } from '../state/actions.ts'
import { importImage } from '../state/assets.ts'
import { unfurl } from '../state/unfurl.ts'
import { select } from '../state/ui.ts'
import { addFiles } from '../state/files.ts'

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

export function addLink(url: string, place: Placement, onBoard?: Id): Id {
  const id = createCard('link', place, { content: { url, status: 'pending' }, edit: false, boardId: onBoard })
  void unfurl(id)
  return id
}

/** A URL becomes a link card, anything else a note. */
export function addText(text: string, at: Vec, onBoard?: Id) {
  const t = text.trim()
  if (!t) return
  const href = safeHref(t)
  if (href && !/\s/.test(t)) addLink(href, { at }, onBoard)
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

export function handleCanvasPaste(e: ClipboardEvent, at: Vec): boolean {
  const dt = e.clipboardData
  if (!dt) return false
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
