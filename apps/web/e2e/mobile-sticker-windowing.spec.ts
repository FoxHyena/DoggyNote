import { expect, test } from '@playwright/test'
import { openStickerTray, stickerBoard } from './sticker-helpers.ts'
import { hundredStickerPack } from './sticker-windowing.ts'
import { at } from './helpers.ts'
import { center, Fingers, longPress } from './touch.ts'

test('a 100-sticker shelf windows columns, restores its preview, and drags one real sticker', async ({ page, request }) => {
  await stickerBoard(page, request)
  const { pack, requested } = await hundredStickerPack(page)
  await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray'), scroll = tray.locator('.sticker-scroll')
  await tray.getByRole('button', { name: pack.title, exact: true }).tap()
  await expect(tray).toHaveClass(/sticker-shelf/)
  expect(await tray.getByTestId('sticker-pick').count()).toBeLessThanOrEqual(8)
  expect(requested.size).toBeLessThanOrEqual(24) // includes the initial vertical layout before the shelf mounts
  await scroll.evaluate((el) => { el.scrollLeft = el.scrollWidth })
  const last = tray.locator(`[data-sticker-asset="${pack.stickers[99].assetId}"]`)
  await expect(last).toBeInViewport()
  const offset = await scroll.evaluate((el) => el.scrollLeft)
  await longPress(page, await center(last))
  await expect(tray.locator('.sticker-large')).toBeVisible()
  await tray.getByTestId('sticker-preview-back').tap()
  await expect(last).toBeFocused()
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(offset)
  await page.getByTestId('mobile-stickers').tap(); await openStickerTray(page)
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(offset)
  await scroll.evaluate((el) => { el.scrollLeft = 0 })
  const first = tray.locator(`[data-sticker-asset="${pack.stickers[0].assetId}"]`)
  await expect(first).toBeInViewport()
  const finger = new Fingers(page), from = await center(first), target = await at(page, .5, .25)
  await finger.press(0, from); await finger.move(0, { x: from.x, y: from.y - 24 })
  await expect(page.getByTestId('sticker-ghost')).toBeVisible()
  await finger.move(0, target); await finger.release(0)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  await expect(page.getByTestId('placed-sticker')).toHaveCSS('filter', 'none')
  await expect(page.getByTestId('sticker-ghost')).toHaveCount(0)
})
