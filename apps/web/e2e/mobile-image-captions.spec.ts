import { expect, test, type Page } from '@playwright/test'
import { camera, freshBoard, waitForSync } from './helpers.ts'
import { closeKeyboard, fakeKeyboard, tap, tapEmpty, tapOn } from './touch.ts'

// On a phone: tap to select, tap again (a double-tap) to type the caption under
// the image; closing the keyboard or tapping the board finishes. The selection
// bar's Edit opens it too. No edit dock: that's for formatting notes.

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
  await expect(page.getByTestId('edit-dock')).toHaveCount(0)
  await page.keyboard.type('Zoomies')
  await tapEmpty(page)
  await expect(input).toHaveCount(0)
  await expect(card.getByTestId('image-caption')).toHaveText('Zoomies')
  // The board glides back to where it was before the next tap.
  await expect.poll(async () => JSON.stringify(await camera(page))).toBe(JSON.stringify(before))

  await tapOn(page, card.getByTestId('card-image'))
  await expect(card).toHaveClass(/selected/)
  await page.getByTestId('edit-card').tap()
  await expect(input).toHaveValue('Zoomies')
  await page.keyboard.type('!')
  await closeKeyboard(page)
  await expect(card.getByTestId('image-caption')).toHaveText('Zoomies!')

  await waitForSync(page)
  await page.reload()
  await expect(page.locator('[data-testid="card"][data-type="image"]').getByTestId('image-caption')).toHaveText('Zoomies!')
})

/** Upload a plain image; returns its card and a point to tap on the picture. */
async function addImage(page: Page, size = { w: 200, h: 150 }) {
  const png = Buffer.from(await page.evaluate(async ({ w, h }) => {
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#4a90c2'
    ctx.fillRect(0, 0, w, h)
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const b of buf) s += String.fromCharCode(b)
    return btoa(s)
  }, size), 'base64')
  await page.getByTestId('image-input').setInputFiles({ name: 'rex.png', mimeType: 'image/png', buffer: png })
  const card = page.locator('[data-testid="card"][data-type="image"]')
  await expect(card).toHaveCount(1)
  const box = (await card.getByTestId('card-image').boundingBox())!
  // Near the top: a tall picture runs under the bottom bar.
  const p = { x: box.x + box.width / 2, y: box.y + Math.min(60, box.height / 2) }
  return { card, p }
}

/** Upload a plain image and open its caption with two taps. */
async function captionAnImage(page: Page, size = { w: 200, h: 150 }) {
  const { card, p } = await addImage(page, size)
  const before = await camera(page)
  await tap(page, p)
  await expect(card).toHaveClass(/selected/)
  await tap(page, p)
  const input = page.getByTestId('image-caption-input')
  await expect(input).toBeFocused()
  return { card, input, before }
}

/** The caption field has focus right after the tap, and still has it ~300ms later (every frame). */
async function captionKeepsFocus(page: Page) {
  const lost = await page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const t0 = performance.now()
        const check = () => {
          const a = document.activeElement as HTMLElement | null
          if (a?.dataset.testid !== 'image-caption-input') return resolve(a ? `${a.tagName}.${a.className}` : 'nothing')
          if (performance.now() - t0 > 300) return resolve(null)
          requestAnimationFrame(check)
        }
        check()
      }),
  )
  expect(lost, 'focus moved away from the caption').toBeNull()
}

for (const path of ['a fresh image', 'an image already selected'] as const) {
  test(`double-tapping ${path} focuses the caption in the tap, and a late mousedown can't take it`, async ({ page }) => {
    const { card, p } = await addImage(page)
    if (path === 'an image already selected') {
      await tap(page, p)
      await expect(card).toHaveClass(/selected/)
      // Well past the double-tap window, so the next two taps are their own double-tap.
      await page.waitForTimeout(450)
      await tap(page, p)
      await page.waitForTimeout(60)
    } else {
      await tap(page, p)
    }
    await tap(page, p)
    // Focused within the tap itself, not a moment later.
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)).toBe('image-caption-input')
    // iOS answers a double-tap with a mousedown on the picture under the finger, right after it,
    // and on a slow phone it can come late. Playwright's mouse also sends a pointerdown, which iOS
    // doesn't, so press where the picture is once the edit glide lands: a press on the board ends the edit.
    await settled(page)
    const now = (await card.getByTestId('card-image').boundingBox())!
    await page.mouse.move(now.x + now.width / 2, now.y + Math.min(40, now.height / 2))
    await page.mouse.down()
    await page.mouse.up()
    await captionKeepsFocus(page)
  })
}

