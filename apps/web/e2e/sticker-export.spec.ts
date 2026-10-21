import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { importFixturePack, openStickerTray, stickerBoard, adjustSticker } from './sticker-helpers.ts'

test('transparent PNG export preserves rotated bounds, overlay order and artwork without selection chrome', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  await page.getByTestId('sticker-pick').first().click(); await page.getByRole('button', { name: 'Place at center', exact: true }).click()
  await openStickerTray(page); await page.getByTestId('sticker-pick').nth(2).click(); await page.getByRole('button', { name: 'Place at center', exact: true }).click()
  await adjustSticker(page, 'size', 200)
  await adjustSticker(page, 'angle', 45)
  const download = async () => {
    await page.getByTestId('board-more').click(); await page.getByTestId('export').click()
    await page.getByTestId('export-scope-board').click(); await page.getByTestId('export-scale-1').click(); await page.getByTestId('export-background-transparent').click()
    const pending = page.waitForEvent('download'); await page.getByTestId('export-go').click()
    const result = await pending; const png = await readFile((await result.path())!)
    return page.evaluate(async (base64) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      return { width: canvas.width, height: canvas.height, center: [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data], corner: [...ctx.getImageData(0, 0, 1, 1).data] }
    }, png.toString('base64'))
  }
  const first = await download()
  expect(first.width).toBe(347); expect(first.height).toBe(347)
  expect(first.corner[3]).toBe(0); expect(first.center[3]).toBe(255)
  expect(first.center[1]).toBeGreaterThan(first.center[0]) // green bone above the golden puppy
  await page.getByRole('button', { name: 'Backward', exact: true }).click()
  const second = await download()
  expect(second.width).toBe(first.width); expect(second.height).toBe(first.height)
  expect(second.center[0]).toBeGreaterThan(second.center[1]) // golden puppy above bone
})
