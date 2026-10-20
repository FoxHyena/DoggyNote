import { expect, test } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'

// Phones: a proposal previews on the board with a banner that fits the screen.

test('preview a proposal on a phone and approve it', async ({ page }) => {
  await freshBoard(page, 'Phone review')
  await waitForSync(page)
  const boardId = new URL(page.url()).hash.split('/').at(-1)!
  const { token } = await (await page.request.post('/api/agent-connections', { data: { name: 'Pocket agent', mode: 'propose', boardIds: [boardId] } })).json()
  const note = { id: crypto.randomUUID(), kind: 'card', type: 'note', boardId, x: 20, y: 20, w: 240, h: 60, z: 1, color: 'lilac', content: { md: 'Bring snacks' }, createdAt: Date.now() }
  expect((await page.request.post('/api/agent/proposals', { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `phone-${crypto.randomUUID()}`, label: 'Snack plan', operations: [{ action: 'create', object: note }] } })).status()).toBe(201)
  await page.getByTestId('board-more').tap()
  await page.getByTestId('agent-proposals').tap()
  await page.getByTestId('preview-on-board').tap()
  const banner = page.getByTestId('proposal-banner')
  await expect(banner).toBeVisible()
  const box = (await banner.boundingBox())!
  const width = page.viewportSize()!.width
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(width)
  for (const id of ['proposal-approve', 'proposal-reject', 'proposal-exit']) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(page.locator('[data-preview=added]', { hasText: 'Bring snacks' })).toBeVisible()
  await expect(page.getByTestId('mobile-dock')).toBeHidden()
  await page.getByTestId('proposal-approve').tap()
  await expect(banner).toHaveCount(0)
  await expect(page.locator('[data-type=note]', { hasText: 'Bring snacks' })).toBeVisible()
})

test('changes far apart: the phone frames one as a real card, and › steps to the next', async ({ page }) => {
  await freshBoard(page, 'Spread out')
  await waitForSync(page)
  const boardId = new URL(page.url()).hash.split('/').at(-1)!
  const { token } = await (await page.request.post('/api/agent-connections', { data: { name: 'Far agent', mode: 'propose', boardIds: [boardId] } })).json()
  const make = (md: string, x: number, y: number) => ({ action: 'create', object: { id: crypto.randomUUID(), kind: 'card', type: 'note', boardId, x, y, w: 240, h: 60, z: 1, color: 'none', content: { md }, createdAt: Date.now() } })
  expect((await page.request.post('/api/agent/proposals', { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `far-${crypto.randomUUID()}`, label: 'Far apart', operations: [make('Left kennel', 0, 0), make('Right kennel', 3000, 2000)] } })).status()).toBe(201)
  await page.getByTestId('board-more').tap()
  await page.getByTestId('agent-proposals').tap()
  await page.getByTestId('preview-on-board').tap()
  // Real cards with their badge, not canvas thumbnails.
  const left = page.locator('[data-preview=added]', { hasText: 'Left kennel' })
  const right = page.locator('[data-preview=added]', { hasText: 'Right kennel' })
  await expect(left).toBeInViewport()
  await expect(right).not.toBeInViewport()
  await expect(page.getByTestId('proposal-step-phone')).toHaveText('1/2')
  await page.getByTestId('proposal-next-icon').tap()
  await expect(right).toBeInViewport()
  await expect(left).not.toBeInViewport()
  await expect(page.getByTestId('proposal-step-phone')).toHaveText('2/2')
  // The change it's on is marked, and readable (not shrunk to a thumbnail).
  await expect(right).toHaveAttribute('data-preview-current', 'true')
  expect((await right.boundingBox())!.width).toBeGreaterThan(200)
})
