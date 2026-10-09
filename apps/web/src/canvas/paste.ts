import { DEFAULT_SIZE, safeHref, type Id, type Vec } from '@doggynote/core'
import { createCard, createNoteWithText, type Placement } from '../state/actions.ts'
import { importImage } from '../state/assets.ts'
import { unfurl } from '../state/unfurl.ts'
import { select } from '../state/ui.ts'

// Paste and drop onto the canvas: images become image cards, a URL becomes a
// link card, other text becomes a note.

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i

export async function addImages(files: File[], at: Vec): Promise<Id[]> {
  const ids: Id[] = []
  let offset = 0
  for (const f of files) {
    try {
      const img = await importImage(f)
      const w = Math.min(DEFAULT_SIZE.image.w, img.width)
      ids.push(
        createCard('image', { at: { x: at.x + offset, y: at.y + offset } }, {
          content: { assetId: img.assetId, width: img.width, height: img.height },
          edit: false,
          extra: { w, h: Math.round((w * img.height) / img.width) },
        }),
      )
      offset += 24
    } catch (err) {
      console.error('[doggynote] image import failed', err)
    }
  }
  if (ids.length) select(ids)
  return ids
}

export function addLink(url: string, place: Placement): Id {
  const id = createCard('link', place, { content: { url, status: 'pending' }, edit: false })
  void unfurl(id)
  return id
}

function addText(text: string, at: Vec) {
  const t = text.trim()
  if (!t) return
  const href = safeHref(t)
  if (href && !/\s/.test(t)) addLink(href, { at })
  else createNoteWithText(t, { at })
}

export function handleCanvasPaste(e: ClipboardEvent, at: Vec): boolean {
  const dt = e.clipboardData
  if (!dt) return false
  const images = [...dt.files].filter((f) => IMAGE_TYPES.test(f.type))
  if (images.length) {
    void addImages(images, at)
    return true
  }
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
  const images = [...dt.files].filter((f) => IMAGE_TYPES.test(f.type))
  if (images.length) return void addImages(images, at)
  const uri = dt.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'))
  if (uri) return void addText(uri, at)
  const text = dt.getData('text/plain')
  if (text) addText(text, at)
}
