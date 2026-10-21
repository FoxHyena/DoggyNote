import { expect, test, type Page } from '@playwright/test'
import { MOD, clickEmpty, freshBoard, pullAllObjects, waitForSync } from './helpers.ts'
import { boardOf, seedCards, setCamera } from './touch.ts'

// Movie and show cards, against a stand-in TMDB (e2e/fixture-server.mjs): search
// and pick, the poster stored as our own image, Watched, Details, pasted links.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const movie = (page: Page, title: string) => page.locator('[data-type=movie]', { hasText: title })
const posterLoaded = (page: Page, title: string) =>
  expect.poll(() => movie(page, title).getByTestId('movie-poster-img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(16)

/** The card as the server has it, once the fetched details have synced. */
async function serverMovie(page: Page, title: string) {
  await waitForSync(page)
  type M = { type?: string; boardId?: string; content?: { title?: string; status?: string } }
  let found: M | undefined
  // Other tests make Interstellar cards too: look on this test's board only.
  const board = boardOf(page)
  await expect.poll(async () => {
    const { objects } = await pullAllObjects(page.request)
    found = objects.find((o: M) => o.type === 'movie' && o.boardId === board && o.content?.title === title)
    return found?.content?.status
  }, { timeout: 10_000 }).toBe('ok')
  return found as M & { content: Record<string, unknown> & { assetId: string } }
}

const paste = (page: Page, text: string) =>
  page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)

test('search for a film, pick it with the keyboard, and its poster is stored as our own image', async ({ page }) => {
  await page.getByTestId('tool-movie').click()
  const search = page.getByTestId('movie-search')
  await expect(search).toBeFocused()
  await search.fill('inter')
  const results = page.getByTestId('movie-result')
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('Interstellar')
  await expect(results.first()).toContainText('2014 · Movie')
  await page.keyboard.press('Enter')
  await expect(movie(page, 'Interstellar').getByTestId('movie-sub')).toHaveText('2014 · Movie · 2h 49m')
  await posterLoaded(page, 'Interstellar')
  const card = await serverMovie(page, 'Interstellar')
  expect(card.content).toMatchObject({ tmdbId: 157336, kind: 'movie', year: 2014, imdbId: 'tt0816692', status: 'ok', info: { runtime: 169, genres: ['Adventure', 'Drama', 'Science Fiction'] } })
  // Served by us, like any picture on a board.
  expect((await page.request.get(`/api/assets/${card.content.assetId}/thumb`)).headers()['content-type']).toBe('image/png')
  expect((await page.request.get(`/api/assets/${card.content.assetId}/small`)).status()).toBe(200)
})

test('people are left out, no match says so, and an unpicked card goes away', async ({ page }) => {
  await page.getByTestId('tool-movie').click()
  const search = page.getByTestId('movie-search')
  await search.fill('severance')
  await expect(page.getByTestId('movie-result')).toHaveText([/Severance\s*2022 · Show/])
  await search.fill('zzzz no such dog')
  await expect(page.getByText('No scent of that one')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-type=movie]')).toHaveCount(0)
})

test('mark a show watched (one undo step), open its details, and both survive a reload', async ({ page }) => {
  await seedCards(page, [{ type: 'movie', w: 300, content: { kind: 'tv', tmdbId: 95396, title: '', status: 'pending' } }])
  const card = movie(page, 'Severance')
  await expect(card.getByTestId('movie-sub')).toHaveText('2022 · Show · 2 seasons')
  const watched = card.getByTestId('movie-watched')
  await watched.click()
  await expect(watched).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByTestId('movie-watched-at')).toHaveText('Watched today')
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+Z`)
  await expect(watched).toHaveAttribute('aria-pressed', 'false')
  await expect(card.getByTestId('movie-watched-at')).toHaveCount(0)
  await watched.click()
  await card.getByTestId('movie-details-toggle').click()
  const details = card.getByTestId('movie-details')
  await expect(details).toContainText('Drama')
  await expect(details).toContainText('Office workers whose memories are surgically divided.')
  await expect(details.getByTestId('movie-stream')).toContainText('Apple TV+')
  await expect(details.getByTestId('movie-rent')).toContainText('Apple TV')
  await expect(details.getByRole('link', { name: 'Streaming data from JustWatch' })).toHaveAttribute('href', 'https://www.themoviedb.org/watch/e2e')
  await waitForSync(page)
  await page.reload()
  await expect(movie(page, 'Severance').getByTestId('movie-details')).toBeVisible()
  await expect(movie(page, 'Severance').getByTestId('movie-watched')).toHaveAttribute('aria-pressed', 'true')
  await expect(movie(page, 'Severance').locator('.movie-poster-img')).toHaveCSS('filter', /grayscale\(1\)/)
})

test('pasting a TMDB or IMDb link makes a movie card; other links stay links', async ({ page }) => {
  await paste(page, 'https://www.imdb.com/title/tt0816692/')
  await expect(movie(page, 'Interstellar').getByTestId('movie-sub')).toHaveText('2014 · Movie · 2h 49m')
  await clickEmpty(page)
  await paste(page, 'https://www.themoviedb.org/tv/95396-severance')
  await expect(movie(page, 'Severance')).toBeVisible()
  await posterLoaded(page, 'Severance')
  await expect(page.locator('[data-type=movie]')).toHaveCount(2)
  await expect(page.locator('[data-type=link]')).toHaveCount(0)
})

test('a title without a poster gets a placeholder; one TMDB doesn’t know offers a retry', async ({ page }) => {
  await seedCards(page, [
    { type: 'movie', w: 300, content: { kind: 'movie', tmdbId: 999, title: '', status: 'pending' } },
    { type: 'movie', w: 300, y: 260, content: { kind: 'movie', tmdbId: 4040, title: 'Mystery tape', status: 'pending' } },
  ])
  await expect(movie(page, 'Lost Reel').getByTestId('movie-sub')).toHaveText('1931 · Movie · 1h 1m')
  await expect(movie(page, 'Lost Reel').getByTestId('movie-poster-img')).toHaveCount(0)
  await expect(movie(page, 'Mystery tape')).toContainText('Couldn’t fetch the details.')
  await expect(movie(page, 'Mystery tape').getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('the share viewer and the overview show the poster', async ({ page, browser }) => {
  await paste(page, 'https://www.themoviedb.org/movie/157336')
  await posterLoaded(page, 'Interstellar')
  await waitForSync(page)
  await setCamera(page, { x: -200, y: -200, zoom: 0.2 })
  await expect.poll(() => page.getByTestId('lod-layer').getAttribute('data-thumbs').then(Number)).toBeGreaterThanOrEqual(1)
  const { share } = await (await page.request.post('/api/shares', { data: { boardId: boardOf(page) } })).json()
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const v = await ctx.newPage()
  await v.goto(`/s/${share.token}`)
  await posterLoaded(v, 'Interstellar')
  // Read-only: the state shows, the buttons don't.
  await expect(movie(v, 'Interstellar').getByTestId('movie-watched')).toHaveCount(0)
  await ctx.close()
})

test('the overview greys a watched poster too, in every engine', async ({ page }) => {
  await paste(page, 'https://www.themoviedb.org/movie/157336')
  await posterLoaded(page, 'Interstellar')
  await waitForSync(page)
  await clickEmpty(page)
  // The most colourful pixel on the overview canvas: the stand-in poster is navy.
  const colour = () => page.getByTestId('lod-layer').evaluate((el) => {
    const canvas = el instanceof HTMLCanvasElement ? el : el.querySelector('canvas')!
    const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let most = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) most = Math.max(most, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]))
    return most
  })
  await setCamera(page, { x: -200, y: -200, zoom: 0.2 })
  await expect.poll(() => page.getByTestId('lod-layer').getAttribute('data-thumbs').then(Number)).toBeGreaterThanOrEqual(1)
  await expect.poll(colour).toBeGreaterThan(30)
  await setCamera(page, { x: -200, y: -200, zoom: 1 })
  await movie(page, 'Interstellar').getByTestId('movie-watched').click()
  await expect(movie(page, 'Interstellar').getByTestId('movie-watched')).toHaveAttribute('aria-pressed', 'true')
  await waitForSync(page)
  await clickEmpty(page)
  await setCamera(page, { x: -200, y: -200, zoom: 0.2 })
  await expect.poll(colour).toBeLessThan(16)
})

test('a card made by an agent names the title; the app fetches the rest once approved', async ({ page }) => {
  await waitForSync(page)
  const boardId = boardOf(page)
  const { token } = await (await page.request.post('/api/agent-connections', { data: { name: 'Film buff', mode: 'propose', boardIds: [boardId] } })).json()
  const object = { id: crypto.randomUUID(), kind: 'card', type: 'movie', boardId, x: 0, y: 0, w: 300, h: 162, z: 1, color: 'none', createdAt: Date.now(), content: { kind: 'movie', tmdbId: 157336, title: 'Interstellar', status: 'pending' } }
  const headers = { authorization: `Bearer ${token}` }
  const staged = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `film-${crypto.randomUUID()}`, label: 'Movie night pick', operations: [{ action: 'create', object }] } })
  expect(staged.status(), await staged.text()).toBe(201)
  // An agent can't name a title it doesn't identify.
  const vague = await page.request.post('/api/agent/proposals', { headers, data: { idempotencyKey: `film-${crypto.randomUUID()}`, label: 'Vague', operations: [{ action: 'create', object: { ...object, id: crypto.randomUUID(), content: { kind: 'movie', title: 'Something good' } } }] } })
  expect(vague.status()).toBe(400)
  expect((await page.request.post(`/api/agent-proposals/${(await staged.json()).id}/approve`, { data: {} })).status()).toBe(200)
  await page.reload()
  await expect(movie(page, 'Interstellar').getByTestId('movie-sub')).toHaveText('2014 · Movie · 2h 49m')
  await posterLoaded(page, 'Interstellar')
})

test('without a TMDB token the search says it isn’t set up', async ({ page }) => {
  await page.route('**/api/movies/search?*', (r) => r.fulfill({ status: 503, json: { error: 'Movie search isn’t set up on this server yet.', notSetUp: true } }))
  await page.getByTestId('tool-movie').click()
  await page.getByTestId('movie-search').fill('interstellar')
  await expect(page.getByRole('alert')).toHaveText('Movie search isn’t set up on this server yet.')
})

test('a poster can’t be borrowed by someone who can’t see it', async ({ page, browser }) => {
  // Rex resolves a poster onto a private board of his own.
  const resolved = await (await page.request.post('/api/movies/resolve', { data: { tmdbId: 157336, kind: 'movie' } })).json()
  const board = crypto.randomUUID(), card = crypto.randomUUID()
  const now = Date.now()
  const mine = await page.request.post('/api/sync', { data: { changes: [
    { id: board, patch: { id: board, kind: 'board', parentId: null, title: 'Rex only', icon: 'paw', color: 'gold', createdAt: now } },
    { id: card, patch: { id: card, kind: 'card', type: 'movie', boardId: board, x: 0, y: 0, w: 300, h: 162, z: 1, color: 'none', createdAt: now, content: { kind: 'movie', tmdbId: 157336, title: 'Interstellar', assetId: resolved.assetId, status: 'ok' } } },
  ] } })
  expect(mine.ok(), await mine.text()).toBe(true)

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
  expect((await ctx.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  expect((await ctx.request.get(`/api/assets/${resolved.assetId}/thumb`)).status()).toBe(403)
  const fidoBoard = crypto.randomUUID(), steal = crypto.randomUUID()
  const denied = await ctx.request.post('/api/sync', { data: { changes: [
    { id: fidoBoard, patch: { id: fidoBoard, kind: 'board', parentId: null, title: 'Fido only', icon: 'bone', color: 'gold', createdAt: now } },
    { id: steal, patch: { id: steal, kind: 'card', type: 'movie', boardId: fidoBoard, x: 0, y: 0, w: 300, h: 162, z: 1, color: 'none', createdAt: now, content: { kind: 'movie', tmdbId: 157336, title: 'Mine now', assetId: resolved.assetId } } },
  ] } })
  expect(denied.status()).toBe(403)
  expect((await denied.json()).deniedIds).toContain(steal)
  expect((await ctx.request.get(`/api/assets/${resolved.assetId}/thumb`)).status()).toBe(403)
  await ctx.close()
})

test('About & credits names TMDB, as its terms ask', async ({ page }) => {
  await page.getByTestId('account').click()
  await page.getByTestId('about').click()
  const credit = page.getByTestId('tmdb-credit')
  await expect(credit).toContainText('This product uses the TMDB API but is not endorsed or certified by TMDB.')
  await expect.poll(() => credit.getByRole('img', { name: 'TMDB' }).evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('about-dialog')).toHaveCount(0)
  await expect(page.getByTestId('account')).toBeFocused()
})

test('a card left without a pick rests quietly and can be picked later', async ({ page }) => {
  await seedCards(page, [{ type: 'movie', w: 300, content: { kind: 'movie', title: '' } }])
  const empty = page.getByTestId('movie-empty')
  await expect(empty).toBeVisible()
  // It doesn't grab the keyboard on load.
  await expect(page.getByTestId('movie-search')).toHaveCount(0)
  await empty.getByRole('button', { name: 'Pick a movie or show' }).click()
  await expect(page.getByTestId('movie-search')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-type=movie]')).toHaveCount(0)
})

test('on the board the poster leads with the title under it; in a column the card is a compact row', async ({ page }) => {
  const column = crypto.randomUUID()
  await seedCards(page, [
    { type: 'movie', w: 220, content: { kind: 'movie', tmdbId: 157336, title: '', status: 'pending' } },
    { id: column, type: 'column', x: 400, w: 280, content: { title: 'Watchlist' } },
    { type: 'movie', w: 264, columnId: column, order: 1, content: { kind: 'tv', tmdbId: 95396, title: '', status: 'pending' } },
  ])
  const box = async (title: string, id: string) => (await movie(page, title).getByTestId(id).boundingBox())!
  await expect(movie(page, 'Interstellar').getByTestId('movie-sub')).toContainText('2014')
  await expect(movie(page, 'Severance').getByTestId('movie-sub')).toContainText('2022')
  // Free: a big poster, the title below it, the icons on the caption row.
  const poster = await box('Interstellar', 'movie-poster')
  expect(poster.width).toBeGreaterThan(180)
  expect((await box('Interstellar', 'movie-title')).y).toBeGreaterThan(poster.y + poster.height)
  expect(Math.abs((await box('Interstellar', 'movie-watched')).y - (await box('Interstellar', 'movie-details-toggle')).y)).toBeLessThan(2)
  // In a column: a small poster with the title beside it.
  const small = await box('Severance', 'movie-poster')
  expect(small.width).toBeLessThan(80)
  const title = await box('Severance', 'movie-title')
  expect(title.x).toBeGreaterThan(small.x + small.width)
  // The year line sits right under the title, not down by the buttons.
  expect((await box('Severance', 'movie-sub')).y - (title.y + title.height)).toBeLessThan(8)
  // Icons, labelled for screen readers.
  await expect(movie(page, 'Severance').getByRole('button', { name: 'Watched' })).toBeVisible()
  await expect(movie(page, 'Severance').getByRole('button', { name: 'Details' })).toBeVisible()
})

test('an IMDb link TMDB doesn’t know still says what it was', async ({ page }) => {
  await paste(page, 'https://www.imdb.com/title/tt0000001/')
  const card = page.locator('[data-type=movie]')
  await expect(card.getByTestId('movie-title')).toHaveText('IMDb tt0000001')
  await expect(card).toContainText('Couldn’t fetch the details.')
})
