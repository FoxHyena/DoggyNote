import { expect, test } from '@playwright/test'
import { camera, freshBoard, waitForSync } from './helpers.ts'
import { tap, tapOn } from './touch.ts'

// On a phone: tap to select, tap again (a double-tap) to type the caption under
// the image, Done to finish. The selection bar's Edit does the same.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

test('double-tap an image to caption it; Edit in the selection bar opens it again', async ({ page }) => {
  const png = Buffer.from(await page.evaluate(async () => {
    const c = new OffscreenCanvas(200, 150)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#4a90c2'
    ctx.fillRect(0, 0, 200, 150)
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const b of buf) s += String.fromCharCode(b)
    return btoa(s)
  }), 'base64')
  await page.getByTestId('image-input').setInputFiles({ name: 'rex.png', mimeType: 'image/png', buffer: png })
  const card = page.locator('[data-testid="card"][data-type="image"]')
  await expect(card).toHaveCount(1)

  const before = await camera(page)
  const box = (await card.getByTestId('card-image').boundingBox())!
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await tap(page, p)
  await expect(card).toHaveClass(/selected/)
  await tap(page, p)
  const input = page.getByTestId('image-caption-input')
  await expect(input).toBeFocused()
  await page.keyboard.type('Zoomies')
  await page.getByTestId('edit-done').tap()
  await expect(input).toHaveCount(0)
  await expect(card.getByTestId('image-caption')).toHaveText('Zoomies')
  // The board glides back to where it was before the next tap.
  await expect.poll(async () => JSON.stringify(await camera(page))).toBe(JSON.stringify(before))

  await tapOn(page, card.getByTestId('card-image'))
  await expect(card).toHaveClass(/selected/)
  await page.getByTestId('edit-card').tap()
  await expect(input).toHaveValue('Zoomies')
  await page.keyboard.type('!')
  await page.getByTestId('edit-done').tap()
  await expect(card.getByTestId('image-caption')).toHaveText('Zoomies!')

  await waitForSync(page)
  await page.reload()
  await expect(page.locator('[data-testid="card"][data-type="image"]').getByTestId('image-caption')).toHaveText('Zoomies!')
})
