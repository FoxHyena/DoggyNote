import {
  CLIP_MIME,
  GRID,
  clipText,
  collectClip,
  materialise,
  newId,
  ordersBetween,
  parseClip,
  type Card,
  type ClipPayload,
  type Id,
  type Obj,
  type Vec,
} from '@doggynote/core'
import { unwrap } from 'solid-js/store'
import { boardDisplayTitle } from '@doggynote/theme'
import * as doc from './doc.ts'
import { columnChildren, trashSelection } from './actions.ts'
import { boardId, editingId, select, selection } from './ui.ts'
import { showToast } from './toast.ts'
import { rectOf } from '../canvas/layout.ts'

// Copy, cut, paste and duplicate cards. The system clipboard gets three things:
// the clip itself (a private type), the same clip tucked into HTML (survives a
// trip between browsers and the desktop app), and readable markdown for other
// apps. A copy in memory covers engines that drop custom types.
//
// Safari and the desktop app only run copy/cut/paste when something editable is
// focused, so ⌘C, ⌘X and ⌘V briefly focus a hidden textarea: the native command
// then fires a real clipboard event, which is where the data is written or read.

const TOO_BIG = 'That’s more than DoggyNote can carry in one go. Try fewer cards.'

let memory: { clip: ClipPayload; text: string } | null = null
let pending: { clip: ClipPayload; cut: boolean } | null = null
let plainUntil = 0
let lastPaste: { key: string; count: number } | null = null

/** The clip for the current selection, or null (with a toast if it's too big). */
export function clipOfSelection(): ClipPayload | null {
  const ids = [...selection()].filter((id) => doc.get(id)?.kind === 'card')
  // Plain objects, not store proxies: the clip is cloned and serialised.
  const clip = collectClip(ids, { get: (id) => unwrap(doc.get(id)), all: () => Object.values(unwrap(doc.objs)), rect: (id) => rectOf(id) })
  if (clip === 'too-big') {
    showToast(TOO_BIG)
    return null
  }
  return clip
}

const boardTitle = (id: Id) => boardDisplayTitle(doc.getBoard(id), 'Board')

/** Readable HTML for other apps, carrying the clip in an attribute. Built without innerHTML. */
function clipHtml(clip: ClipPayload, text: string): string {
  const wrap = document.createElement('div')
  wrap.dataset.doggynoteClip = btoa(unescape(encodeURIComponent(JSON.stringify(clip))))
  for (const block of text.split('\n\n')) {
    const p = document.createElement('p')
    block.split('\n').forEach((line, i) => {
      if (i) p.append(document.createElement('br'))
      p.append(line)
    })
    wrap.append(p)
  }
  return wrap.outerHTML
}

function writeClip(dt: DataTransfer, clip: ClipPayload) {
  const text = clipText(clip, boardTitle)
  memory = { clip, text }
  dt.setData('text/plain', text)
  dt.setData('text/html', clipHtml(clip, text))
  try {
    dt.setData(CLIP_MIME, JSON.stringify(clip))
  } catch {
    // Some engines refuse custom types; the HTML copy and memory still carry it.
  }
}

/** A clip from a paste, if it holds one. */
export function readClip(dt: DataTransfer): ClipPayload | null {
  const direct = parseClip(dt.getData(CLIP_MIME))
  if (direct) return direct
  const html = dt.getData('text/html')
  if (html.includes('data-doggynote-clip')) {
    // DOMParser never runs scripts; only the attribute is read.
    const attr = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-doggynote-clip]')?.getAttribute('data-doggynote-clip')
    try {
      const parsed = attr ? parseClip(decodeURIComponent(escape(atob(attr)))) : null
      if (parsed) return parsed
    } catch {
      // Not ours after all.
    }
  }
  const text = dt.getData('text/plain')
  if (memory && text && text === memory.text) return memory.clip
  return null
}

/** ⌘⇧V: the next paste is plain text (no clip, no link preview). */
export const takePlainPaste = () => {
  const p = Date.now() < plainUntil
  plainUntil = 0
  return p
}

const assetOf = (o: Obj) => (o.kind === 'card' ? (o.content as { assetId?: string } | undefined)?.assetId : undefined)

/** Can the asset behind this card (image, file, poster) be used here? Only if a card on this device already shows it. */
function assetReachable(c: Obj): boolean {
  const assetId = assetOf(c)
  if (!assetId) return true
  return Object.values(doc.objs).some((o) => o.kind === 'card' && !o.purged && assetOf(o) === assetId)
}

