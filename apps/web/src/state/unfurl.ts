import type { Card, Id } from '@doggynote/core'
import { API_BASE, api, apiRaw, isShareViewer } from './api.ts'
import * as doc from './doc.ts'

export type Unfurled = { title?: string; description?: string; image?: string; siteName?: string }

const inFlight = new Set<Id>()

/** Fetch a link card's title/description/image through the Worker. Not an undo step. */
export async function unfurl(id: Id, opts: { keepStatusOnError?: boolean } = {}) {
  const card = doc.getCard(id) as Card<'link'> | undefined
  if (!card || inFlight.has(id) || doc.isReadOnly()) return
  inFlight.add(id)
  try {
    const meta = await api<Unfurled>(`/api/unfurl?url=${encodeURIComponent(card.content.url)}`)
    const cur = doc.getCard(id) as Card<'link'> | undefined
    if (cur) doc.silent({ [id]: { content: { ...cur.content, ...meta, title: meta.title || cur.content.title, status: 'ok' } } as Partial<Card> })
  } catch (err) {
    const cur = doc.getCard(id) as Card<'link'> | undefined
    // Offline: leave it pending so it retries next time the card mounts.
    if (cur && navigator.onLine && !opts.keepStatusOnError) doc.silent({ [id]: { content: { ...cur.content, status: 'error' } } as Partial<Card> })
    console.warn('[doggynote] unfurl failed', err)
  } finally {
    inFlight.delete(id)
  }
}

const retried = new Set<Id>()

/**
 * A preview that came back with no title and no image (the site served the
 * Worker a bare page) gets one more try per session. A failure keeps it as is.
 */
export function retryEmptyPreview(id: Id) {
  if (retried.has(id)) return
  retried.add(id)
  void unfurl(id, { keepStatusOnError: true })
}

const proxied = new Map<string, Promise<string | null>>()

/**
 * Some sites refuse to serve their preview image to a browser on another
 * origin. The Worker fetches it for signed-in people; we show it from a blob.
 * Resolves null when there's no session (the share viewer) or the proxy fails.
 */
export function proxiedImage(url: string): Promise<string | null> {
  if (isShareViewer() || !/^https?:/.test(url)) return Promise.resolve(null)
  try {
    if (new URL(url).origin === new URL(API_BASE || location.origin).origin) return Promise.resolve(null)
  } catch {
    return Promise.resolve(null)
  }
  let p = proxied.get(url)
  if (!p) {
    p = apiRaw(`/api/proxy-image?url=${encodeURIComponent(url)}`)
      .then(async (res) => URL.createObjectURL(await res.blob()))
      .catch(() => null)
    proxied.set(url, p)
  }
  return p
}
