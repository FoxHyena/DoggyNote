import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { seedCards } from './touch.ts'

// Phones: add a movie from the dock, pick it with a tap, mark it watched with a thumb.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

test('add a show from the dock, pick it, and mark it watched', async ({ page }) => {
  await page.getByTestId('dock-add').tap()
  await page.getByTestId('add-movie').tap()
  const search = page.getByTestId('movie-search')
  // Focused in the same tap, so the keyboard comes up.
  await expect(search).toBeFocused()
  await search.fill('sever')
  await page.getByTestId('movie-result').first().tap()
  const card = page.locator('[data-type=movie]', { hasText: 'Severance' })
  await expect(card.getByTestId('movie-sub')).toHaveText('2022 · Show · 2 seasons')
  await card.getByTestId('movie-watched').tap()
  await expect(card.getByTestId('movie-watched')).toHaveAttribute('aria-pressed', 'true')
})

test('the Watched button takes a fingertip, a little outside its outline', async ({ page }) => {
  await seedCards(page, [{ type: 'movie', w: 300, content: { kind: 'movie', tmdbId: 157336, title: '', status: 'pending' } }])
  const button = page.locator('[data-type=movie]', { hasText: 'Interstellar' }).getByTestId('movie-watched')
  await expect(button).toBeVisible()
  const b = (await button.boundingBox())!
  // 6 px above the drawn button still lands on it.
  await page.touchscreen.tap(b.x + b.width / 2, b.y - 6)
  await expect(button).toHaveAttribute('aria-pressed', 'true')
})

test('the Add sheet keeps a tidy grid with the Movie tile', async ({ page }) => {
  await page.getByTestId('dock-add').tap()
  const tiles = page.getByTestId('add-sheet').locator('.add-tile')
  const boxes = await tiles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, w: r.width, right: r.right })))
  const sheet = (await page.getByTestId('add-sheet').boundingBox())!
  for (const b of boxes) expect(b.right).toBeLessThanOrEqual(sheet.x + sheet.width + 1)
  // A lone last tile spans the row rather than sitting in a corner.
  if (boxes.length % 3 === 1) expect(boxes.at(-1)!.w).toBeGreaterThan(boxes[0].w * 2)
})

test('opening the details of a tall card brings the details into view, above the bars', async ({ page }) => {
  await seedCards(page, [{ type: 'movie', w: 300, content: { kind: 'tv', tmdbId: 95396, title: '', status: 'pending' } }])
  const card = page.locator('[data-type=movie]', { hasText: 'Severance' })
  await expect(card.getByTestId('movie-sub')).toContainText('Show')
  await card.getByTestId('movie-details-toggle').tap()
  const details = card.getByTestId('movie-details')
  await expect(details).toBeVisible()
  // The phone's bottom bars take about 150px.
  const room = page.viewportSize()!.height - 150
  await expect.poll(async () => (await details.boundingBox())!.y).toBeLessThan(room - 60)
  expect((await details.boundingBox())!.y).toBeGreaterThan(0)
})
