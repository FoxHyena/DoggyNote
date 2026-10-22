import { expect, test, type Page } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { Fingers } from './touch.ts'

test.beforeEach(async ({ page }) => { await freshBoard(page) })

async function open(page: Page) {
  await page.getByTestId('board-navigation').tap()
  const sheet = page.getByTestId('board-navigation-menu')
  await expect(sheet).toBeVisible()
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))))
  const grip = (await sheet.getByTestId('sheet-grip').boundingBox())!
  const box = (await sheet.boundingBox())!
  return { sheet, top: box.y, point: { x: grip.x + grip.width / 2, y: grip.y + 12 } }
}

test('a slow grip pull tracks the finger and closes without browser scroll cancellation', async ({ page }) => {
  const { sheet, top, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(60)
    await finger.move(0, { ...point, y: point.y + i * 12 })
    await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(top + i * 12, 0)
  }
  await finger.release(0)
  await expect(sheet).toHaveCount(0)
})

test('a fast short pull held stationary before release returns to rest', async ({ page }) => {
  const { sheet, top, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.move(0, { ...point, y: point.y + 40 })
  await page.waitForTimeout(600)
  await finger.release(0)
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(top, 0)
})

test('an immediate short flick still dismisses', async ({ page }) => {
  const { sheet, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.move(0, { ...point, y: point.y + 25 })
  await finger.move(0, { ...point, y: point.y + 50 })
  await finger.release(0)
  await expect(sheet).toHaveCount(0)
})

test('slow releases preserve the distance boundary', async ({ page }) => {
  for (const distance of [80, 81]) {
    const { sheet, top, point } = await open(page)
    const finger = new Fingers(page)
    await finger.press(0, point)
    await finger.move(0, { ...point, y: point.y + distance })
    await page.waitForTimeout(150)
    await finger.release(0)
    if (distance > 80) await expect(sheet).toHaveCount(0)
    else {
      await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(top, 0)
      await page.keyboard.press('Escape')
    }
  }
})

test('cancelling a pull past the threshold restores instead of dismissing', async ({ page }) => {
  const { sheet, top, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.move(0, { ...point, y: point.y + 100 })
  await finger.cancel()
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(top, 0)
  await page.waitForTimeout(220)
  await expect(sheet).toBeVisible()
})

test('regrabbing a returning sheet continues from its presentation position', async ({ page }) => {
  const { sheet, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.move(0, { ...point, y: point.y + 60 })
  await page.waitForTimeout(150)
  await finger.release(0)
  await sheet.evaluate((el) => el.getAnimations().forEach((a) => a.updatePlaybackRate(0.15)))
  await page.waitForTimeout(25)
  const b = (await sheet.getByTestId('sheet-grip').boundingBox())!
  const grab = { x: b.x + b.width / 2, y: b.y + 10 }
  await finger.press(0, grab)
  const held = (await sheet.boundingBox())!.y
  await finger.move(0, { ...grab, y: grab.y + 7 })
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(held + 7, 0)
  await page.waitForTimeout(150)
  await finger.release(0)
  await expect(sheet).toBeVisible()
})

test('regrabbing a closing sheet cancels its old dismissal', async ({ page }) => {
  const { sheet, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.move(0, { ...point, y: point.y + 90 })
  await page.waitForTimeout(150)
  await finger.release(0)
  // Slow the existing exit for a reliable hit on the moving 28px grip across
  // the CDP round trip. Motion remains enabled and the owner must cancel it.
  await sheet.evaluate((el) => el.getAnimations().forEach((a) => a.updatePlaybackRate(0.15)))
  await page.waitForTimeout(20)
  const b = (await sheet.getByTestId('sheet-grip').boundingBox())!
  const grab = { x: b.x + b.width / 2, y: b.y + 10 }
  await finger.press(0, grab)
  await finger.move(0, { ...grab, y: grab.y - 30 })
  await page.waitForTimeout(240)
  await expect(sheet).toBeAttached()
  await finger.cancel()
  await expect(sheet).toBeVisible()
})

test('other pointers cannot move or release the owned sheet', async ({ page }) => {
  const { sheet, top, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.press(1, { x: point.x + 40, y: point.y })
  await finger.move(1, { x: point.x + 40, y: point.y + 100 })
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(top, 0)
  await finger.release(1)
  await finger.move(0, { ...point, y: point.y + 100 })
  await page.waitForTimeout(150)
  await finger.release(0)
  await expect(sheet).toHaveCount(0)
})

test('an upward reversal returns beyond the threshold (timed pointer replay)', async ({ page }) => {
  const { sheet, top, point } = await open(page)
  // One browser task avoids RPC delays changing the velocity being tested.
  // Native Chromium ownership and scrolling are tested separately above.
  await sheet.getByTestId('sheet-grip').evaluate(async (grip, point) => {
    const send = (type: string, dy: number) => grip.dispatchEvent(new PointerEvent(type, { pointerId: 701, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: point.x, clientY: point.y + dy, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 }))
    send('pointerdown', 0)
    send('pointermove', 160)
    await new Promise((resolve) => setTimeout(resolve, 150))
    send('pointermove', 120)
    send('pointermove', 90)
    send('pointerup', 90)
  }, point)
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(top, 0)
})

test('unmounting a closing sheet cannot dismiss its replacement', async ({ page }) => {
  const { sheet, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.move(0, { ...point, y: point.y + 90 })
  await page.waitForTimeout(150)
  await finger.release(0)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await open(page)
  await page.waitForTimeout(250)
  await expect(sheet).toBeVisible()
})

test('reduced motion settles without leaving a spatial animation running', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { sheet, top, point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.move(0, { ...point, y: point.y + 40 })
  await page.waitForTimeout(150)
  await finger.release(0)
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(top, 0)
  expect(await sheet.evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0)
})

test('a grip takes over its entrance without jumping (pointer replay)', async ({ page }) => {
  await page.getByTestId('board-navigation').tap()
  const sheet = page.getByTestId('board-navigation-menu')
  await sheet.evaluate((el) => el.getAnimations().forEach((a) => a.updatePlaybackRate(0.15)))
  // Hit-test and deliver in one renderer task: an RPC round trip can move a
  // 28px grip past the sampled point. Other tests exercise native CDP input.
  const movement = await sheet.getByTestId('sheet-grip').evaluate((grip) => {
    const box = grip.getBoundingClientRect(), parent = grip.parentElement!
    const point = { x: box.x + box.width / 2, y: box.y + 12 }
    const send = (type: string, dy: number) => grip.dispatchEvent(new PointerEvent(type, { pointerId: 702, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: point.x, clientY: point.y + dy, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointercancel' ? 0 : 1 }))
    send('pointerdown', 0)
    const held = parent.getBoundingClientRect().y
    send('pointermove', 7)
    const delta = parent.getBoundingClientRect().y - held
    send('pointercancel', 7)
    return delta
  })
  expect(movement).toBeCloseTo(7, 0)
  await expect(sheet).toBeVisible()
})

test('leaving phone layout clears an owned drag and capture', async ({ page }) => {
  const { point } = await open(page)
  const finger = new Fingers(page)
  await finger.press(0, point)
  await finger.move(0, { ...point, y: point.y + 40 })
  await page.setViewportSize({ width: 1024, height: 768 })
  await finger.cancel()
  await expect(page.getByTestId('mobile-dock')).toHaveCount(0)
  await page.getByTestId('board-navigation').click()
  const sheet = page.getByTestId('board-navigation-menu')
  await expect(sheet).toBeVisible()
  expect(await sheet.evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  await expect(sheet.getByTestId('sheet-grip')).toBeHidden()
})

test('long sheet content keeps native vertical scrolling', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebKit touch replay does not synthesize native scrolling')
  for (let i = 0; i < 5; i++) await freshBoard(page)
  await page.setViewportSize({ width: 375, height: 450 })
  const { sheet } = await open(page)
  const list = page.getByTestId('board-navigation-list')
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  const b = (await list.boundingBox())!
  const finger = new Fingers(page)
  await finger.press(0, { x: b.x + b.width / 2, y: b.y + b.height - 30 })
  for (let i = 1; i <= 6; i++) await finger.move(0, { x: b.x + b.width / 2, y: b.y + b.height - 30 - i * 20 })
  await finger.release(0)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(sheet).toBeVisible()
})

test('a scrolled Share sheet keeps its grip above the sticky close control', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 450 })
  await page.getByTestId('share').tap()
  const sheet = page.getByTestId('share-panel')
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))))
  await sheet.evaluate((el) => { el.scrollTop = el.scrollHeight })
  const box = (await sheet.boundingBox())!
  const grip = (await sheet.getByTestId('sheet-grip').boundingBox())!
  const close = sheet.getByRole('button', { name: 'Close sharing', exact: true })
  const control = (await close.boundingBox())!
  expect(grip.y).toBeGreaterThanOrEqual(box.y)
  expect(grip.y).toBeLessThanOrEqual(box.y + 1)
  expect(control.y).toBeGreaterThanOrEqual(grip.y + grip.height - 1)
  await close.tap()
  await expect(sheet).toHaveCount(0)
})
