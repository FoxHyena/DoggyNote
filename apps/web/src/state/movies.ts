import { regionOf, type Card, type Id, type MovieContent, type MovieInfo } from '@doggynote/core'
import { api } from './api.ts'
import * as doc from './doc.ts'

// Movie cards: search TMDB through the Worker, then resolve a title into its
// details and a stored poster (see apps/server/src/movies.ts).

export type SearchHit = { tmdbId: number; kind: 'movie' | 'tv'; title: string; year?: number; thumb?: string }
type Resolved = { tmdbId: number; kind: 'movie' | 'tv'; title: string; year?: number; imdbId?: string; assetId?: string; info: MovieInfo }

/** Where-to-watch region, from the browser's language. */
export const region = () => regionOf(navigator.language)

export async function searchMovies(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  return (await api<{ results: SearchHit[] }>(`/api/movies/search?q=${encodeURIComponent(q)}`, { signal })).results
}

const inFlight = new Set<Id>()

/**
 * Fill in a movie card: details, plus its poster the first time. Not an undo
 * step (like a link preview). On a card that's already resolved it refreshes the details.
 */
export async function resolveMovie(id: Id) {
  const card = doc.getCard(id) as Card<'movie'> | undefined
  if (!card || card.type !== 'movie' || inFlight.has(id) || doc.isReadOnly()) return
  const c = card.content
  if (!c.tmdbId && !c.imdbId) return
  inFlight.add(id)
  try {
    const r = await api<Resolved>('/api/movies/resolve', {
      method: 'POST',
      json: { ...(c.tmdbId ? { tmdbId: c.tmdbId, kind: c.kind } : { imdbId: c.imdbId }), region: region(), poster: !c.assetId },
    })
    const cur = doc.getCard(id) as Card<'movie'> | undefined
    if (!cur) return
    const next: MovieContent = { ...cur.content, tmdbId: r.tmdbId, kind: r.kind, title: r.title, year: r.year, imdbId: r.imdbId, info: r.info, status: 'ok' }
    if (r.assetId && !cur.content.assetId) next.assetId = r.assetId
    doc.silent({ [id]: { content: next } as Partial<Card> })
  } catch (err) {
    const cur = doc.getCard(id) as Card<'movie'> | undefined
    // Offline: leave it pending so it retries next time the card mounts.
    if (cur && navigator.onLine && cur.content.status === 'pending') doc.silent({ [id]: { content: { ...cur.content, status: 'error' } } as Partial<Card> })
    console.warn('[doggynote] movie lookup failed', err)
  } finally {
    inFlight.delete(id)
  }
}
