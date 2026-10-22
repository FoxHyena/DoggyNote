import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { importFixturePack, placedStickers, previewSticker, seedStickers, stickerBoard } from './sticker-helpers.ts'

/** Corner and centre alpha of whatever is playing: the TGS canvas, a native video, or decoded WebM frames. */
const alpha = (player: Locator) => player.evaluate((el: HTMLCanvasElement | HTMLVideoElement) => {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const ctx = c.getContext('2d')!; ctx.drawImage(el, 0, 0, 64, 64)
  return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(32, 32, 1, 1).data[3]]
})
/** WebKit has no WebM alpha in <video>; DoggyNote decodes the frames itself where WebCodecs can. */
const decodesWebm = (page: Page) => page.evaluate(async () => typeof VideoDecoder !== 'undefined' && !!(await VideoDecoder.isConfigSupported({ codec: 'vp09.00.10.08', codedWidth: 256, codedHeight: 256 })).supported)

test('TGS and WEBM previews stay transparent, keep looping, pause on request and respect reduced motion', async ({ page, request, browserName }) => {
  test.setTimeout(60_000)
  await stickerBoard(page, request); await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray'), dir = resolve('../../docs/qa/stickers/formats'); mkdirSync(dir, { recursive: true })
  await previewSticker(page, '🐾')
  const large = tray.locator('.sticker-large'), image = large.locator('.sticker-image'), canvas = large.locator('.sticker-animation canvas')
  await expect(image).toHaveClass(/playing/)
  await expect.poll(() => alpha(canvas)).toEqual([0, 255])
  await large.screenshot({ path: resolve(dir, `${browserName}-tgs.png`) })
  // The fixture is two seconds long: well past two loops, it is still playing.
  await page.waitForTimeout(5000)
  await expect(image).toHaveClass(/playing/)
  await tray.getByTestId('sticker-preview-play').click()
  await expect(tray.getByTestId('sticker-preview-play')).toHaveAccessibleName('Play animation')
  await expect(image).not.toHaveClass(/playing/); await expect(canvas).toHaveCount(0); await expect(large.locator('img')).toBeVisible()
  await tray.getByTestId('sticker-preview-play').click()
  await expect(image).toHaveClass(/playing/)
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(canvas).toHaveCount(0)
  await expect(large.locator('img')).toBeVisible()
  await tray.getByTestId('sticker-preview-back').click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  await previewSticker(page, '🦴')
  const player = large.locator('.sticker-animation video, .sticker-animation canvas')
  if (browserName === 'webkit' && !await decodesWebm(page)) {
    test.info().annotations.push({ type: 'limitation', description: 'This WebKit build has no VP9 VideoDecoder; the WEBM keeps its transparent still.' })
    await expect(player).toHaveCount(0); await expect(large.locator('img')).toBeVisible()
    return
  }
  await expect(image).toHaveClass(/playing/)
  if (browserName === 'webkit') await expect(large.locator('.sticker-animation canvas')).toHaveCount(1)
  await expect.poll(() => alpha(player.last())).toEqual([0, 255])
  await large.screenshot({ path: resolve(dir, `${browserName}-webm.png`) })
  await page.waitForTimeout(3000)
  await expect(image).toHaveClass(/playing/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(player).toHaveCount(0); await expect(large.locator('img')).toBeVisible()
})

test('animated stickers on a board loop without being selected, and Pause stops one for this viewer', async ({ page, request }) => {
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  await page.keyboard.press('Escape')
  // The fixture pack's first three are static, TGS and WEBM.
  const [still, tgs] = await seedStickers(page, id, [{ x: 80, y: 80 }, { x: 260, y: 80 }, { x: 440, y: 80 }])
  await page.reload(); await expect(page.getByTestId('canvas')).toBeVisible()
  const sticker = (s: string) => page.locator(`[data-sticker-id="${s}"] .sticker-image`)
  await expect(sticker(tgs)).toHaveClass(/playing/)
  await expect(sticker(still)).not.toHaveClass(/playing/)
  await page.waitForTimeout(5000)
  await expect(sticker(tgs)).toHaveClass(/playing/)
  const box = (await page.locator(`[data-sticker-id="${tgs}"]`).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const controls = page.getByTestId('sticker-controls'), saved = await placedStickers(page, id)
  await controls.getByRole('button', { name: 'Pause animation' }).click()
  await expect(sticker(tgs)).not.toHaveClass(/playing/)
  await expect(page.locator(`[data-sticker-id="${tgs}"] .sticker-animation canvas`)).toHaveCount(0)
  await controls.getByRole('button', { name: 'Play animation' }).click()
  await expect(sticker(tgs)).toHaveClass(/playing/)
  // Pausing is local to this viewer: the board itself never changed.
  expect(await placedStickers(page, id)).toEqual(saved)
})
