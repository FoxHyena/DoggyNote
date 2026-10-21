import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { importFixturePack, previewSticker, stickerBoard } from './sticker-helpers.ts'

test('decoded TGS and WEBM stay transparent, stop after two loops and respect reduced motion', async ({ page, request, browserName }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray')
  await previewSticker(page, '🐾')
  const large = tray.locator('.sticker-large'), canvas = large.locator('canvas')
  await expect(large.locator('.sticker-image')).toHaveClass(/playing/)
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!
    return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(el.width / 2, el.height / 2, 1, 1).data[3]]
  })).toEqual([0, 255])
  const dir = resolve('../../docs/qa/stickers/formats'); mkdirSync(dir, { recursive: true })
  await large.screenshot({ path: resolve(dir, `${browserName}-tgs.png`) })
  await expect(large.locator('.sticker-image')).not.toHaveClass(/playing/, { timeout: 7000 })
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(canvas).toHaveCount(0)
  await expect(large.locator('img')).toBeVisible()
  await tray.getByTestId('sticker-preview-back').click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await previewSticker(page, '🦴')
  if (browserName === 'chromium') {
    await expect(large.locator('.sticker-image')).toHaveClass(/playing/)
    await expect.poll(() => large.locator('video').evaluate((video: HTMLVideoElement) => {
      const c = document.createElement('canvas'); c.width = c.height = 64
      const ctx = c.getContext('2d')!; ctx.drawImage(video, 0, 0, 64, 64)
      return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(32, 32, 1, 1).data[3]]
    })).toEqual([0, 255])
    await large.screenshot({ path: resolve(dir, `${browserName}-webm.png`) })
    await expect(large.locator('.sticker-image')).not.toHaveClass(/playing/, { timeout: 5000 })
  } else {
    await expect(large.locator('video')).toHaveCount(0)
    await expect(large.locator('img')).toBeVisible()
    await large.screenshot({ path: resolve(dir, `${browserName}-webm-still.png`) })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(large.locator('video')).toHaveCount(0); await expect(large.locator('img')).toBeVisible()
})
