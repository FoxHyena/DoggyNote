import { describe, expect, it } from 'vitest'
import { app } from './app.ts'
import { toHits, toResolved } from './movies.ts'

const IMG = 'https://image.tmdb.org/t/p'

describe('movie search results', () => {
  it('keeps films and shows, drops people and junk, and builds small poster URLs', () => {
    const hits = toHits({ results: [
      { media_type: 'movie', id: 157336, title: 'Interstellar', release_date: '2014-11-05', poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg' },
      { media_type: 'person', id: 1, name: 'Matthew McConaughey' },
      { media_type: 'tv', id: 95396, name: 'Severance', first_air_date: '2022-02-17', poster_path: null },
      { media_type: 'movie', id: 'x', title: 'Bad id' },
      { media_type: 'movie', id: 5, title: '' },
      { media_type: 'movie', id: 6, title: 'Odd poster', poster_path: 'javascript:alert(1)' },
    ] }, IMG)
    expect(hits).toEqual([
      { tmdbId: 157336, kind: 'movie', title: 'Interstellar', year: 2014, thumb: `${IMG}/w92/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg` },
      { tmdbId: 95396, kind: 'tv', title: 'Severance', year: 2022, thumb: undefined },
      { tmdbId: 6, kind: 'movie', title: 'Odd poster', year: undefined, thumb: undefined },
    ])
  })
  it('caps at eight and survives a malformed response', () => {
    expect(toHits({ results: Array.from({ length: 20 }, (_, i) => ({ media_type: 'movie', id: i + 1, title: `Dog ${i}` })) }, IMG)).toHaveLength(8)
    expect(toHits(null, IMG)).toEqual([])
    expect(toHits({ results: 'nope' }, IMG)).toEqual([])
  })
})

describe('movie details', () => {
  const film = {
    id: 157336, title: 'Interstellar', release_date: '2014-11-05', runtime: 169, imdb_id: 'tt0816692', poster_path: '/p.jpg', overview: ' A team travels through a wormhole. ',
    genres: [{ name: 'Adventure' }, { name: 'Drama' }, { name: 'Adventure' }],
    'watch/providers': { results: {
      US: { link: 'https://www.themoviedb.org/movie/157336/watch?locale=US', flatrate: [{ provider_name: 'Paramount Plus' }], rent: [{ provider_name: 'Apple TV' }], buy: [{ provider_name: 'Apple TV' }] },
      GB: { link: 'javascript:alert(1)', flatrate: [{ provider_name: 'Netflix' }] },
    } },
  }
  it('maps a film for a region', () => {
    expect(toResolved(film, 'movie', 'US', 7)).toEqual({
      tmdbId: 157336, kind: 'movie', title: 'Interstellar', year: 2014, imdbId: 'tt0816692', posterPath: '/p.jpg',
      info: { runtime: 169, genres: ['Adventure', 'Drama'], overview: 'A team travels through a wormhole.', fetchedAt: 7,
        providers: { region: 'US', link: 'https://www.themoviedb.org/movie/157336/watch?locale=US', stream: ['Paramount Plus'], rent: ['Apple TV'], buy: ['Apple TV'] } },
    })
  })
  it('refuses non-https watch links and leaves providers out where there are none', () => {
    expect(toResolved(film, 'movie', 'GB')!.info.providers).toEqual({ region: 'GB', stream: ['Netflix'], rent: undefined, buy: undefined })
    expect(toResolved(film, 'movie', 'JP')!.info.providers).toBeUndefined()
  })
  it('maps a show, taking the IMDb id from external_ids', () => {
    const r = toResolved({ id: 95396, name: 'Severance', first_air_date: '2022-02-17', number_of_seasons: 2, number_of_episodes: 19, external_ids: { imdb_id: 'tt11280740' } }, 'tv', 'US', 1)!
    expect(r).toMatchObject({ tmdbId: 95396, kind: 'tv', title: 'Severance', year: 2022, imdbId: 'tt11280740', info: { seasons: 2, episodes: 19 } })
    expect(r.info.runtime).toBeUndefined()
  })
  it('rejects a response without an id or title', () => {
    expect(toResolved({ title: 'No id' }, 'movie', 'US')).toBeNull()
    expect(toResolved({ id: 1 }, 'movie', 'US')).toBeNull()
  })
})

it('movie search needs a session', async () => {
  expect((await app.request('/api/movies/search?q=dog')).status).toBe(401)
  expect((await app.request('/api/movies/resolve', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(401)
})
