import { expect, type Page } from '@playwright/test'

export async function addImage(page: Page, width = 640, height = 360) {
  const bytes = await page.evaluate(async ({ width, height }) => {
    const c = new OffscreenCanvas(width, height)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#2f5d50'; ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#e8a849'; ctx.fillRect(0, 0, Math.max(1, width / 5), height)
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
  }, { width, height })
  await page.getByTestId('image-input').setInputFiles({ name: 'isolated-reference.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await expect(page.getByTestId('card-image')).toBeVisible()
  await expect.poll(() => page.getByTestId('card-image').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  await page.getByTestId('edit-image-metadata').click()
  await expect(page.getByTestId('image-caption-input')).toBeFocused()
}

