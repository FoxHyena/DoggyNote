import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { at, camera, cardByText, waitForSync } from './helpers.ts'
import { Fingers, center, longPress, note, seedCards, tap, tapHoldSlide, tapOn, touchDrag } from './touch.ts'
import { importFixturePack, openStickerTray, seedStickers, stickerBoard, stickerRingPoint, stickerState } from './sticker-helpers.ts'

test.use({ trace: 'retain-on-failure' })

// Capture before application listeners so a missing native click can be
// distinguished from one intercepted by the application. No input is mocked.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const events: object[] = [], nodes = new WeakMap<EventTarget, number>()
    let next = 0
    const id = (target: EventTarget | null) => {
      if (!target) return null
      if (!nodes.has(target)) nodes.set(target, ++next)
      return nodes.get(target)
    }
    ;(window as unknown as { touchInputEvidence: object[] }).touchInputEvidence = events
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click', 'gotpointercapture', 'lostpointercapture', 'resize']) window.addEventListener(type, (event) => {
      const target = event.target as Element | null, pointer = event as PointerEvent, touches = event as TouchEvent
      const entry = { type, at: performance.now(), node: id(target), tag: target?.tagName, button: target?.closest?.('button')?.dataset.testid, path: event.composedPath().map(id), x: pointer.clientX, y: pointer.clientY, pointerId: pointer.pointerId, active: touches.touches && [...touches.touches].map((t) => t.identifier), changed: touches.changedTouches && [...touches.changedTouches].map((t) => t.identifier), prevented: event.defaultPrevented, connected: target?.isConnected, width: innerWidth, height: innerHeight, outerWidth, outerHeight, screenWidth: screen.width }
      events.push(entry)
      queueMicrotask(() => { entry.prevented = event.defaultPrevented; entry.connected = target?.isConnected })
    }, { capture: true, passive: true })
  })
})
test.afterEach(async ({ page }) => {
  if (test.info().status === test.info().expectedStatus || page.isClosed()) return
  const events = await page.evaluate(() => (window as unknown as { touchInputEvidence: object[] }).touchInputEvidence)
  await test.info().attach('native-touch-input', { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
})

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
  await f.press(1, { x: c.x + 80, y: c.y + 80 }); await f.move(1, { x: c.x + 110, y: c.y + 110 })
  // The fingers come to rest before lifting, as a real pinch does. A release mid-motion
  // starts a fling in Chromium, and the next tap (the Stickers button below) would only
  // stop that fling and never click. Chromium counts a finger as stopped after 40ms.
  await page.waitForTimeout(100)
  await f.release(1); await f.release(0)
  const after = await stickerState(page)
  expect(after.x).toBe(before.x); expect(after.w).toBe(before.w); expect(after.angle).toBe(before.angle)
  await waitForSync(page)
  await page.setViewportSize({ width: 844, height: 390 }); await openStickerTray(page)
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

test('moving a sticker over a note being edited never selects text; a double-tap-hold slide on it zooms instead', async ({ page, request }) => {
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  await seedStickers(page, id, [{ x: 130, y: 0 }])
  await seedCards(page, [note('Words to not select here', 0, 0, { w: 300 })])
  const sticker = page.getByTestId('placed-sticker')
  await expect(sticker).toHaveCount(1)
  // Edit the note beside the sticker, then pick the sticker up from on top of it.
  const words = cardByText(page, 'Words to not select')
  await tapOn(page, words); await tapOn(page, words)
  await expect(page.getByTestId('note-editor')).toBeVisible()
  const p = await center(sticker)
  await tap(page, p)
  await expect(page.getByTestId('note-editor')).toHaveCount(0)
  const before = await stickerState(page)
  // A finger back down within 300 ms would be a double-tap (slide-zoom); a person lifts and regrips slower.
  await page.waitForTimeout(400)
  // Held still first, the way a long-press would start a native selection.
  await touchDrag(page, p, { x: p.x + 40, y: p.y + 60 }, { hold: 600 })
  expect((await stickerState(page)).x).toBeGreaterThan(before.x + 25)
  expect(await page.evaluate(() => String(getSelection()))).toBe('')
  // Double-tap and slide on the sticker: the board zooms, the sticker stays.
  const moved = await stickerState(page), z0 = (await camera(page)).zoom
  await tapHoldSlide(page, await center(sticker), -100)
  expect((await camera(page)).zoom).toBeGreaterThan(z0 * 1.4)
  const after = await stickerState(page)
  expect(after.x).toBe(moved.x); expect(after.y).toBe(moved.y); expect(after.w).toBe(moved.w)
  expect(await page.evaluate(() => String(getSelection()))).toBe('')
  await waitForSync(page)
})

test('an animated sticker plays on a phone without being selected; Pause and Play take a real tap', async ({ page, request }) => {
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  // The fixture pack's first two are a still and a TGS animation.
  const [, tgs] = await seedStickers(page, id, [{ x: -150, y: 0 }, { x: 0, y: 0 }])
  const placed = page.locator(`[data-sticker-id="${tgs}"]`), image = placed.locator('.sticker-image')
  await expect(image).toHaveClass(/playing/)
  // The sheet covers the board on a phone.
  await page.getByTestId('sticker-tray').getByRole('button', { name: 'Close stickers' }).tap()
  await expect(page.getByTestId('sticker-tray')).toHaveCount(0)
  await tap(page, await center(placed))
  const sheet = page.getByTestId('sticker-controls')
  await sheet.getByRole('button', { name: 'Pause animation' }).tap()
  await expect(image).not.toHaveClass(/playing/)
  await expect(placed.locator('.sticker-animation canvas')).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Play animation' }).tap()
  await expect(image).toHaveClass(/playing/)
})
