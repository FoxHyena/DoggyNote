import type { Card, Id } from '@doggynote/core'
import { api } from './api.ts'
import * as doc from './doc.ts'

export type Unfurled = { title?: string; description?: string; image?: string; siteName?: string }

const inFlight = new Set<Id>()

/** Fetch a link card's title/description/image through the Worker. Not an undo step. */
export async function unfurl(id: Id) {
  const card = doc.getCard(id) as Card<'link'> | undefined
  if (!card || inFlight.has(id) || doc.isReadOnly()) return
  inFlight.add(id)
  try {
    const meta = await api<Unfurled>(`/api/unfurl?url=${encodeURIComponent(card.content.url)}`)
    const cur = doc.getCard(id) as Card<'link'> | undefined
    if (cur) doc.silent({ [id]: { content: { ...cur.content, ...meta, status: 'ok' } } as Partial<Card> })
  } catch (err) {
    const cur = doc.getCard(id) as Card<'link'> | undefined
    // Offline: leave it pending so it retries next time the card mounts.
    if (cur && navigator.onLine) doc.silent({ [id]: { content: { ...cur.content, status: 'error' } } as Partial<Card> })
    console.warn('[doggynote] unfurl failed', err)
  } finally {
    inFlight.delete(id)
  }
}
