import { worldPosition } from '../canvas/layout.ts'
import { areaAt, areaPlacement, addingToArea, setAddingToArea } from './areas.ts'
import { batch, createEffect, createRoot, createSignal, onCleanup, untrack } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { newId, screenToWorld, stickerHeight, type Sticker, type StickerAsset, type Vec } from '@doggynote/core'
import { api } from './api.ts'
import * as doc from './doc.ts'
import { boardId, camera, clearSelection, endEdit, select, setConnectMode, viewport } from './ui.ts'
import { user } from './session.ts'
import { showToast } from './toast.ts'
import { phone } from './device.ts'

export type PackSticker = StickerAsset & { available: boolean; error?: string; animationError?: string; keywords?: string[] }
export type StickerPack = { name: string; title: string; stickers: PackSticker[] }
type Preferences = { assetId: string; favorite: number; recentAt: number | null }[]
// Pack objects and sticker tiles keep their identity through progress/collection
// refreshes, including refreshes received while a tile owns pointer capture.
const [collection, setCollection] = createStore<Record<string, StickerPack>>({})
const [packNames, setPackNames] = createSignal<string[]>([])
export const packs = () => packNames().map((name) => collection[name])
function setPacks(next: StickerPack[]) {
  batch(() => {
    setCollection(reconcile(Object.fromEntries(next.map((p) => [p.name, p])), { key: 'assetId' }))
    const names = next.map((p) => p.name)
    const previous = untrack(packNames)
    if (names.length !== previous.length || names.some((name, i) => name !== previous[i])) setPackNames(names)
  })
}
export const [preferences, setPreferences] = createSignal<Preferences>([])
export const [stickerTrayOpen, setStickerTrayOpen] = createSignal(false)
// A per-device preference, like snap-to-grid.
const PIN_KEY = 'doggynote.stickerTrayPinned'
const [pinnedSetting, setPinnedSetting] = createSignal((() => { try { return localStorage.getItem(PIN_KEY) === '1' } catch { return false } })())
/** A pinned tray stays open while you place stickers. Phones use the bottom sheet, which never pins. */
export const stickerTrayPinned = () => pinnedSetting() && !phone()
export function setStickerTrayPinned(on: boolean) {
  setPinnedSetting(on)
  try { localStorage.setItem(PIN_KEY, on ? '1' : '0') } catch { /* storage unavailable: still works for this session */ }
}
export const [selectedPack, setSelectedPack] = createSignal('recent')
/** False until this account's collection has loaded once, so the tray never claims it is empty early. */
export const [collectionLoaded, setCollectionLoaded] = createSignal(false)
export const [armedSticker, setArmedSticker] = createSignal<StickerAsset | null>(null)
export const [stickerGhost, setStickerGhost] = createSignal<{ sticker: StickerAsset; at: Vec; touch?: boolean } | null>(null)
export const STICKER_TOUCH_OFFSET = 56
export const trayScroll = new Map<string, number>()
export const trayHorizontalScroll = new Map<string, number>()
let generation = 0, refreshRequest = 0
createRoot(() => createEffect(() => {
  user()?.id
  generation++
  setPacks([]); setPreferences([]); setCollectionLoaded(false); setSelectedPack('recent'); setStickerTrayOpen(false); cancelStickerPlacement(); trayScroll.clear(); trayHorizontalScroll.clear()
}))

export type TelegramStatus = { configured: boolean; pair: { label: string } | null; challenge: { expiresAt: number; telegramId: string | null; label: string | null } | null; pending: { packName: string | null; title?: string | null; notice: string | null } | null; suggestions?: { packName: string; title: string | null; receivedAt: number }[] }
/** The latest Telegram connection state, shared by the tray, its badge and the connection screen. */
export const [telegramStatus, setTelegramStatus] = createSignal<TelegramStatus | null>(null)
/** Packs sent to the bot that haven't been added or dismissed, newest first. Keyed so rows keep their identity. */
const [suggestionList, setSuggestionList] = createStore<{ name: string; title: string }[]>([])
export const suggestions = suggestionList
function applySuggestions(status: TelegramStatus | null) {
  // Older servers only report the latest pack.
  const list = status?.suggestions ?? (status?.pending?.packName ? [{ packName: status.pending.packName, title: status.pending.title ?? null }] : [])
  setSuggestionList(reconcile(list.map((s) => ({ name: s.packName, title: s.title || s.packName })), { key: 'name' }))
}
let telegramRequest = 0
export async function refreshTelegram() {
  const current = generation, request = ++telegramRequest
  const result = await api<TelegramStatus>('/api/stickers/telegram')
  if (current === generation && request === telegramRequest) { setTelegramStatus(result); applySuggestions(result) }
  return result
}
createRoot(() => createEffect(() => {
  if (!user()?.id) return
  setTelegramStatus(null); applySuggestions(null)
  const check = () => { if (document.visibilityState === 'visible') void refreshTelegram().catch(() => {}) }
  check()
  // Only a connected account can receive packs, so only it keeps checking in the background.
  const timer = setInterval(() => { if (telegramStatus()?.pair) check() }, 20_000)
  window.addEventListener('focus', check); document.addEventListener('visibilitychange', check)
  onCleanup(() => { clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) })
}))

