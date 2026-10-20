import { expect, test } from '@playwright/test'
import { camera, cardByText, freshBoard } from './helpers.ts'
import { center, note, pinch, seedCards, tap, touchDrag } from './touch.ts'

// A friend opens a share link on their phone: one finger looks around, two
// fingers zoom, a tap opens an inner board.

test('a share link pans, pinches and opens inner boards by touch', async ({ page, browser }) => {
  await freshBoard(page)
  const boardId = page.url().split('/').at(-1)!
  const inner = crypto.randomUUID()
  expect((await page.request.post('/api/sync', { data: { changes: [{ id: inner, patch: { id: inner, kind: 'board', parentId: boardId, title: 'Den photos', icon: 'kennel', color: 'sky', createdAt: Date.now() } }] } })).ok()).toBe(true)
  await seedCards(page, [note('Shared hello', 0, 0), { type: 'board', x: 0, y: 140, w: 140, content: { boardId: inner } }])
  const { share } = await (await page.request.post('/api/shares', { data: { boardId } })).json()

  const ctx = await browser.newContext({ ...test.info().project.use, storageState: { cookies: [], origins: [] } })
  const v = await ctx.newPage()
  await v.goto(`/s/${share.token}`)
  await expect(cardByText(v, 'Shared hello')).toBeVisible()
  await expect(v.getByTestId('mobile-dock')).toHaveCount(0)

  const before = await camera(v)
  const c = await center(v.getByTestId('canvas'))
  await touchDrag(v, c, { x: c.x - 60, y: c.y - 40 })
  expect((await camera(v)).tx - before.tx).toBeCloseTo(-60, 0)
  await pinch(v, c, 1.6)
  expect((await camera(v)).zoom).toBeGreaterThan(before.zoom * 1.3)

  await tap(v, await center(cardByText(v, 'Den photos')))
  await expect(v.getByTestId('board-name')).toHaveText('Den photos')
  await ctx.close()
})
