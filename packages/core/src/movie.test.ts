import { describe, expect, it } from 'vitest'
import { movieRefFromUrl, movieSubtitle, regionOf, runtimeLabel, tmdbPage } from './movie.ts'

describe('movie links', () => {
  it('reads TMDB movie and show links, with or without a slug or language', () => {
    expect(movieRefFromUrl('https://www.themoviedb.org/movie/157336-interstellar')).toEqual({ kind: 'movie', tmdbId: 157336 })
    expect(movieRefFromUrl('https://themoviedb.org/tv/95396')).toEqual({ kind: 'tv', tmdbId: 95396 })
    expect(movieRefFromUrl('https://www.themoviedb.org/tv/95396-severance/season/1?language=en-US')).toEqual({ kind: 'tv', tmdbId: 95396 })
  })
  it('reads IMDb title links, desktop and mobile', () => {
    expect(movieRefFromUrl('https://www.imdb.com/title/tt0816692/')).toEqual({ imdbId: 'tt0816692' })
    expect(movieRefFromUrl('https://m.imdb.com/title/tt11280740/?ref_=nv_sr')).toEqual({ imdbId: 'tt11280740' })
  })
  it('ignores everything else', () => {
    for (const u of ['https://www.themoviedb.org/person/1', 'https://www.imdb.com/name/nm0000190/', 'https://example.com/movie/1', 'javascript:alert(1)', 'not a url', 'https://evilthemoviedb.org/movie/1'])
      expect(movieRefFromUrl(u)).toBeNull()
  })
  it('links a card back to its TMDB page', () => {
    expect(tmdbPage({ tmdbId: 157336, kind: 'movie' })).toBe('https://www.themoviedb.org/movie/157336')
    expect(tmdbPage({ kind: 'tv' })).toBeNull()
  })
})

describe('labels', () => {
  it('formats runtimes', () => {
    expect(runtimeLabel(169)).toBe('2h 49m')
    expect(runtimeLabel(120)).toBe('2h')
    expect(runtimeLabel(45)).toBe('45m')
    expect(runtimeLabel(0)).toBeNull()
  })
  it('builds the subtitle line', () => {
    expect(movieSubtitle({ kind: 'movie', title: 'Interstellar', year: 2014, info: { runtime: 169, fetchedAt: 0 } })).toBe('2014 · Movie · 2h 49m')
    expect(movieSubtitle({ kind: 'tv', title: 'Severance', year: 2022, info: { seasons: 1, fetchedAt: 0 } })).toBe('2022 · Show · 1 season')
    expect(movieSubtitle({ kind: 'tv', title: 'Unknown' })).toBe('Show')
  })
  it('picks a streaming region from the language', () => {
    expect(regionOf('en-GB')).toBe('GB')
    expect(regionOf('pt_br')).toBe('BR')
    expect(regionOf('fr')).toBe('US')
    expect(regionOf(undefined)).toBe('US')
  })
})
