import { createEffect, createRoot, untrack } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { ApiError, api } from './api.ts'
import { user } from './session.ts'
import { packs, refreshStickers, suggestions, type StickerPack } from './stickers.ts'
import { requestPool } from './requestPool.ts'

/** One pack's preview manifest and preparation progress, shared by every view of it. */
export type PackLoad = { pack: StickerPack; preparing: boolean; error: string; retryAt: number }
const key = (name: string) => name.toLowerCase()
const [loads, setLoads] = createStore<Record<string, PackLoad>>({})
export const packLoad = (name: string | null | undefined): PackLoad | undefined => name ? loads[key(name)] : undefined
export const readyCount = (pack: StickerPack) => pack.stickers.filter((s) => s.available).length

let generation = 0, running = 0
let controller = new AbortController()
// One budget for suggested packs and packs opened manually, not two per pack.
const loadRequests = requestPool(2)
const opening = new Map<string, Promise<StickerPack>>(), preparing = new Map<string, Promise<void>>()
// Packs sent from Telegram start preparing as soon as the app sees them, two packs at a time.
const queue: string[] = [], queued = new Set<string>()
createRoot(() => createEffect(() => {
  user()?.id
  controller.abort(); controller = new AbortController()
  generation++; opening.clear(); preparing.clear(); queue.length = 0; queued.clear(); running = 0
  untrack(() => setLoads(Object.fromEntries(Object.keys(loads).map((k) => [k, undefined])) as unknown as Record<string, PackLoad>))
}))

/** Fetches a pack's manifest and a preview grant. Reuses what this session already has. */
export function openPack(name: string, fresh = false): Promise<StickerPack> {
  const k = key(name), known = loads[k]
  if (known && !fresh) return Promise.resolve(known.pack)
  const pending = opening.get(k)
  if (pending) return pending
  const current = generation
  const result = api<{ pack: StickerPack }>('/api/stickers/preview', { method: 'POST', json: { link: name } }).then(({ pack }) => {
    if (current === generation) {
      const k = key(pack.name)
      if (loads[k]) updatePack(k, pack)
      else setLoads(k, { preparing: false, error: '', retryAt: 0, pack })
    }
    return pack
  }).finally(() => { if (current === generation) opening.delete(k) })
  opening.set(k, result)
  return result
}

// Concurrent responses can be older snapshots: never roll a ready sticker back.
function merge(old: StickerPack | undefined, next: StickerPack): StickerPack {
  const known = new Map(old?.stickers.map((s) => [s.assetId, s]))
  return { ...next, stickers: next.stickers.map((s) => known.get(s.assetId)?.available && !s.available ? known.get(s.assetId)! : s) }
}
function updatePack(k: string, next: StickerPack) {
  // Reconcile even unavailable entries: a new progress snapshot must not remount
  // pending tiles, lose focus, or interrupt a held pointer.
  setLoads(k, 'pack', reconcile(merge(loads[k]?.pack, next), { key: 'assetId' }))
}

/** Prepares a previewed pack's stickers in steps of three, two requests at a time. */
export function preparePack(name: string): Promise<void> {
  const k = key(name), running = preparing.get(k)
  if (running) return running
  const load = loads[k]
  if (!load || load.retryAt > Date.now()) return Promise.resolve()
  const current = generation, signal = controller.signal, step = 3, pack = load.pack
  const ranges = Array.from({ length: Math.ceil(pack.stickers.length / step) }, (_, i) => i * step)
    .filter((i) => pack.stickers.slice(i, i + step).some((s) => !s.available))
  setLoads(k, { preparing: true, error: '', retryAt: 0 })
  let next = 0, failure: unknown
  const worker = async () => {
    while (current === generation && !failure && next < ranges.length) {
      const offset = ranges[next++]
      try {
        await loadRequests(async () => {
          // A sibling request may have been rate limited while this one waited.
          if (failure || current !== generation) return
          try {
            const result = await api<{ pack: StickerPack }>(`/api/stickers/packs/${encodeURIComponent(pack.name)}/load`, { method: 'POST', json: { offset, count: step }, signal })
            if (current === generation) updatePack(k, result.pack)
          } catch (e) { failure ??= e }
        }, signal)
      } catch (e) { failure ??= e }
    }
  }
  const work = Promise.all([worker(), worker()]).then(() => {
    if (current !== generation) return
    const rate = failure instanceof ApiError && failure.status === 429
    setLoads(k, {
      preparing: false,
      error: failure ? failure instanceof Error ? failure.message : 'Some stickers could not be prepared.' : '',
      retryAt: rate ? Date.now() + Math.min(3600, Math.max(1, Number((failure as ApiError).details.retryAfter) || 30)) * 1000 : 0,
    })
    // A pack added while it was still preparing refreshes its collection entry once it finishes.
    if (packs().some((p) => key(p.name) === k)) void refreshStickers().catch(() => {})
  }).finally(() => { if (current === generation) preparing.delete(k) })
  preparing.set(k, work)
  return work
}

function pump() {
  while (running < 2 && queue.length) {
    const name = queue.shift()!, current = generation
    running++
    void openPack(name).then(() => preparePack(name)).catch(() => {}).finally(() => { if (current === generation) { running--; pump() } })
  }
}
createRoot(() => createEffect(() => {
  for (const s of suggestions) {
    const k = key(s.name)
    if (queued.has(k) || untrack(() => loads[k])) continue
    queued.add(k); queue.push(s.name)
  }
  untrack(pump)
}))
