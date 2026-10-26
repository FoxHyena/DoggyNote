import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { camera, canvasBox, postSync, setAccountAppearance, waitForSync } from './helpers.ts'
import { importFixturePack, previewSticker, openStickerTray, stickerBoard, adjustSticker } from './sticker-helpers.ts'

const round = process.env.STICKER_VISUAL_ROUND ?? '1'
async function capture(page: Page, engine: string, name: string) {
  const dir = resolve(`../../docs/qa/stickers/round-${round}`); mkdirSync(dir, { recursive: true })
  await page.mouse.move(1, 1)
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter((img) => { const r = img.getBoundingClientRect(); return r.width && r.height && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight }).map((img) => img.decode().catch(() => {}))) })
  await page.screenshot({ path: resolve(dir, `${engine}-${name}.png`), animations: 'disabled' })
}
async function theme(page: Page, name: 'Light' | 'Dark') {
  await setAccountAppearance(page, name)
}
async function inViewport(page: Page) {
  const r = (await page.getByTestId('sticker-tray').boundingBox())!, v = page.viewportSize()!
  expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0)
  expect(r.x + r.width).toBeLessThanOrEqual(v.width + 1); expect(r.y + r.height).toBeLessThanOrEqual(v.height + 1)
  // Sampled until layout settles after a viewport change (device signals follow media-query events).
  await expect.poll(() => page.getByTestId('sticker-tray').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
}

