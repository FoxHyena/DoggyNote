import { expect, test } from '@playwright/test'
import { importFixturePack, openStickerTray, seedStickers, stickerBoard } from './sticker-helpers.ts'

// WKWebView painted placed stickers over the tray while the board moved (the
// world is composited during pans). Screenshots here can't see compositor
// output, so this pins the fix: the tray keeps its own layer and stays on top.
test('the sticker tray stays above placed stickers while the board pans', async ({ page, request }) => {
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  const spots = []
  for (let x = -1320; x <= 1320; x += 220) for (let y = -1320; y <= 1320; y += 220) spots.push({ x, y })
  await seedStickers(page, id, spots)
  await page.reload(); await expect(page.getByTestId('canvas')).toBeVisible()
  await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Doggy daydreams', exact: true }).click()
  await expect(tray.getByTestId('sticker-pick')).toHaveCount(12)
  await expect(tray).toHaveCSS('will-change', 'transform')
  await expect(tray).toHaveCSS('isolation', 'isolate')
  const box = (await tray.boundingBox())!, canvas = (await page.getByTestId('canvas').boundingBox())!
  const probes = [0.25, 0.5, 0.75].flatMap((fx) => [0.3, 0.6, 0.9].map((fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })))
  // Stickers are under the tray, not just beside it.
  await expect.poll(() => page.evaluate(({ x, y, width, height }) => [...document.querySelectorAll('[data-testid="placed-sticker"]')].some((el) => {
    const r = el.getBoundingClientRect()
    return r.right > x && r.left < x + width && r.bottom > y && r.top < y + height
  }), box)).toBe(true)
  await page.mouse.move(canvas.x + canvas.width - 120, canvas.y + canvas.height / 2)
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(i % 2 ? -60 : 70, i % 2 ? 40 : -30)
    await expect(page.locator('.viewport.moving')).toHaveCount(1)
    const onTray = await page.evaluate((points) => points.every((p) => !!document.elementFromPoint(p.x, p.y)?.closest('[data-testid="sticker-tray"]')), probes)
    expect(onTray).toBe(true)
  }
})
