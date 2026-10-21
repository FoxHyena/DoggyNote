import { expect, test, type Page, type Route } from '@playwright/test'
import { postSync, waitForSync } from './helpers.ts'
import { importFixturePack, openStickerTray, stickerBoard, stickerState } from './sticker-helpers.ts'

async function placeSticker(page: Page) {
  await page.getByTestId('sticker-pick').first().click(); await page.getByRole('button', { name: 'Place at center', exact: true }).click(); await waitForSync(page)
  await page.keyboard.press('Escape')
  const sticker = page.getByTestId('placed-sticker')
  await expect.poll(() => sticker.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  await expect(sticker.locator('.sticker-image')).toHaveAttribute('data-state', 'ready')
  return sticker
}

/** Records any moment the placed sticker's artwork goes away: its src cleared, its image replaced, or the blank back. */
async function watchArtwork(page: Page) {
  await page.getByTestId('placed-sticker').evaluate((host) => {
    const flashes: string[] = [], img = host.querySelector('img')!
    ;(window as unknown as { flashes: string[] }).flashes = flashes
    new MutationObserver(() => {
      if (host.querySelector('img') !== img) flashes.push('image replaced')
      else if (!img.getAttribute('src')) flashes.push('src cleared')
      if (host.querySelector('.sticker-blank')) flashes.push('blank shown')
    }).observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-state'] })
  })
}
const flashes = (page: Page) => page.evaluate(() => (window as unknown as { flashes: string[] }).flashes)

test('a synced change to a placed sticker never reloads its artwork', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  await placeSticker(page)
  const { id } = await stickerState(page)
  await watchArtwork(page)
  // Another device turns it; the pulled row brings a fresh copy of the same artwork.
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { angle: 30 } }] } })).ok()).toBe(true)
  await page.getByTestId('sync-status').click()
  await expect.poll(async () => (await stickerState(page)).angle).toBe(30)
  await waitForSync(page)
  expect(await flashes(page)).toEqual([])
})

test('dropping a sticker after a pull landed mid-drag keeps its artwork on screen', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  const sticker = await placeSticker(page)
  const { id, x } = await stickerState(page)
  await watchArtwork(page)
  const b = (await sticker.boundingBox())!, cx = b.x + b.width / 2, cy = b.y + b.height / 2
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 10, { steps: 5 })
  // A change arrives while the sticker is held; it waits for the drop.
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { angle: 15 } }] } })).ok()).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await waitForSync(page)
  await page.mouse.move(cx + 80, cy + 20, { steps: 5 }); await page.mouse.up()
  await waitForSync(page)
  await expect.poll(async () => (await stickerState(page)).angle).toBe(15)
  expect((await stickerState(page)).x).not.toBe(x)
  expect(await flashes(page)).toEqual([])
})

test('artwork that is slow to arrive shows a blank sticker with its emoji, then fades in', async ({ page, request, browser }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  await placeSticker(page)
  // A fresh device has no rendered outlines yet, so every sticker waits on the network.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: await page.context().storageState() })
  try {
    const other = await ctx.newPage(), held: Route[] = []
    let holding = true
    await other.route('**/api/assets/**', (route) => holding ? void held.push(route) : route.continue())
    await other.goto(page.url())
    const placed = other.getByTestId('placed-sticker').locator('.sticker-image')
    await expect(placed).toHaveAttribute('data-state', 'loading')
    await expect(placed.locator('.sticker-blank')).toBeVisible()
    await expect(placed.locator('.sticker-blank')).toHaveText('🐶')
    await openStickerTray(other)
    const tile = other.getByTestId('sticker-pick').first().locator('.sticker-image')
    await expect(tile.locator('.sticker-blank')).toBeVisible()
    holding = false
    for (const route of held.splice(0)) await route.continue()
    for (const image of [placed, tile]) {
      await expect(image).toHaveAttribute('data-state', 'ready')
      await expect(image.locator('.sticker-blank')).toHaveCount(0)
      await expect.poll(() => image.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === '1')).toBe(true)
    }
  } finally { await ctx.close() }
})
