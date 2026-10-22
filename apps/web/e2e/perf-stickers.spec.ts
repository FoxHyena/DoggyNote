import { expect, test, type Page } from '@playwright/test'
import { postSync } from './helpers.ts'
import { openStickerTray, stickerBoard } from './sticker-helpers.ts'
import { hundredStickerPack } from './sticker-windowing.ts'

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
  // Allow the culling grid's 256px quantization, 160px overscan and the
  // rotated artwork's ~100px half-extent. Wheel distances differ by engine;
  // a Chromium-specific count rejects valid WebKit camera positions.
  const padding = 160 + 256 + 100
  const maxDetailNodes = Math.ceil((box.width + padding * 2) / 200) * Math.ceil((box.height + padding * 2) / 200)
  await expect.poll(() => page.getByTestId('placed-sticker').count()).toBeLessThanOrEqual(maxDetailNodes)
  const detailNodes = await page.getByTestId('placed-sticker').count()
  expect(detailNodes).toBeGreaterThan(0)
  const detail = await frames(page)
  let heapMB: number | undefined
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.collectGarbage')
    const { metrics } = await cdp.send('Performance.getMetrics')
    heapMB = metrics.find((m) => m.name === 'JSHeapUsedSize')!.value / 1024 / 1024
    expect(heapMB).toBeLessThan(150)
  }
  const report = { browserName, overview, detail, detailNodes, heapMB: heapMB === undefined ? undefined : Math.round(heapMB) }
  console.log('STICKER_PERF', JSON.stringify(report)); test.info().annotations.push({ type: 'perf', description: JSON.stringify(report) })
  for (const sample of [overview, detail]) {
    expect(sample.samples).toBeGreaterThan(30)
    expect(sample.p95).toBeLessThan(33.4)
    expect(sample.p95).toBeLessThan(sample.p50 * 1.25)
  }
  await page.mouse.wheel(30_000, 30_000)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await expect(page.locator('.sticker-animation canvas, .sticker-animation video')).toHaveCount(0)
})

test('100 unique pack images stay bounded and two static stickers keep pan smooth with the tray open or closed @perf', async ({ page, request, browserName }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await stickerBoard(page, request)
  const { pack, requested } = await hundredStickerPack(page)
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .5)
  const baseline = await frames(page)
  await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: pack.title, exact: true }).click()
  await expect(tray.getByTestId('sticker-pick').first().locator('img')).toBeVisible()
  expect(await tray.getByTestId('sticker-pick').count()).toBeLessThanOrEqual(28)
  expect(requested.size).toBeLessThanOrEqual(28)
  for (let i = 0; i < 2; i++) {
    await tray.locator(`[data-sticker-asset="${pack.stickers[0].assetId}"]`).click()
    await page.getByRole('button', { name: 'Place at center', exact: true }).click()
    if (i === 0) await openStickerTray(page)
  }
  await expect(page.getByTestId('placed-sticker')).toHaveCount(2)
  await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .5)
  const closed = await frames(page)
  await openStickerTray(page)
  await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .5)
  const open = await frames(page)
  const report = { browserName, baseline, closed, open, mountedImages: await tray.locator('img').count(), requestedImages: requested.size }
  console.log('STICKER_PACK_PERF', JSON.stringify(report))
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(report) })
  for (const sample of [baseline, closed, open]) {
    expect(sample.samples).toBeGreaterThan(30)
    expect(sample.p95).toBeLessThan(33.4)
    expect(sample.p95).toBeLessThan(baseline.p95 * 1.25)
  }
  await tray.getByRole('button', { name: 'Close stickers', exact: true }).click()
  await expect(page.locator('.sticker-tray img, .sticker-animation canvas, .sticker-animation video')).toHaveCount(0)
})

test('a board full of animated stickers plays at most twelve at once and keeps pan smooth @perf', async ({ page, request, browserName }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const { id } = await stickerBoard(page, request)
  await page.request.post('/api/stickers/preview', { data: { link: 'DoggyFixture' } })
  const animated = (await (await page.request.post('/api/stickers/packs/DoggyFixture', { data: {} })).json()).pack.stickers.filter((s: { format: string }) => s.format !== 'static')
  // 200 TGS and WEBM stickers, 110 px apart: far more on screen than may play.
  const objects = Array.from({ length: 200 }, (_, i) => {
    const { assetId, stickerId, packName, emoji, width, height, format } = animated[i % animated.length]
    // The last one sits far away, so fitting the board drops to the overview.
    const far = i === 199 ? 8000 : 0
    return { id: crypto.randomUUID(), kind: 'sticker', boardId: id, x: i % 20 * 110 + far, y: Math.floor(i / 20) * 110 + far, w: 100, angle: 0, z: i, createdAt: Date.now(), content: { assetId, stickerId, packName, emoji, width, height, format } }
  })
  expect((await postSync(page.request, { data: { changes: objects.map((o) => ({ id: o.id, patch: o })) } })).ok()).toBe(true)
  await page.reload(); await expect(page.getByTestId('canvas')).toBeVisible()
  const players = page.locator('.sticker-image.playing')
  await expect.poll(() => players.count(), { timeout: 15_000 }).toBe(12)
  expect(await page.getByTestId('placed-sticker').count()).toBeGreaterThan(12)
  const box = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const sample = await frames(page)
  expect(await page.locator('.sticker-animation canvas, .sticker-animation video').count()).toBeLessThanOrEqual(12)
  const report = { browserName, sample, players: await players.count() }
  console.log('STICKER_ANIMATED_PERF', JSON.stringify(report)); test.info().annotations.push({ type: 'perf', description: JSON.stringify(report) })
  expect(sample.samples).toBeGreaterThan(30)
  expect(sample.p95).toBeLessThan(33.4)
  // Overview draws stills only.
  await page.keyboard.press('ControlOrMeta+1'); await expect(page.getByTestId('lod-layer')).toBeVisible()
  await expect(page.locator('.sticker-animation canvas, .sticker-animation video')).toHaveCount(0)
})
