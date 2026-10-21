import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { importFixturePack, openStickerTray, stickerBoard } from './sticker-helpers.ts'
import { at, waitForSync } from './helpers.ts'

test('phone landscape pack preview keeps details and Add beside the artwork', async ({ page, request }) => {
  const dir = resolve(`../../docs/qa/stickers/round-${process.env.STICKER_VISUAL_ROUND ?? '1'}`); mkdirSync(dir, { recursive: true })
  await stickerBoard(page, request)
  await page.setViewportSize({ width: 844, height: 390 }); await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().tap()
  await tray.getByLabel('Pack link or short name').fill('https://t.me/addstickers/DoggyFixture')
  await tray.getByRole('button', { name: 'Preview pack', exact: true }).tap()
  await expect(tray.getByRole('heading', { name: 'Doggy daydreams' })).toBeVisible()
  const add = tray.getByRole('button', { name: 'Add pack', exact: true })
  await expect(add).toBeInViewport()
  const summary = (await tray.locator('.sticker-pack-summary').boundingBox())!, grid = (await tray.locator('.sticker-preview-pack > .sticker-scroll').boundingBox())!
  const action = (await add.boundingBox())!, bounds = (await tray.boundingBox())!
  expect(grid.x).toBeGreaterThanOrEqual(summary.x + summary.width - 1)
  expect(action.x + action.width).toBeLessThanOrEqual(grid.x + 1)
  expect(action.y + action.height).toBeLessThanOrEqual(bounds.y + bounds.height)
  expect(action.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: resolve(dir, `${test.info().project.name}-landscape-pack-preview.png`) })
  expect((await (await page.request.get('/api/stickers')).json()).packs).toHaveLength(0)
  await add.tap()
  await expect(tray.locator('.sticker-pack-title')).toContainText('Doggy daydreams')
})

test('a pack sent to the bot badges the phone sticker button and opens in one tap', async ({ page, request }) => {
  await stickerBoard(page, request)
  // Fixture updates target only the isolated test Worker. No bot is messaged.
  const telegramId = Math.floor(Math.random() * 1e9) + 1e9, updateId = Math.floor(Math.random() * 1e12)
  const sender = { from: { id: telegramId, username: 'fixture_phone' }, chat: { id: telegramId, type: 'private' } }
  const webhook = (offset: number, message: object) => page.request.post('/api/telegram/webhook', { headers: { 'x-telegram-bot-api-secret-token': 'e2e-sticker-webhook' }, data: { update_id: updateId + offset, message: { ...sender, ...message } } })
  const { url } = await (await page.request.post('/api/stickers/telegram/challenge', { data: {} })).json()
  await webhook(0, { text: `/start ${new URL(url).searchParams.get('start')}` })
  expect((await page.request.post('/api/stickers/telegram/confirm', { data: { telegramId: String(telegramId) } })).status()).toBe(200)
  await webhook(1, { sticker: { set_name: 'DoggyFixture' } })
  await page.reload()
  const launcher = page.getByTestId('mobile-stickers')
  await expect(launcher.getByTestId('sticker-found-badge')).toBeVisible()
  await launcher.tap()
  // Phones use the bottom sheet, which never pins.
  await expect(page.getByRole('button', { name: 'Keep stickers open', exact: true })).toHaveCount(0)
  const tray = page.getByTestId('sticker-tray'), found = tray.getByRole('list', { name: 'Packs from Telegram' })
  await expect(found).toBeInViewport()
  // The row is never squeezed by the sheet: its whole height shows.
  await expect.poll(() => found.evaluate((list) => list.firstElementChild!.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1)).toBe(true)
  await page.screenshot({ path: resolve(`../../docs/qa/stickers/round-${process.env.STICKER_VISUAL_ROUND ?? '1'}`, `${test.info().project.name}-found-row.png`) })
  const preview = found.getByRole('button', { name: 'Preview Doggy daydreams', exact: true })
  expect((await preview.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await preview.tap()
  await expect(tray.getByRole('heading', { name: 'Doggy daydreams' })).toBeVisible()
  await tray.getByRole('button', { name: 'Add pack', exact: true }).tap()
  await expect(tray.getByTestId('sticker-pick').first()).toBeVisible()
  await expect(found).toHaveCount(0)
  await expect(launcher.getByTestId('sticker-found-badge')).toHaveCount(0)
  expect((await page.request.delete('/api/stickers/telegram')).status()).toBe(200)
})

test('a selected sticker on a phone gets a bottom sheet with labelled icon actions', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray')
  await tray.getByTestId('sticker-pick').first().tap()
  const spot = await at(page, .5, .3); await page.touchscreen.tap(spot.x, spot.y)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  const sheet = page.getByTestId('sticker-controls')
  await expect(sheet).toBeInViewport({ ratio: 1 })
  await expect(sheet).toHaveClass(/sticker-controls-sheet/)
  for (const [name, label] of [['Forward', 'Forward'], ['Backward', 'Back'], ['Select underneath', 'Under'], ['View pack', 'Pack'], ['Duplicate', 'Duplicate'], ['Bury', 'Bury']]) {
    const button = sheet.getByRole('button', { name, exact: true })
    await expect(button).toContainText(label)
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    // Labels fit their buttons; none run into the next.
    expect(await button.locator('.sticker-bar-label').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  }
  await expect(sheet.getByRole('slider')).toHaveCount(0)
  // The sticker launcher stays reachable above the sheet.
  const launcher = (await page.getByTestId('mobile-stickers').boundingBox())!, box = (await sheet.boundingBox())!
  expect(launcher.y + launcher.height).toBeLessThanOrEqual(box.y + 1)
  await page.screenshot({ path: resolve(`../../docs/qa/stickers/round-${process.env.STICKER_VISUAL_ROUND ?? '1'}`, `${test.info().project.name}-sticker-sheet.png`) })
  await waitForSync(page)
})
