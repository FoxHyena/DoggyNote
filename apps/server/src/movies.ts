import { Hono } from 'hono'
import type { AppEnv, Env } from './env.ts'

// Movie and show cards, from TMDB (https://www.themoviedb.org). Search returns a
// few titles with small posters straight from TMDB's image CDN; resolving a title
// fetches its details and copies its poster into R2 as an ordinary image asset
// (owned by whoever resolved it), so share links, the desktop app's image tokens
// and private Inboxes all treat posters like any other image.
//
// Needs TMDB_TOKEN (an API Read Access Token: wrangler secret put TMDB_TOKEN).
// TMDB_BASE and TMDB_IMAGE_BASE point tests at a stand-in.

export type MovieKind = 'movie' | 'tv'
export type SearchHit = { tmdbId: number; kind: MovieKind; title: string; year?: number; thumb?: string }
export type Providers = { region: string; link?: string; stream?: string[]; rent?: string[]; buy?: string[] }
export type Resolved = {
  tmdbId: number
  kind: MovieKind
  title: string
  year?: number
  imdbId?: string
  posterPath?: string
  info: { runtime?: number; seasons?: number; episodes?: number; genres?: string[]; overview?: string; providers?: Providers; fetchedAt: number }
}

const NOT_SET_UP = 'Movie search isn’t set up on this server yet.'
const POSTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_POSTER = 2 * 1024 * 1024
/** Stored renditions: `thumb` for the card and overview, `small` for big zooms. */
const POSTER_SIZES = [['thumb', 'w185'], ['small', 'w500']] as const

class TmdbError extends Error {
  constructor(readonly status: number) {
    super(`tmdb ${status}`)
  }
}

const base = (env: Env) => (env.TMDB_BASE ?? 'https://api.themoviedb.org/3').replace(/\/$/, '')
const imageBase = (env: Env) => (env.TMDB_IMAGE_BASE ?? 'https://image.tmdb.org/t/p').replace(/\/$/, '')

