import { expect, test, type Page } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'

// Each background poll costs the server a D1 access check, so a live room slows it to a backstop.
// A sync round starts with one GET /api/access (its pulls may span several pages).
// Advance fake time in steps, letting each round finish, so one jump can't queue rounds behind each other.
async function advance(page: Page, ms: number) {
  for (let t = 0; t < ms; t += 5_000) { await page.clock.runFor(5_000); await waitForSync(page) }
}

function countRounds(page: Page) {
  const rounds = { n: 0 }
  page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/access') rounds.n++ })
  return rounds
}

test('a live board polls once a minute instead of every 10 seconds', async ({ page }) => {
  await page.clock.install()
  await freshBoard(page)
  await waitForSync(page)
  await expect(page.getByTestId('collaborators')).toHaveAttribute('aria-label', /Live/)
  const rounds = countRounds(page)
  // Every 10 s would be 7 rounds; focus or a reconnect may add one of their own.
  await advance(page, 70_000)
  expect(rounds.n).toBeGreaterThanOrEqual(1)
  expect(rounds.n).toBeLessThanOrEqual(2)
})

test('without a live room the board still polls every 10 seconds', async ({ page }) => {
  await page.route('**/live-ticket', (route) => route.abort('connectionrefused'))
  await page.clock.install()
  await freshBoard(page)
  await waitForSync(page)
  await expect(page.getByTestId('collaborators')).toHaveAttribute('aria-label', /Reconnecting/)
  const rounds = countRounds(page)
  await advance(page, 35_000)
  expect(rounds.n).toBeGreaterThanOrEqual(3)
})
