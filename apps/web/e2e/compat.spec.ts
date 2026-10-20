import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { boardOf } from './touch.ts'

// Desktop apps lag behind the server. A card type from a newer app must show a
// placeholder, never break the board, and never overwrite the card's real height.

test('a card type this app does not know shows a placeholder and keeps its height', async ({ page }) => {
  await freshBoard(page)
  const boardId = boardOf(page)
  const id = crypto.randomUUID()
  const card = { id, kind: 'card', type: 'hologram', boardId, x: 40, y: 40, w: 240, h: 133, z: 1, color: 'none', content: { glow: true }, createdAt: Date.now() }
  await page.route('**/api/sync?*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    // Every pull: the first may be thrown away when the client resets its cursor.
    if (Array.isArray(body.objects)) body.objects.push(card)
    await route.fulfill({ response: res, json: body })
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/sync')) writes.push(r.postData() ?? '')
  })
  await page.reload()
  const placeholder = page.getByTestId('unknown-card')
  await expect(placeholder).toBeVisible()
  await expect(placeholder).toContainText('newer DoggyNote')
  expect((await placeholder.boundingBox())!.height).toBeCloseTo(133, 0)
  await page.waitForTimeout(1200)
  expect(writes.filter((w) => w.includes(id))).toEqual([])
  expect(errors).toEqual([])
})