/** Paste a clip at a world point (or into a column). One undo step; the new cards end up selected. */
export function pasteClip(clip: ClipPayload, at: Vec, opts: { columnId?: Id } = {}) {
  const target = boardId()
  if (!doc.canWriteObject(doc.getBoard(target))) return
  // Pasting the same clip at the same spot again steps each copy down and right.
  const key = `${clip.roots.join()}@${Math.round(at.x)},${Math.round(at.y)}`
  lastPaste = lastPaste?.key === key ? { key, count: lastPaste.count + 1 } : { key, count: 0 }
  const step = lastPaste.count * GRID
  const point = { x: at.x + step, y: at.y + step }
  const column = opts.columnId ? { id: opts.columnId, orders: ordersBetween(columnChildren(opts.columnId).at(-1)?.order, undefined, clip.roots.length) } : undefined
  if (clip.cut && lastPaste.count === 0 && moveBack(clip, point, column)) {
    // A cut pastes once as a move; later pastes are copies.
    if (memory?.clip === clip) memory = { ...memory, clip: { ...clip, cut: undefined } }
    return
  }
  const { objects, roots } = materialise(clip, { at: point, boardId: target, maxZ: doc.maxZ(target), now: Date.now(), newId, column })
  const blocked = new Set(objects.filter((o) => !assetReachable(o)).map((o) => o.id))
  if (blocked.size) showToast(`${blocked.size} ${blocked.size === 1 ? 'picture or file' : 'pictures or files'} couldn’t come along: they belong to someone else.`)
  const kept = objects.filter((o) => !blocked.has(o.id) && !(o.kind === 'connection' && (blocked.has(o.from) || blocked.has(o.to))))
  if (!kept.length) return
  doc.commit(kept.map((o) => doc.createChange(o)))
  select(roots.filter((id) => !blocked.has(id)))
}

/**
 * A cut being pasted while its cards are still buried from that cut: bring the
 * very same cards back here (ids, comments and history kept), as one step.
 */
function moveBack(clip: ClipPayload, at: Vec, column?: { id: Id; orders: number[] }): boolean {
  const target = boardId()
  const originals = clip.objects.map((o) => doc.get(o.id))
  const roots = clip.roots.map((id) => doc.get(id))
  if (roots.some((r) => !r || r.purged || r.deletedAt !== clip.cut!.at || !doc.canWriteObject(r))) return false
  if (originals.some((o) => !o || o.purged)) return false
  // Board cards keep their board in place only on the same board; elsewhere they copy.
  if (target !== clip.boardId && clip.objects.some((o) => o.kind === 'board')) return false
  let i = 0
  const ids = clip.objects.map((o) => o.id)
  const placed = materialise(clip, { at, boardId: target, maxZ: doc.maxZ(target), now: 0, newId: () => ids[i++], column })
  const patches: Record<Id, Partial<Obj>> = {}
  for (const o of placed.objects) {
    if (o.kind === 'card' && o.boardId === target) {
      const c = o as Card
      patches[c.id] = { boardId: c.boardId, x: c.x, y: c.y, z: c.z, columnId: c.columnId ?? null, order: c.order, ...(clip.roots.includes(c.id) ? { deletedAt: null } : {}) }
    }
    if (o.kind === 'connection') patches[o.id] = { boardId: o.boardId }
  }
  if (target !== clip.boardId) {
    const moved = new Set(Object.keys(patches))
    // Connections can't span boards; comments follow their cards.
    for (const conn of doc.connectionsOn(clip.boardId)) if ((moved.has(conn.from) || moved.has(conn.to)) && !moved.has(conn.id)) patches[conn.id] = { purged: true }
    for (const id of moved) for (const m of doc.commentsOn(id)) patches[m.id] = { boardId: target }
  }
  doc.update(patches)
  select(clip.roots)
  return true
}

// ---- the hidden textarea that makes native copy, cut and paste fire ----------------

let proxy: HTMLTextAreaElement | null = null
export const isClipProxy = (t: EventTarget | null) => !!proxy && t === proxy

function focusProxy(text: string) {
  if (!proxy) {
    proxy = document.createElement('textarea')
    proxy.className = 'clip-proxy'
    proxy.setAttribute('aria-hidden', 'true')
    proxy.tabIndex = -1
    document.body.append(proxy)
  }
  const back = document.activeElement as HTMLElement | null
  proxy.value = text || ' '
  proxy.focus({ preventScroll: true })
  proxy.select()
  // Give focus back once the native command has run.
  setTimeout(() => {
    if (document.activeElement === proxy) {
      proxy!.blur()
      if (back && back !== document.body && back.isConnected) back.focus({ preventScroll: true })
    }
  }, 0)
}

const isTyping = (t: EventTarget | null) => !isClipProxy(t) && !!(t as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"]')

export function installClipboard(opts: { readOnly: boolean }) {
  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod || e.altKey || isTyping(e.target) || editingId()) return
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
    const key = e.key.toLowerCase()
    if ((key === 'c' || key === 'x') && selection().size) {
      if (key === 'x' && opts.readOnly) return
      const clip = clipOfSelection()
      if (!clip) return
      pending = { clip, cut: key === 'x' }
      focusProxy(clipText(clip, boardTitle))
    } else if (key === 'v' && !opts.readOnly) {
      plainUntil = e.shiftKey ? Date.now() + 1000 : 0
      focusProxy('')
    }
  }
  const onCopy = (e: ClipboardEvent) => {
    if (!pending || !isClipProxy(e.target) || !e.clipboardData) return
    e.preventDefault()
    const { clip, cut } = pending
    pending = null
    if (cut) {
      const at = Date.now()
      const cutClip = { ...clip, cut: { at } }
      writeClip(e.clipboardData, cutClip)
      trashSelection(at)
      showToast(`Cut ${clip.roots.length} ${clip.roots.length === 1 ? 'card' : 'cards'}. Paste to put ${clip.roots.length === 1 ? 'it' : 'them'} somewhere else.`, 4000)
    } else writeClip(e.clipboardData, clip)
  }
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('copy', onCopy)
  document.addEventListener('cut', onCopy)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    document.removeEventListener('copy', onCopy)
    document.removeEventListener('cut', onCopy)
  }
}