export const stickerContent = (s: StickerAsset): StickerAsset => ({ assetId: s.assetId, stickerId: s.stickerId, packName: s.packName, emoji: s.emoji, width: s.width, height: s.height, format: s.format })
export async function refreshStickers() {
  const current = generation, request = ++refreshRequest
  const result = await api<{ packs: StickerPack[]; preferences: Preferences }>('/api/stickers')
  if (current !== generation || request !== refreshRequest) return
  setPacks(result.packs)
  if (JSON.stringify(preferences()) !== JSON.stringify(result.preferences)) setPreferences(result.preferences)
  setCollectionLoaded(true)
}
export function openStickers() { endEdit(); setConnectMode(null); setStickerTrayOpen(true) }
export function armSticker(sticker: StickerAsset) {
  endEdit(); setConnectMode(null); clearSelection()
  setArmedSticker(stickerContent(sticker)); setStickerGhost(null)
  if (!stickerTrayPinned()) setStickerTrayOpen(false)
  queueMicrotask(() => document.querySelector<HTMLElement>('[data-testid="sticker-placement"] button')?.focus({ preventScroll: true }))
}
export function cancelStickerPlacement() { setArmedSticker(null); setStickerGhost(null) }
export function canvasStickerPoint(client: Vec): Vec | null {
  const v = viewport()
  if (client.x < v.left || client.y < v.top || client.x > v.left + v.width || client.y > v.top + v.height) return null
  return screenToWorld(camera(), { x: client.x - v.left, y: client.y - v.top })
}
export function placeSticker(content: StickerAsset, at?: Vec): string | null {
  if (!doc.canWriteObject(doc.getBoard(boardId()))) return null
  const v = viewport(), cam = camera()
  const center = at ?? screenToWorld(cam, { x: v.width / 2, y: v.height / 2 })
  // Useful screen size at every zoom; the persisted width remains in world units.
  const w = Math.max(48, Math.min(320, Math.min(v.width * .28, v.height * .24, 144) / cam.zoom) * Math.min(1, content.width / content.height))
  const id = newId(), h = w * content.height / content.width
  const z = Math.max(0, ...doc.stickersOn(boardId()).map((s) => s.z)) + 1
  const obj: Sticker = { id, kind: 'sticker', boardId: boardId(), x: center.x - w / 2, y: center.y - h / 2, w, angle: 0, z, content: stickerContent(content), createdAt: Date.now() }
  const area = addingToArea() ? doc.getCard(addingToArea()) : areaAt(center)
  Object.assign(obj, areaPlacement({ x: obj.x, y: obj.y }, area)); setAddingToArea(null)
  doc.commit([doc.createChange(obj)])
  if (!doc.get(id)) return null
  select([id]); cancelStickerPlacement()
  // Placement owns the undo entry; collection recency is independent personal metadata.
  void api(`/api/stickers/preferences/${content.assetId}`, { method: 'POST', json: { recent: true } }).then(refreshStickers).catch(() => showToast('Placed. Recent stickers will refresh when the connection returns.'))
  return id
}
export function duplicateSticker(s: Sticker) {
  const id = newId(), z = Math.max(0, ...doc.stickersOn(boardId()).map((s) => s.z)) + 1
  doc.commit([doc.createChange({ ...JSON.parse(JSON.stringify(s)), id, boardId: boardId(), x: s.x + 20, y: s.y + 20, z, createdAt: Date.now(), deletedAt: null, purged: false })])
  select([id])
}
export function reorderSticker(s: Sticker, direction: 1 | -1) {
  const sorted = [...doc.stickersOn(s.boardId)].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id))
  const i = sorted.findIndex((a) => a.id === s.id), j = i + direction
  if (!sorted[j]) return
  ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
  doc.update(Object.fromEntries(sorted.map((o, index) => [o.id, { z: index + 1 }])))
}
export async function favoriteSticker(s: StickerAsset) {
  const favorite = !preferences().find((p) => p.assetId === s.assetId)?.favorite
  await api(`/api/stickers/preferences/${s.assetId}`, { method: 'POST', json: { favorite } })
  await refreshStickers()
}
export function stickerCenter(s: Sticker): Vec { const p = doc.get(s.id) === s ? worldPosition(s) : { x: s.x, y: s.y }; return { x: p.x + s.w / 2, y: p.y + stickerHeight(s) / 2 } }
