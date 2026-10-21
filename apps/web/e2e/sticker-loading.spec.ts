import { expect, test } from '@playwright/test'
import { openStickerTray, stickerBoard } from './sticker-helpers.ts'

test('two chunks load concurrently and older responses cannot erase ready stickers', async ({ page, request }) => {
  await stickerBoard(page, request); await openStickerTray(page)
  let pack: { stickers: { available: boolean }[] }, active = 0, peak = 0
  await page.route('**/api/stickers/preview', async (route) => {
    const response = await route.fetch(), data = await response.json(); pack = data.pack
    await route.fulfill({ response, json: { ...data, pack: { ...pack, stickers: pack.stickers.map((s) => ({ ...s, available: false })) } } })
  })
  await page.route('**/api/stickers/packs/*/load', async (route) => {
    const { offset, count } = route.request().postDataJSON() as { offset: number; count: number }
    // Steps of three so artwork arrives steadily.
    expect(count).toBe(3)
    active++; peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, offset === 0 ? 250 : 50))
    active--
    await route.fulfill({ json: { pack: { ...pack, stickers: pack.stickers.map((s, i) => ({ ...s, available: i >= offset && i < offset + count })) } } })
  })
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByLabel('Pack link or short name').fill('DoggyFixture'); await tray.getByRole('button', { name: 'Preview pack', exact: true }).click()
  await expect(tray.getByText('12 stickers · 12 ready', { exact: true })).toBeVisible()
  expect(peak).toBe(2)
  await expect(tray.getByTestId('sticker-pick')).toHaveCount(12)
  await expect(tray.getByTestId('sticker-pick').locator('img')).toHaveCount(12)
  await tray.getByRole('button', { name: 'Add pack', exact: true }).click()
  await expect(tray.locator('.sticker-pack-title')).toContainText('Doggy daydreams')
  expect((await (await page.request.get('/api/stickers')).json()).packs).toHaveLength(1)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
})

test('rate limiting stops queued chunks and shows a bounded retry countdown', async ({ page, request }) => {
  await stickerBoard(page, request); await openStickerTray(page)
  let pack: { stickers: { available: boolean }[] }
  const offsets: number[] = []
  await page.route('**/api/stickers/preview', async (route) => {
    const response = await route.fetch(), data = await response.json(); pack = data.pack
    await route.fulfill({ response, json: { ...data, pack: { ...pack, stickers: [...pack.stickers, ...pack.stickers].map((s) => ({ ...s, available: false })) } } })
  })
  await page.route('**/api/stickers/packs/*/load', async (route) => {
    const offset = route.request().postDataJSON().offset as number; offsets.push(offset)
    if (offset === 0) await route.fulfill({ status: 429, headers: { 'retry-after': '30' }, json: { error: 'Telegram is busy. Please wait before retrying.', retryAfter: 30 } })
    else { await new Promise((r) => setTimeout(r, 100)); await route.fulfill({ json: { pack: { ...pack, stickers: [...pack.stickers, ...pack.stickers].map((s) => ({ ...s, available: false })) } } }) }
  })
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByLabel('Pack link or short name').fill('DoggyFixture'); await tray.getByRole('button', { name: 'Preview pack', exact: true }).click()
  await expect(tray.getByRole('alert')).toContainText('Telegram is busy')
  await expect(tray.getByRole('button', { name: /Retry in \d+s/ })).toBeDisabled()
  expect(offsets.sort((a, b) => a - b)).toEqual([0, 3])
  await expect(tray.getByRole('button', { name: 'Retry unavailable stickers', exact: true })).toBeDisabled()
  await expect(tray.getByRole('button', { name: 'Add pack', exact: true })).toBeDisabled()
  expect((await (await page.request.get('/api/stickers')).json()).packs).toHaveLength(0)
})
