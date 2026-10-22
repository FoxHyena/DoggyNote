import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'

// Desktop apps lag behind the server. A card type from a newer app must show a
// placeholder, never break the board, and never overwrite the card's real height.

test('a card type this app does not know shows a placeholder and keeps its height', async ({ page }) => {
  const id = crypto.randomUUID()
  // Everything is in place before the board first loads. Reloading instead would cut
  // off a sync still running from the first load, which WebKit reports as a page error.
  await page.route('**/api/sync?*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const boardId = page.url().match(/#\/b\/([^/?#]+)/)?.[1]
    // Every pull: the first may be thrown away when the client resets its cursor.
    if (boardId && Array.isArray(body.objects)) {
      body.objects.push({ id, kind: 'card', type: 'hologram', boardId: decodeURIComponent(boardId), x: 40, y: 40, w: 240, h: 133, z: 1, color: 'none', content: { glow: true }, createdAt: Date.now() })
    }
    await route.fulfill({ response: res, json: body })
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/sync')) writes.push(r.postData() ?? '')
  })
  await freshBoard(page)
  const placeholder = page.getByTestId('unknown-card')
  await expect(placeholder).toBeVisible()
  await expect(placeholder).toContainText('newer DoggyNote')
  expect((await placeholder.boundingBox())!.height).toBeCloseTo(133, 0)
  await page.waitForTimeout(1200)
  expect(writes.filter((w) => w.includes(id))).toEqual([])
  expect(errors).toEqual([])
})
