import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { at, waitForSync } from './helpers.ts'
import { Fingers, center, longPress, touchDrag } from './touch.ts'
import { importFixturePack, openStickerTray, stickerBoard, stickerRingPoint, stickerState } from './sticker-helpers.ts'

test('phone scroll and preview never place; tap, cancel, move, resize, rotate and pinch remain distinct', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray')
  const first = await center(tray.getByTestId('sticker-pick').first())
  await longPress(page, first)
  await expect(tray.locator('.sticker-large')).toBeVisible()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await tray.getByTestId('sticker-preview-back').tap()
  const scroll = (await tray.locator('.sticker-scroll').boundingBox())!
  await touchDrag(page, { x: scroll.x + scroll.width - 24, y: scroll.y + scroll.height / 2 }, { x: scroll.x + 24, y: scroll.y + scroll.height / 2 })
  await expect(tray.locator('.sticker-large')).toHaveCount(0)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await tray.getByTestId('sticker-pick').last().tap()
  await expect(tray).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await openStickerTray(page)
  await tray.getByTestId('sticker-pick').last().tap()
  const target = await at(page, .5, .3)
  await page.touchscreen.tap(target.x, target.y)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  const original = await stickerState(page)
  const p = await center(page.getByTestId('placed-sticker'))
  await touchDrag(page, p, { x: p.x + 35, y: p.y + 30 })
  expect((await stickerState(page)).x).toBeGreaterThan(original.x + 25)
  const resized = await stickerRingPoint(page, 45)
  await touchDrag(page, resized, { x: resized.x + 30, y: resized.y + 30 })
  expect((await stickerState(page)).w).toBeGreaterThan(original.w)
  const rotate = await stickerRingPoint(page, -90)
  await touchDrag(page, rotate, { x: rotate.x + 80, y: rotate.y + 40 })
  expect(Math.abs((await stickerState(page)).angle)).toBeGreaterThan(15)
  const dir = resolve(`../../docs/qa/stickers/round-${process.env.STICKER_VISUAL_ROUND ?? '1'}`); mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: resolve(dir, `${test.info().project.name}-selected-ring.png`) })
  const before = await stickerState(page)
  // The second finger cancels an in-progress sticker transform before canvas pinch.
  const f = new Fingers(page), c = await center(page.getByTestId('placed-sticker'))
  await f.press(0, c); await f.move(0, { x: c.x + 20, y: c.y })
  await f.press(1, { x: c.x + 80, y: c.y + 80 }); await f.move(1, { x: c.x + 110, y: c.y + 110 }); await f.release(1); await f.release(0)
  const after = await stickerState(page)
  expect(after.x).toBe(before.x); expect(after.w).toBe(before.w); expect(after.angle).toBe(before.angle)
  await waitForSync(page)
  await page.setViewportSize({ width: 844, height: 390 })
  // Mobile Chromium updates its visual viewport after the resize command.
  // Wait for the landscape touch coordinate space before tapping the launcher.
  await expect.poll(() => page.evaluate(() => {
    return { width: Math.round(visualViewport!.width), height: Math.round(visualViewport!.height) }
  })).toEqual({ width: 844, height: 390 })
  await openStickerTray(page)
  await page.screenshot({ path: resolve(dir, `${test.info().project.name}-landscape-tray.png`) })
  const bone = tray.getByRole('button', { name: /^Choose 🦴 from/ }).first()
  await bone.scrollIntoViewIfNeeded()
  const tile = (await bone.boundingBox())!, grid = (await tray.locator('.sticker-scroll').boundingBox())!
  const visibleTop = Math.max(tile.y, grid.y), visibleBottom = Math.min(tile.y + tile.height, grid.y + grid.height)
  expect(visibleBottom - visibleTop).toBeGreaterThanOrEqual(44)
  await longPress(page, { x: tile.x + tile.width / 2, y: (visibleTop + visibleBottom) / 2 })
  await expect(tray.locator('.sticker-large')).toBeVisible()
  await expect(page.getByTestId('mobile-stickers')).toBeHidden()
  await expect(page.locator('.sticker-placement')).toHaveCount(0)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  const place = (await tray.getByRole('button', { name: 'Place sticker', exact: true }).boundingBox())!, bounds = (await tray.boundingBox())!
  expect(place.y + place.height).toBeLessThanOrEqual(bounds.y + bounds.height)
  await tray.getByRole('button', { name: 'Favorite', exact: true }).tap()
  await expect(tray.getByRole('button', { name: 'Unfavorite', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: resolve(dir, `${test.info().project.name}-landscape-preview.png`) })
  // A new deliberate tap still works after the held finger's release was ignored.
  await tray.getByRole('button', { name: 'Place sticker', exact: true }).tap()
  await expect(page.locator('.sticker-placement')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
})

