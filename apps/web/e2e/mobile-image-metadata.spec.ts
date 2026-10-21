import { expect, test } from '@playwright/test'
import { freshBoard, postSync, waitForSync } from './helpers.ts'
import { tapOn } from './touch.ts'

test('touch selection discovers caption/source, saves and reopens', async ({ page }) => {
  await freshBoard(page)
  const boardId = decodeURIComponent(page.url().split('#/b/')[1])
  const assetId = crypto.randomUUID()
  const id = crypto.randomUUID()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=', 'base64')
  for (const size of ['thumb', 'small', 'medium', 'full']) expect((await page.request.put(`/api/assets/${assetId}/${size}`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { id, kind: 'card', type: 'image', boardId, x: 0, y: 0, w: 240, h: 135, color: 'none', z: 1, createdAt: Date.now(), content: { assetId, width: 640, height: 360 } } }] } })).ok()).toBe(true)
  await page.reload()
  await tapOn(page, page.getByTestId('card-image'))
  await page.getByTestId('edit-image-metadata').tap()
  await expect(page.getByTestId('image-caption-input')).toBeFocused()
  await page.getByTestId('image-caption-input').fill('Phone research caption')
  await page.getByTestId('image-source-input').fill('https://example.com/original')
  await page.getByTestId('image-metadata-done').tap()
  await expect(page.getByTestId('image-caption')).toHaveText('Phone research caption')
  await waitForSync(page)
  await page.reload()
  await expect(page.getByTestId('image-source')).toHaveAttribute('href', 'https://example.com/original')
})
