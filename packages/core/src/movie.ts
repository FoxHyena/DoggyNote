import type { MovieContent } from './model.ts'

// Movie and show links: which TMDB or IMDb title a pasted URL points at, and the
// TMDB page for a card.

export type MovieRef = { tmdbId: number; kind: 'movie' | 'tv' } | { imdbId: string }

/** The title a TMDB or IMDb link points at, or null for any other URL. */
export function movieRefFromUrl(raw: string): MovieRef | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.replace(/^(www|m)\./, '')
  if (host === 'themoviedb.org') {
    const m = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(movie|tv)\/(\d+)/.exec(u.pathname)
    return m ? { kind: m[1] as 'movie' | 'tv', tmdbId: Number(m[2]) } : null
  }
  if (host === 'imdb.com') {
    const m = /^\/(?:[a-z]{2}\/)?title\/(tt\d{5,10})/.exec(u.pathname)
    return m ? { imdbId: m[1] } : null
  }
  return null
}

export const tmdbPage = (c: Pick<MovieContent, 'tmdbId' | 'kind'>): string | null => (c.tmdbId ? `https://www.themoviedb.org/${c.kind}/${c.tmdbId}` : null)

/** "2h 49m", "45m". */
export function runtimeLabel(minutes: number | undefined): string | null {
  if (!minutes || minutes < 1) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** "2014 · Movie · 2h 49m", "2022 · Show · 2 seasons". */
export function movieSubtitle(c: MovieContent): string {
  const parts: string[] = []
  if (c.year) parts.push(String(c.year))
  parts.push(c.kind === 'tv' ? 'Show' : 'Movie')
  const i = c.info
  if (c.kind === 'tv' && i?.seasons) parts.push(`${i.seasons} ${i.seasons === 1 ? 'season' : 'seasons'}`)
  const rt = c.kind === 'movie' ? runtimeLabel(i?.runtime) : null
  if (rt) parts.push(rt)
  return parts.join(' · ')
}

/** The streaming region for a browser language: "en-GB" → "GB", else US. */
export function regionOf(language: string | undefined): string {
  const m = /[-_]([A-Za-z]{2})\b/.exec(language ?? '')
  return m ? m[1].toUpperCase() : 'US'
}
