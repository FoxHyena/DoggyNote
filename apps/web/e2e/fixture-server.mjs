// Tiny static server for e2e fixtures (link previews), so tests never touch the
// real internet. Port 5180, or FIXTURE_PORT (see ports.ts).
import { createServer } from 'node:http'
import { crc32, deflateSync } from 'node:zlib'

/** A solid 16×16 PNG, built here so there's no binary fixture to check in. */
function solidPng([r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(16, 0)
  ihdr.writeUInt32BE(16, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  const rows = Buffer.alloc(16 * (1 + 16 * 3))
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) rows.set([r, g, b], y * 49 + 1 + x * 3)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const PAGES = {
  '/og.html': `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Good Boy Supplies &amp; Treats">
    <meta property="og:description" content="Everything a very good dog needs.">
    <meta property="og:site_name" content="Doggo Shop">
    <meta property="og:image" content="/dog.svg">
  </head><body>hi</body></html>`,
  // Like a real site's preview image: a PNG with no CORS headers.
  '/og-png.html': `<!doctype html><html><head><meta property="og:title" content="Green dog"><meta property="og:image" content="/green.png"></head></html>`,
  '/green.png': solidPng([60, 154, 95]),
  '/plain.html': `<!doctype html><html><head><title>Just a title</title></head><body></body></html>`,
  '/dog.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#e8a849"/></svg>`,
}

// A stand-in for TMDB (the Worker's TMDB_BASE / TMDB_IMAGE_BASE point here in e2e).
const TMDB_TOKEN = 'e2e-tmdb-token'
const providers = (stream) => ({ results: { US: { link: 'https://www.themoviedb.org/watch/e2e', flatrate: stream.map((provider_name) => ({ provider_name })), rent: [{ provider_name: 'Apple TV' }] } } })
const TITLES = [
  { media_type: 'movie', id: 157336, title: 'Interstellar', release_date: '2014-11-05', poster_path: '/interstellar.png', runtime: 169, imdb_id: 'tt0816692', genres: [{ name: 'Adventure' }, { name: 'Drama' }, { name: 'Science Fiction' }], overview: 'A team of explorers travel through a wormhole in space.', 'watch/providers': providers(['Paramount Plus']) },
  { media_type: 'tv', id: 95396, name: 'Severance', first_air_date: '2022-02-17', poster_path: '/severance.png', number_of_seasons: 2, number_of_episodes: 19, external_ids: { imdb_id: 'tt11280740' }, genres: [{ name: 'Drama' }, { name: 'Mystery' }], overview: 'Office workers whose memories are surgically divided.', 'watch/providers': providers(['Apple TV+']) },
  { media_type: 'movie', id: 999, title: 'Lost Reel', release_date: '1931-01-01', poster_path: null, runtime: 61, genres: [{ name: 'Mystery' }], overview: 'No poster survives.', 'watch/providers': { results: {} } },
  { media_type: 'person', id: 1, name: 'Severance Fan' },
]
const POSTERS = { interstellar: [20, 40, 90], severance: [40, 120, 110] }

function tmdb(path, query, auth) {
  if (auth !== `Bearer ${TMDB_TOKEN}`) return [401, { status_message: 'Invalid API key' }]
  if (path === '/search/multi') {
    const q = (query.get('query') ?? '').toLowerCase()
    return [200, { page: 1, results: TITLES.filter((t) => (t.title ?? t.name).toLowerCase().includes(q)) }]
  }
  const find = /^\/find\/(tt\d+)$/.exec(path)
  if (find) {
    const t = TITLES.find((t) => (t.imdb_id ?? t.external_ids?.imdb_id) === find[1])
    return [200, { movie_results: t?.media_type === 'movie' ? [{ id: t.id }] : [], tv_results: t?.media_type === 'tv' ? [{ id: t.id }] : [] }]
  }
  const one = /^\/(movie|tv)\/(\d+)$/.exec(path)
  const t = one && TITLES.find((t) => t.media_type === one[1] && t.id === Number(one[2]))
  return t ? [200, t] : [404, { status_message: 'The resource you requested could not be found.' }]
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/tmdb/3/')) {
    const [status, json] = tmdb(url.pathname.slice('/tmdb/3'.length), url.searchParams, req.headers.authorization)
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
    return
  }
  const poster = /^\/tmdb-img\/w\d+\/(\w+)\.png$/.exec(url.pathname)
  if (poster && POSTERS[poster[1]]) {
    res.writeHead(200, { 'content-type': 'image/png' }).end(solidPng(POSTERS[poster[1]]))
    return
  }
  const body = PAGES[new URL(req.url, 'http://x').pathname]
  if (!body) {
    res.writeHead(404).end('nope')
    return
  }
  const path = new URL(req.url, 'http://x').pathname
  const type = path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8'
  res.writeHead(200, { 'content-type': type }).end(body)
}).listen(Number(process.env.FIXTURE_PORT ?? 5180), () => console.log(`fixtures on :${process.env.FIXTURE_PORT ?? 5180}`))