test('visual matrix: populated collage, selected rotation, tray, preview, pairing and recovery', async ({ page, request, browserName }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const { id } = await stickerBoard(page, request)
  const assetId = crypto.randomUUID(), bytes = await readFile('e2e/fixtures/stickers/0.png')
  for (const size of ['thumb', 'small', 'medium', 'full']) expect((await page.request.put(`/api/assets/${assetId}/${size}`, { headers: { 'content-type': 'image/png' }, data: bytes })).ok()).toBe(true)
  const base = { kind: 'card', boardId: id, w: 260, h: 100, z: 1, color: 'none', createdAt: Date.now() }
  const col = crypto.randomUUID()
  const objects = [
    { ...base, id: crypto.randomUUID(), type: 'note', x: 0, y: 0, color: 'gold', content: { md: '# A very good day\nA walk, a warm drink, and a board full of little things we love.' } },
    { ...base, id: crypto.randomUUID(), type: 'image', x: 280, y: 0, w: 250, h: 250, content: { assetId, width: 256, height: 256, caption: 'Our studio mascot' } },
    { ...base, id: col, type: 'column', x: 50, y: 190, w: 280, h: 230, color: 'lilac', content: { title: 'Little joys' } },
    { ...base, id: crypto.randomUUID(), type: 'note', x: 50, y: 230, columnId: col, order: 1, content: { md: 'Take the scenic route.\n\nBring a friend. Bring snacks.' } },
  ]
  expect((await postSync(page.request, { data: { changes: objects.map((o) => ({ id: o.id, patch: o })) } })).ok()).toBe(true)
  await page.reload(); await expect(page.getByTestId('card')).toHaveCount(4)
  await openStickerTray(page); await capture(page, browserName, 'empty-tray'); await page.getByRole('button', { name: 'Close stickers' }).click()
  await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray')
  await capture(page, browserName, 'pack-collection')
  const pick = (await tray.getByTestId('sticker-pick').first().boundingBox())!, canvas = await canvasBox(page)
  await page.mouse.move(pick.x + pick.width / 2, pick.y + pick.height / 2); await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .45, { steps: 10 })
  await page.screenshot({ path: resolve(`../../docs/qa/stickers/round-${round}/${browserName}-placement-ghost.png`) })
  await page.keyboard.press('Escape'); await page.mouse.up(); await openStickerTray(page)
  const points = [{ x: 210, y: 92 }, { x: 270, y: 140 }, { x: 315, y: 215 }, { x: 220, y: 240 }, { x: 150, y: 165 }]
  for (let i = 0; i < points.length; i++) {
    if (i) await openStickerTray(page)
    await tray.getByTestId('sticker-pick').nth(i).click()
    const c = await camera(page), v = await canvasBox(page)
    await page.mouse.click(v.x + c.tx + points[i].x * c.zoom, v.y + c.ty + points[i].y * c.zoom)
    await adjustSticker(page, 'angle', [-18, 12, 25, -10, 34][i])
  }
  await expect(page.getByTestId('placed-sticker')).toHaveCount(5)
  await waitForSync(page)
  await capture(page, browserName, 'decorated-selected')
  await page.keyboard.press('Escape')
  await capture(page, browserName, 'decorated-board')
  for (const name of ['Light', 'Dark'] as const) {
    await theme(page, name)
    await page.getByTestId('placed-sticker').last().locator('button').focus(); await capture(page, browserName, `${name.toLowerCase()}-selected-ring`); await page.keyboard.press('Escape')
    for (const [width, height] of [[1440, 900], [1024, 768], [720, 720], [600, 720], [390, 844], [360, 740], [768, 1024], [1024, 400]]) {
      await page.setViewportSize({ width, height }); await openStickerTray(page); await inViewport(page)
      await capture(page, browserName, `${name.toLowerCase()}-${width}x${height}-tray`)
      await previewSticker(page); await inViewport(page)
      await capture(page, browserName, `${name.toLowerCase()}-${width}x${height}-preview`)
      await tray.getByTestId('sticker-preview-back').click(); await tray.getByRole('button', { name: 'Close stickers' }).click()
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await theme(page, 'Light'); await openStickerTray(page)
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await capture(page, browserName, 'import-add-pack')
  await tray.getByRole('button', { name: 'Send a sticker in Telegram ↗', exact: true }).click()
  await expect(tray.getByRole('button', { name: 'Connect Telegram bot', exact: true })).toBeEnabled()
  await capture(page, browserName, 'import-connect')
  await tray.getByRole('button', { name: 'Connect Telegram bot', exact: true }).click()
  await expect(tray.getByRole('link', { name: 'Open bot in Telegram ↗', exact: true })).toBeVisible()
  await capture(page, browserName, 'bot-pairing')
  const challenge = new URL(await tray.getByLabel('Telegram bot pairing link').inputValue()).searchParams.get('start')!
  const telegramId = Math.floor(Math.random() * 1e9) + 1e9, updateId = Math.floor(Math.random() * 1e12)
  const sender = { from: { id: telegramId, username: 'fixture_pup' }, chat: { id: telegramId, type: 'private' } }
  const webhook = (message: unknown, offset: number) => page.request.post('/api/telegram/webhook', { headers: { 'x-telegram-bot-api-secret-token': 'e2e-sticker-webhook' }, data: { update_id: updateId + offset, message } })
  expect((await webhook({ ...sender, text: `/start ${challenge}` }, 0)).ok()).toBe(true)
  await expect(tray.getByRole('button', { name: 'Confirm this account', exact: true })).toBeVisible()
  await capture(page, browserName, 'import-confirm-account')
  await page.setViewportSize({ width: 360, height: 740 }); await inViewport(page); await capture(page, browserName, 'import-phone-confirm-account')
  await tray.getByRole('button', { name: 'Confirm this account', exact: true }).click()
  await expect(tray.getByText('Connected: @fixture_pup', { exact: true })).toBeVisible()
  // Doggy daydreams is already in this collection, so only the second pack is suggested.
  expect((await webhook({ ...sender, sticker: { set_name: 'DoggyFixture' } }, 1)).ok()).toBe(true)
  expect((await webhook({ ...sender, sticker: { set_name: 'PuppyParade42x' } }, 2)).ok()).toBe(true)
  await tray.getByRole('button', { name: 'Preview Puppy parade', exact: true }).waitFor()
  await expect(tray.getByRole('button', { name: 'Preview Puppy parade', exact: true })).toBeInViewport()
  await capture(page, browserName, 'import-phone-connected-suggestion')
  await page.setViewportSize({ width: 1440, height: 900 }); await capture(page, browserName, 'import-connected-suggestion')
  // The same pack, one click from the collection, with the Stickers badge.
  await tray.getByRole('button', { name: 'Back to add a pack', exact: true }).click(); await tray.getByRole('button', { name: 'Back to your collection', exact: true }).click()
  await expect(page.getByTestId('sticker-found-badge')).toBeVisible()
  await capture(page, browserName, 'import-found-card')
  await page.setViewportSize({ width: 360, height: 740 }); await inViewport(page); await capture(page, browserName, 'import-phone-found-card')
  await page.setViewportSize({ width: 1440, height: 900 })
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click(); await tray.getByRole('button', { name: 'Send a sticker in Telegram ↗', exact: true }).click()
  await tray.getByRole('button', { name: 'Preview Puppy parade', exact: true }).click()
  await expect(tray.getByRole('heading', { name: 'Puppy parade' })).toBeVisible()
  for (const [width, height] of [[1440, 900], [360, 740], [1024, 400]]) {
    await page.setViewportSize({ width, height }); await inViewport(page)
    const action = tray.getByRole('button', { name: 'Add pack', exact: true })
    await expect(action).toBeInViewport()
    await expect(action).toHaveJSProperty('disabled', false)
    await capture(page, browserName, `import-${width}x${height}-pack-preview`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await tray.getByRole('button', { name: 'Back to Telegram', exact: true }).click()
  await tray.getByRole('button', { name: 'Disconnect Telegram', exact: true }).click()
  await tray.getByRole('button', { name: 'Back to add a pack', exact: true }).click()
  await tray.getByLabel('Pack link or short name').fill('https://example.com/unrelated')
  await tray.getByRole('button', { name: 'Preview pack', exact: true }).click()
  await capture(page, browserName, 'invalid-link')
  await tray.getByLabel('Pack link or short name').fill('DoggyFixture')
  await page.route('**/api/stickers/preview', (route) => route.fulfill({ status: 503, json: { error: 'Telegram is temporarily unavailable. Try again.' } }))
  await tray.getByRole('button', { name: 'Preview pack', exact: true }).click(); await expect(tray.getByRole('alert')).toBeVisible()
  await capture(page, browserName, 'fixture-timeout-error'); await page.unroute('**/api/stickers/preview')
  await page.route('**/api/stickers/preview', async (route) => { const response = await route.fetch(); await new Promise((r) => setTimeout(r, 750)); await route.fulfill({ response }) })
  // A typed link shows its progress on its own button, never as a stray line at the top.
  await tray.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(tray.getByRole('button', { name: 'Opening pack…', exact: true })).toBeDisabled(); await expect(tray.locator('.sticker-status')).toHaveCount(0); await capture(page, browserName, 'loading-preview')
  // Let the delayed response finish before removing its route.
  await expect(tray.getByRole('heading', { name: 'Doggy daydreams' })).toBeVisible(); await page.unroute('**/api/stickers/preview')
  await capture(page, browserName, 'already-added-pack')
  await tray.getByRole('button', { name: 'Open pack', exact: true }).click()
  await tray.getByLabel('Search your stickers').fill('no-matching-sticker')
  await capture(page, browserName, 'empty-search')
  await tray.getByRole('button', { name: 'Close stickers' }).click()
})