async function tmdb<T>(env: Env, path: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${base(env)}${path}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${env.TMDB_TOKEN}`, accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new TmdbError(res.status)
  return (await res.json()) as T
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1_000_000_000 ? v : undefined)
const yearOf = (date: unknown): number | undefined => {
  const y = typeof date === 'string' ? Number(date.slice(0, 4)) : NaN
  return y >= 1800 && y <= 3000 ? y : undefined
}
/** TMDB image paths look like "/abc123.jpg"; anything else is ignored. */
const posterPathOf = (v: unknown): string | undefined => (typeof v === 'string' && /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(v) ? v : undefined)
const names = (list: unknown, key: string): string[] | undefined => {
  if (!Array.isArray(list)) return undefined
  const out = [...new Set(list.map((x) => str((x as Record<string, unknown>)?.[key], 200)).filter((x): x is string => !!x))].slice(0, 20)
  return out.length ? out : undefined
}

/** /search/multi results: films and shows only (no people), at most 8. */
export function toHits(json: unknown, images: string): SearchHit[] {
  const results = (json as { results?: unknown })?.results
  if (!Array.isArray(results)) return []
  const hits: SearchHit[] = []
  for (const r of results as Record<string, unknown>[]) {
    const kind = r.media_type
    const tmdbId = int(r.id)
    if ((kind !== 'movie' && kind !== 'tv') || !tmdbId) continue
    const title = str(kind === 'movie' ? r.title : r.name, 500)
    if (!title) continue
    const poster = posterPathOf(r.poster_path)
    hits.push({ tmdbId, kind, title, year: yearOf(kind === 'movie' ? r.release_date : r.first_air_date), thumb: poster ? `${images}/w92${poster}` : undefined })
    if (hits.length === 8) break
  }
  return hits
}

/** /movie/:id or /tv/:id with watch/providers and external_ids appended. */
export function toResolved(json: unknown, kind: MovieKind, region: string, now = Date.now()): Resolved | null {
  const d = json as Record<string, unknown>
  const tmdbId = int(d?.id)
  const title = str(kind === 'movie' ? d?.title : d?.name, 500)
  if (!tmdbId || !title) return null
  const imdb = str(d.imdb_id, 20) ?? str((d.external_ids as Record<string, unknown> | undefined)?.imdb_id, 20)
  const all = ((d['watch/providers'] as Record<string, unknown> | undefined)?.results ?? {}) as Record<string, Record<string, unknown>>
  const here = all[region]
  const link = str(here?.link, 2000)
  const providers: Providers | undefined = here
    ? { region, ...(link?.startsWith('https://') ? { link } : {}), stream: names(here.flatrate, 'provider_name'), rent: names(here.rent, 'provider_name'), buy: names(here.buy, 'provider_name') }
    : undefined
  const runtime = kind === 'movie' ? int(d.runtime) : undefined
  return {
    tmdbId,
    kind,
    title,
    year: yearOf(kind === 'movie' ? d.release_date : d.first_air_date),
    imdbId: imdb && /^tt\d{5,10}$/.test(imdb) ? imdb : undefined,
    posterPath: posterPathOf(d.poster_path),
    info: {
      ...(runtime ? { runtime } : {}),
      ...(kind === 'tv' ? { seasons: int(d.number_of_seasons), episodes: int(d.number_of_episodes) } : {}),
      genres: names(d.genres, 'name'),
      overview: str(d.overview, 4000),
      providers,
      fetchedAt: now,
    },
  }
}

/** Copy the poster into R2 (two sizes). Null if TMDB has none or it won't load. */
async function storePoster(env: Env, posterPath: string, userId: string): Promise<string | null> {
  const assetId = crypto.randomUUID()
  for (const [size, width] of POSTER_SIZES) {
    const res = await fetch(`${imageBase(env)}/${width}${posterPath}`, { signal: AbortSignal.timeout(8000) })
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!res.ok || !POSTER_TYPES.has(type)) return null
    const body = await res.arrayBuffer()
    if (!body.byteLength || body.byteLength > MAX_POSTER) return null
    await env.BUCKET.put(`${assetId}/${size}`, body, { httpMetadata: { contentType: type } })
    await env.DB.prepare('INSERT OR IGNORE INTO assets (id, size, mime, bytes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(assetId, size, type, body.byteLength, userId, Date.now())
      .run()
  }
  return assetId
}

function failure(e: unknown): { error: string; status: 404 | 502 } {
  if (e instanceof TmdbError && e.status === 404) return { error: 'Couldn’t find that title.', status: 404 }
  return { error: 'Couldn’t reach the movie database. Try again in a moment.', status: 502 }
}

export const movies = new Hono<AppEnv>()

movies.get('/movies/search', async (c) => {
  if (!c.env.TMDB_TOKEN) return c.json({ error: NOT_SET_UP, notSetUp: true }, 503)
  const q = (c.req.query('q') ?? '').trim().slice(0, 200)
  if (!q) return c.json({ results: [] })
  try {
    const json = await tmdb(c.env, '/search/multi', { query: q, include_adult: 'false', language: 'en-US', page: '1' })
    // Same query, same answer for a while: let the browser keep it.
    return c.json({ results: toHits(json, imageBase(c.env)) }, 200, { 'cache-control': 'private, max-age=3600' })
  } catch (e) {
    const f = failure(e)
    return c.json({ error: f.error }, f.status)
  }
})

/**
 * Details for one title, by TMDB id (with kind) or IMDb id. With `poster` (the
 * default) the poster is stored and its asset id returned; a refresh passes false.
 */
movies.post('/movies/resolve', async (c) => {
  if (!c.env.TMDB_TOKEN) return c.json({ error: NOT_SET_UP, notSetUp: true }, 503)
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  const region = typeof body?.region === 'string' && /^[A-Z]{2}$/.test(body.region) ? body.region : 'US'
  let tmdbId = int(body?.tmdbId)
  let kind: MovieKind | undefined = body?.kind === 'movie' || body?.kind === 'tv' ? body.kind : undefined
  const imdbId = typeof body?.imdbId === 'string' && /^tt\d{5,10}$/.test(body.imdbId) ? body.imdbId : undefined
  if (!(tmdbId && kind) && !imdbId) return c.json({ error: 'Give a tmdbId and kind, or an imdbId' }, 400)
  try {
    if (!(tmdbId && kind)) {
      const found = await tmdb<{ movie_results?: { id?: unknown }[]; tv_results?: { id?: unknown }[] }>(c.env, `/find/${imdbId}`, { external_source: 'imdb_id' })
      const movie = int(found.movie_results?.[0]?.id)
      const tv = int(found.tv_results?.[0]?.id)
      if (!movie && !tv) return c.json({ error: 'Couldn’t find that title.' }, 404)
      tmdbId = movie ?? tv
      kind = movie ? 'movie' : 'tv'
    }
    const json = await tmdb(c.env, `/${kind}/${tmdbId}`, { append_to_response: 'watch/providers,external_ids', language: 'en-US' })
    const resolved = toResolved(json, kind!, region)
    if (!resolved) return c.json({ error: 'Couldn’t find that title.' }, 404)
    const { posterPath, ...rest } = resolved
    let assetId: string | null = null
    if (body?.poster !== false && posterPath) {
      // A poster that won't load isn't worth failing the card over.
      assetId = await storePoster(c.env, posterPath, c.get('user').id).catch(() => null)
    }
    return c.json({ ...rest, ...(assetId ? { assetId } : {}) })
  } catch (e) {
    const f = failure(e)
    return c.json({ error: f.error }, f.status)
  }
})
