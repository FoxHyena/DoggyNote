import * as Y from 'yjs'

/** Wire values are bounded before decoding. These helpers are DOM-free. */
export const NOTE_LIMIT = 256 * 1024
export const REMOTE_ORIGIN = 'remote'
export function encodeUpdate(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(result)
}
export function decodeUpdate(value: string): Uint8Array {
  if (typeof value !== 'string' || value.length > NOTE_LIMIT * 8) throw new Error('Note update too large')
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}
export function noteDocument(state?: string): Y.Doc {
  const doc = new Y.Doc()
  if (state) Y.applyUpdate(doc, decodeUpdate(state), REMOTE_ORIGIN)
  return doc
}
export const noteState = (doc: Y.Doc) => encodeUpdate(Y.encodeStateAsUpdate(doc))
/** Minimal splice preserves identities outside the actual replacement. */
export function replaceText(text: Y.Text, next: string, origin: unknown = null) {
  const before = text.toString()
  if (before === next) return
  let from = 0, end = 0
  while (from < before.length && from < next.length && before[from] === next[from]) from++
  const high = (n: number) => n >= 0xd800 && n <= 0xdbff
  const low = (n: number) => n >= 0xdc00 && n <= 0xdfff
  // Yjs normalizes split surrogate pairs. Splice at code-point boundaries so
  // changing one emoji to another never durably stores replacement characters.
  if (from && high(before.charCodeAt(from - 1)) && low(before.charCodeAt(from))) from--
  while (end < before.length - from && end < next.length - from && before[before.length - end - 1] === next[next.length - end - 1]) end++
  if (end && low(before.charCodeAt(before.length - end)) && high(before.charCodeAt(before.length - end - 1))) end--
  text.doc!.transact(() => {
    if (before.length - from - end) text.delete(from, before.length - from - end)
    if (next.length - from - end) text.insert(from, next.slice(from, next.length - end))
  }, origin)
}

export type LivePoint = { x: number; y: number }
export type LivePreview = { id: string; x: number; y: number; w?: number; h?: number }
export type LivePresence = {
  sessionId: string; userId: string; username: string; canEdit: boolean
  pointer: LivePoint | null; selection: string[]; editing: string | null
  camera: { x: number; y: number; zoom: number }; width: number; height: number
  previews: LivePreview[]; caret: { anchor: string; head: string } | null
}
export type RoomEvent =
  | { type: 'members'; members: LivePresence[] }
  | { type: 'changed' }
  | { type: 'ping'; id: string; userId: string; username: string; point: LivePoint }

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e8
export function livePoint(p: unknown): p is LivePoint {
  const v = p as LivePoint | null
  return !!v && finite(v.x) && finite(v.y)
}
/** Identity and permissions are never accepted from the client. */
export function presenceInput(value: unknown): Pick<LivePresence, 'pointer' | 'selection' | 'editing' | 'camera' | 'width' | 'height' | 'previews' | 'caret'> | null {
  const p = value as LivePresence | null
  if (!p || (p.pointer !== null && !livePoint(p.pointer)) || !livePoint(p.camera) || !finite(p.camera.zoom) || p.camera.zoom < .05 || p.camera.zoom > 8 || !finite(p.width) || !finite(p.height) || p.width < 1 || p.height < 1) return null
  if (!Array.isArray(p.selection) || p.selection.length > 100 || !p.selection.every((id) => typeof id === 'string' && id.length <= 64) || !(p.editing === null || (typeof p.editing === 'string' && p.editing.length <= 64))) return null
  if (!Array.isArray(p.previews) || p.previews.length > 100 || !p.previews.every((v) => v && typeof v.id === 'string' && v.id.length <= 64 && livePoint(v) && (v.w === undefined || (finite(v.w) && v.w > 0)) && (v.h === undefined || (finite(v.h) && v.h > 0)))) return null
  if (p.caret !== null && (!p.caret || typeof p.caret.anchor !== 'string' || typeof p.caret.head !== 'string' || p.caret.anchor.length > 512 || p.caret.head.length > 512)) return null
  return { pointer: p.pointer, selection: p.selection, editing: p.editing, camera: p.camera, width: p.width, height: p.height, previews: p.previews, caret: p.caret }
}
