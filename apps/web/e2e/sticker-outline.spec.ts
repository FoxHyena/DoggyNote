import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { importFixturePack, openStickerTray, stickerBoard } from './sticker-helpers.ts'

async function pixels(image: Locator) {
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  return image.evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
    const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data]
    return { width: canvas.width, height: canvas.height, border: pixel(64, 131), center: pixel(131, 131), corner: pixel(0, 0) }
  })
}

test('static outlines are cached pixels, preserve transparency and leave animated stills alone', async ({ page, request, browserName }) => {
  await stickerBoard(page, request)
  // A deliberately borderless source makes an added white silhouette observable.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#e02020'; ctx.fillRect(64, 64, 128, 128)
    return c.toDataURL('image/png').split(',')[1]
  })
  let sourceRequests = 0, workers = 0
  page.on('worker', () => workers++)
  await page.route('**/api/assets/57a1c000-0000-4000-8000-000000000000/thumb*', async (route) => {
    sourceRequests++
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') })
  })
  await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray'), images = tray.getByTestId('sticker-pick').locator('img')
  await expect.poll(() => images.evaluateAll((imgs: HTMLImageElement[]) => imgs.every((img) => img.complete && img.naturalWidth > 0))).toBe(true)
  const first = images.nth(0)
  expect(await pixels(first)).toEqual({ width: 262, height: 262, border: [255, 255, 255, 255], center: [224, 32, 32, 255], corner: [0, 0, 0, 0] })
  await expect(first).toHaveAttribute('src', /^blob:/)
  await expect(images.nth(1)).toHaveAttribute('src', /\/api\/assets\/.*\/thumb/)
  await expect(images.nth(2)).toHaveAttribute('src', /\/api\/assets\/.*\/thumb/)
  expect(workers).toBe(1)
  const old = await first.getAttribute('src')
  const requests = sourceRequests
  await tray.getByRole('button', { name: 'Close stickers', exact: true }).click()
  expect(await page.evaluate(async (url) => { try { await fetch(url!); return true } catch { return false } }, old)).toBe(false)
  await openStickerTray(page)
  expect((await pixels(images.first())).border).toEqual([255, 255, 255, 255])
  expect(sourceRequests).toBe(requests)
  // A new page realm must recover the PNG from disk without starting a worker.
  const beforeReload = workers
  await page.reload(); await expect(page.getByTestId('canvas')).toBeVisible()
  await openStickerTray(page)
  await tray.getByRole('button', { name: 'Doggy daydreams', exact: true }).click()
  expect((await pixels(images.first())).border).toEqual([255, 255, 255, 255])
  expect(sourceRequests).toBe(requests)
  expect(workers).toBe(beforeReload)
  await images.first().locator('..').click()
  await page.getByRole('button', { name: 'Place at center', exact: true }).click()
  const placed = page.getByTestId('placed-sticker')
  expect((await pixels(placed.locator('img'))).border).toEqual([255, 255, 255, 255])
  await expect(placed).toHaveCSS('filter', 'none')
  await expect(placed.locator('.sticker-visual')).toHaveCSS('filter', 'none')
  const dir = resolve('../../tmp/sticker-performance/static-outline'); mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, `${browserName}-borderless-source-outlined.png`) })
})

test('a blocked background worker falls back to the original static artwork', async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: class { constructor() { throw new Error('Worker blocked') } } })
  })
  await stickerBoard(page, request); await importFixturePack(page)
  const image = page.getByTestId('sticker-pick').first().locator('img')
  await expect(image).toHaveAttribute('src', /\/api\/assets\/.*\/thumb/)
  expect((await pixels(image)).width).toBe(256)
})