/** Wait until the camera stops moving. */
async function settled(page: Page) {
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await camera(page))
    const same = now === last
    last = now
    return same
  }, { intervals: [150] }).toBe(true)
}

test('a caption gets no edit dock, and the keyboard’s own ✓ finishes it', async ({ page }) => {
  const { card, input, before } = await captionAnImage(page)
  await expect(page.getByTestId('edit-dock')).toHaveCount(0)
  // The board's own controls still step away while typing.
  await expect(page.getByTestId('mobile-dock')).toBeHidden()
  await page.keyboard.type('Good boy')
  // The iOS keyboard's ✓ only blurs the field.
  await closeKeyboard(page)
  await expect(input).toHaveCount(0)
  await expect(page.getByTestId('mobile-dock')).toBeVisible()
  await expect(card.getByTestId('image-caption')).toHaveText('Good boy')
  await expect(card).not.toHaveClass(/selected/)
  await expect.poll(async () => JSON.stringify(await camera(page))).toBe(JSON.stringify(before))
  await waitForSync(page)
  await page.reload()
  await expect(page.locator('[data-testid="card"][data-type="image"]').getByTestId('image-caption')).toHaveText('Good boy')
})

test('captioning never scrolls the page, and a tap on the picture keeps typing', async ({ page }) => {
  const { card, input } = await captionAnImage(page)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await settled(page)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  // The dotted board behind stays where it was: nothing slid it up.
  expect(await page.locator('.viewport').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0)
  await tapOn(page, card.getByTestId('card-image'))
  await page.waitForTimeout(100)
  await expect(input).toBeFocused()
})

test('when the keyboard opens, the caption glides above it in one move', async ({ page }) => {
  // A tall picture, so the caption under it lands behind the keyboard.
  const { input } = await captionAnImage(page, { w: 200, h: 520 })
  await settled(page)
  const full = await page.evaluate(() => innerHeight)
  const kb = Math.round(full * 0.45)
  // Record the camera every frame while the keyboard "opens".
  await page.evaluate((height) => {
    const w = window as unknown as { __ys: number[] }
    w.__ys = []
    const world = document.querySelector<HTMLElement>('[data-testid=world]')!
    const t0 = performance.now()
    const rec = () => {
      const t = getComputedStyle(world).transform
      w.__ys.push(t === 'none' ? 0 : new DOMMatrix(t).f)
      if (performance.now() - t0 < 700) requestAnimationFrame(rec)
    }
    requestAnimationFrame(rec)
    Object.defineProperty(visualViewport!, 'height', { configurable: true, value: height })
    visualViewport!.dispatchEvent(new Event('resize'))
  }, full - kb)
  await page.waitForTimeout(900)
  const ys = await page.evaluate(() => (window as unknown as { __ys: number[] }).__ys)
  const moved = Math.abs(ys[ys.length - 1] - ys[0])
  expect(moved).toBeGreaterThan(20)
  // Over several frames, never one snap.
  const steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]))
  expect(Math.max(...steps)).toBeLessThan(moved * 0.6)
  expect(steps.filter((s) => s > 0.5).length).toBeGreaterThan(2)
  // The caption ends up just above the keyboard: no room kept for a dock captions don't have.
  const box = (await input.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(full - kb)
  expect(box.y + box.height).toBeGreaterThan(full - kb - 56)
  expect(box.y).toBeGreaterThanOrEqual(0)
})

test('the keyboard closing finishes the caption, even when focus stays', async ({ page }) => {
  const { card, input, before } = await captionAnImage(page)
  await fakeKeyboard(page, true)
  await page.keyboard.type('Sit')
  await page.waitForTimeout(100)
  await expect(input).toBeFocused()
  await fakeKeyboard(page, false)
  await expect(input).toHaveCount(0)
  await expect(card.getByTestId('image-caption')).toHaveText('Sit')
  await expect(card).not.toHaveClass(/selected/)
  await expect.poll(async () => JSON.stringify(await camera(page))).toBe(JSON.stringify(before))
})
