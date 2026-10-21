import { expect, test, type Page } from '@playwright/test'
import { postSync } from './helpers.ts'
import { stickerBoard } from './sticker-helpers.ts'

if (process.env.PERF_HEADED) test.use({ headless: false, launchOptions: { args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] } })
async function frames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __stickerFrames: number[]; __stickerStop: boolean }
    w.__stickerFrames = []; w.__stickerStop = false
    let last = performance.now()
    const tick = (t: number) => { w.__stickerFrames.push(t - last); last = t; if (!w.__stickerStop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  for (let i = 0; i < 60; i++) await page.mouse.wheel(i < 30 ? 12 : -12, i < 30 ? 8 : -8)
  return page.evaluate(() => {
    const w = window as unknown as { __stickerFrames: number[]; __stickerStop: boolean }; w.__stickerStop = true
    const f = w.__stickerFrames.slice(2).sort((a, b) => a - b)
    return { p50: f[Math.floor(f.length * .5)], p95: f[Math.floor(f.length * .95)], samples: f.length }
  })
}

test('500 sticker overlays share the overview atlas, cull at detail, and pause offscreen playback @perf', async ({ page, request, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP performance metrics are Chromium-only')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const { id } = await stickerBoard(page, request)
  await page.request.post('/api/stickers/preview', { data: { link: 'DoggyFixture' } })
  const added = await page.request.post('/api/stickers/packs/DoggyFixture', { data: {} })
  const pack = (await added.json()).pack
  const objects = Array.from({ length: 500 }, (_, i) => {
    const { assetId, stickerId, packName, emoji, width, height, format } = pack.stickers[i % pack.stickers.length]
    return { id: crypto.randomUUID(), kind: 'sticker', boardId: id, x: i % 25 * 200, y: Math.floor(i / 25) * 200, w: 140, angle: (i % 7 - 3) * 8, z: i, createdAt: Date.now(), content: { assetId, stickerId, packName, emoji, width, height, format } }
  })
  for (let i = 0; i < objects.length; i += 200) expect((await postSync(page.request, { data: { changes: objects.slice(i, i + 200).map((o) => ({ id: o.id, patch: o })) } })).ok()).toBe(true)
  await page.reload(); await expect(page.getByTestId('canvas')).toBeVisible(); await page.keyboard.press('ControlOrMeta+1'); await expect(page.getByTestId('lod-layer')).toBeVisible()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await expect.poll(async () => Number(await page.getByTestId('lod-layer').getAttribute('data-thumbs'))).toBeGreaterThanOrEqual(12)
  const box = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const overview = await frames(page)
  await page.keyboard.press('ControlOrMeta+0')
  // Count once the zoom animation lands: mid-flight frames show more of the board.
  await expect(page.getByRole('button', { name: 'Zoom: 100%' })).toBeVisible()
  await expect.poll(() => page.getByTestId('placed-sticker').count()).toBeLessThan(100)
  const detailNodes = await page.getByTestId('placed-sticker').count()
  expect(detailNodes).toBeGreaterThan(0)
  const detail = await frames(page)
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  const heapMB = metrics.find((m) => m.name === 'JSHeapUsedSize')!.value / 1024 / 1024
  const report = { overview, detail, detailNodes, heapMB: Math.round(heapMB) }
  console.log('STICKER_PERF', JSON.stringify(report)); test.info().annotations.push({ type: 'perf', description: JSON.stringify(report) })
  expect(overview.p95).toBeLessThan(overview.p50 * 1.25); expect(detail.p95).toBeLessThan(detail.p50 * 1.25); expect(heapMB).toBeLessThan(150)
  await page.mouse.wheel(30_000, 30_000)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await expect(page.locator('.sticker-animation canvas, .sticker-animation video')).toHaveCount(0)
})