test('bottom-right sticker shelf browses sideways and lifts one sticker onto the board', async ({ page, request, browserName }) => {
  await stickerBoard(page, request)
  const launcher = page.getByTestId('mobile-stickers'), size = page.viewportSize()!
  const button = (await launcher.boundingBox())!
  expect(button.width).toBeGreaterThanOrEqual(44)
  expect(button.x + button.width).toBeGreaterThan(size.width - 30)
  await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray'), shelf = tray.locator('.sticker-scroll')
  await expect(launcher).toHaveAttribute('aria-expanded', 'true')
  const bounds = (await tray.boundingBox())!
  expect(bounds.y).toBeGreaterThan(size.height * .35)
  expect(bounds.y + bounds.height).toBeLessThan(button.y)
  const dir = resolve(`../../docs/qa/stickers/round-${process.env.STICKER_VISUAL_ROUND ?? '21'}`); mkdirSync(dir, { recursive: true })
  for (const name of ['Light', 'Dark']) {
    await tray.getByRole('button', { name: 'Close stickers' }).tap()
    await page.getByTestId('account').tap(); await page.getByRole('radio', { name, exact: true }).tap(); await page.keyboard.press('Escape')
    await openStickerTray(page)
    await page.screenshot({ path: resolve(dir, `${test.info().project.name}-${name.toLowerCase()}-sticker-shelf.png`) })
  }
  const scroll = (await shelf.boundingBox())!
  await touchDrag(page, { x: scroll.x + scroll.width - 24, y: scroll.y + scroll.height / 2 }, { x: scroll.x + 24, y: scroll.y + scroll.height / 2 })
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await expect(tray.locator('.sticker-large')).toHaveCount(0)
  if (browserName === 'chromium') await expect.poll(() => shelf.evaluate((el) => el.scrollLeft)).toBeGreaterThan(20)
  // Keep the chosen asset stable: scrolling a virtual shelf changes its last mounted tile.
  const asset = await tray.getByTestId('sticker-pick').last().getAttribute('data-sticker-asset')
  const tile = tray.locator(`[data-sticker-asset="${asset}"]`)
  await tile.scrollIntoViewIfNeeded()
  const position = await shelf.evaluate((el) => el.scrollLeft)
  expect(position).toBeGreaterThan(20)
  await launcher.tap(); await launcher.tap()
  await expect.poll(() => shelf.evaluate((el) => el.scrollLeft)).toBe(position)
  // Lift from the shelf with genuine touch input; commit once on release.
  const start = await center(tile), target = await at(page, .5, .25), finger = new Fingers(page)
  await finger.press(0, start)
  await finger.move(0, { x: start.x, y: start.y - 24 })
  await expect(page.getByTestId('sticker-ghost')).toBeVisible()
  await finger.move(0, target)
  await page.screenshot({ path: resolve(dir, `${test.info().project.name}-shelf-drag-ghost.png`) })
  const previewCenter = await center(page.getByTestId('sticker-ghost'))
  await finger.release(0)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  const committedCenter = await center(page.getByTestId('placed-sticker'))
  expect(committedCenter.x).toBeCloseTo(previewCenter.x, 0)
  expect(committedCenter.y).toBeCloseTo(previewCenter.y, 0)
  await expect(page.getByTestId('sticker-ghost')).toHaveCount(0)
  await expect(tray).toHaveCount(0)
  await expect(page.getByTestId('sticker-placement')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await openStickerTray(page)
  await tile.scrollIntoViewIfNeeded()
  const cancelStart = await center(tile), cancel = new Fingers(page)
  await cancel.press(0, cancelStart); await cancel.move(0, { x: cancelStart.x, y: cancelStart.y - 24 })
  await expect(page.getByTestId('sticker-ghost')).toBeVisible()
  await cancel.release(0) // still inside the shelf: dropping here cancels
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  await expect(page.getByTestId('sticker-ghost')).toHaveCount(0)
})
