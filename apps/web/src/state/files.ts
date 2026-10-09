import { MAX_FILE_BYTES, fileKind, formatBytes, newId, type Card, type Id, type Vec } from '@doggynote/core'
import { createCard } from './actions.ts'
import { api } from './api.ts'
import * as doc from './doc.ts'
import { select } from './ui.ts'
import { showToast } from './toast.ts'

// Uploaded files (PDFs, docs, zips…) become file cards. The card appears at
// once, marked "uploading"; the bytes stream to the server, and PDFs then get a
// first-page preview. Unlike images, files need a connection to add.

/** Add files as cards (on the current board, or `onBoard`, e.g. the Toy box). */
export function addFiles(files: File[], at: Vec, onBoard?: Id): Id[] {
  const ids: Id[] = []
  let offset = 0
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      showToast(`“${f.name}” is ${formatBytes(f.size)}. Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`)
      continue
    }
    const assetId = newId()
    const mime = f.type || 'application/octet-stream'
    const id = createCard('file', { at: { x: at.x + offset, y: at.y + offset } }, {
      content: { assetId, name: f.name, size: f.size, mime, status: 'uploading' },
      edit: false,
      boardId: onBoard,
    })
    ids.push(id)
    offset += 24
    void upload(id, f)
  }
  if (ids.length && !onBoard) select(ids)
  return ids
}

function finish(id: Id, patch: Partial<Card<'file'>['content']>) {
  const c = doc.getCard(id) as Card<'file'> | undefined
  if (c) doc.amendOrSilent(id, { content: { ...c.content, ...patch } } as Partial<Card>)
}

async function upload(id: Id, f: File) {
  const { assetId, name, mime } = (doc.getCard(id) as Card<'file'>).content
  try {
    await api(`/api/files/${assetId}?name=${encodeURIComponent(name)}`, { method: 'PUT', body: f, headers: { 'content-type': mime } })
  } catch (e) {
    finish(id, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed' })
    return
  }
  const thumb = fileKind(mime, name) === 'pdf' ? await pdfPreview(f, assetId).catch((e) => console.warn('[doggynote] PDF preview failed', e)) : undefined
  finish(id, { status: 'ok', ...(thumb ? { thumb } : {}) })
}

const PREVIEW_WIDTH = 520

/** Renders page 1 with pdf.js (loaded only now) and uploads it as the "thumb" image. */
async function pdfPreview(f: File, assetId: string): Promise<{ width: number; height: number }> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), disableFontFace: true })
  try {
    const pdf = await task.promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: PREVIEW_WIDTH / page.getViewport({ scale: 1 }).width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport }).promise
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (!blob) throw new Error('could not encode the preview')
    await api(`/api/assets/${assetId}/thumb`, { method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg' } })
    return { width: canvas.width, height: canvas.height }
  } finally {
    void task.destroy()
  }
}
