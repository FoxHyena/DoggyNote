import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openStickerTray, pairFixtureTelegram, stickerBoard } from './sticker-helpers.ts'

/** Serves previews as unprepared and prepares each requested step after a delay, so progress is observable. */
async function slowPreparation(page: Page, delays: Record<string, number>) {
  let active = 0, peak = 0
  const packs = new Map<string, { stickers: { available: boolean }[] }>()
  await page.route('**/api/stickers/preview', async (route) => {
    const response = await route.fetch(), data = await response.json()
    const pack = { ...data.pack, stickers: data.pack.stickers.map((s: object) => ({ ...s, available: false })) }
    packs.set(pack.name.toLowerCase(), pack)
    await route.fulfill({ response, json: { ...data, pack } })
  })
  await page.route('**/api/stickers/packs/*/load', async (route) => {
    active++; peak = Math.max(peak, active)
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)!).toLowerCase()
    const { offset, count } = route.request().postDataJSON() as { offset: number; count: number }
    await new Promise((r) => setTimeout(r, delays[name] ?? 50))
    const pack = packs.get(name)!
    pack.stickers = pack.stickers.map((s, i) => i >= offset && i < offset + count ? { ...s, available: true } : s)
    active--
    await route.fulfill({ json: { pack } })
  })
  return () => peak
}

test('several sent packs list together by title, prepare in the background and preview while preparing', async ({ page, request }) => {
  await stickerBoard(page, request)
  const telegram = await pairFixtureTelegram(page)
  await telegram.sendSticker('DoggyFixture'); await telegram.sendSticker('PuppyParade42x')
  const peak = await slowPreparation(page, { doggyfixture: 1500, puppyparade42x: 2500 })
  await page.reload()
  await expect(page.getByTestId('sticker-found-badge')).toBeVisible()
  await expect(page.getByTestId('tool-stickers')).toHaveAttribute('title', '2 packs found in Telegram')
  await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray'), list = tray.getByRole('list', { name: 'Packs from Telegram' })
  // Newest first, each by its real title from the start; the second pack never replaces the first.
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list.getByRole('listitem').nth(0)).toContainText('Puppy parade')
  await expect(list.getByRole('listitem').nth(1)).toContainText('Doggy daydreams')
  await expect(list).not.toContainText('PuppyParade42x')
  // Add stays off until a sticker is ready; both prepare on their own, with a progress ring and count.
  await expect(list.getByRole('button', { name: 'Add Puppy parade', exact: true })).toBeDisabled()
  await expect(list.getByRole('img', { name: /^\d+ of 12 stickers ready$/ })).toBeVisible()
  await expect(list.getByRole('listitem').nth(1)).toContainText(/From Telegram · \d+ of 12/)
  await page.screenshot({ path: resolve(`../../docs/qa/stickers/round-${process.env.STICKER_VISUAL_ROUND ?? '1'}`, `${test.info().project.name}-suggestions-preparing.png`) })
  // Preview opens while preparing, and leaving never locks Preview.
  await list.getByRole('button', { name: 'Preview Doggy daydreams', exact: true }).click()
  await expect(tray.getByRole('heading', { name: 'Doggy daydreams' })).toBeVisible()
  // Opening a pack the app already started never flashes a loading line at the top.
  await expect(tray.locator('.sticker-status, .sticker-pack-opening')).toHaveCount(0)
  await expect(tray.getByRole('status')).toContainText(/Preparing stickers · \d+ of 12 ready/)
  await tray.getByRole('button', { name: 'Back to your collection', exact: true }).click()
  await expect(list.getByRole('button', { name: 'Preview Doggy daydreams', exact: true })).toBeEnabled()
  await expect(list.getByRole('button', { name: 'Preview Puppy parade', exact: true })).toBeEnabled()
  // No progress line pushes the collection around while packs prepare.
  await expect(tray.locator('.sticker-status')).toHaveCount(0)
  await expect(list.getByRole('listitem').nth(1).locator('small')).toHaveText('From Telegram', { timeout: 15_000 })
  await expect(list.getByRole('img', { name: 'Doggy daydreams cover' })).toBeVisible()
  // The Add pack screen lists them too.
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await expect(tray.getByRole('list', { name: 'Packs from Telegram' }).getByRole('listitem')).toHaveCount(2)
  await tray.getByRole('button', { name: 'Preview Doggy daydreams', exact: true }).click()
  await expect(tray.getByText('12 stickers · 12 ready', { exact: true })).toBeVisible()
  await tray.getByRole('button', { name: 'Add pack', exact: true }).click()
  await expect(tray.locator('.sticker-pack-title')).toContainText('Doggy daydreams')
  // Adding one answers only that suggestion.
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByTestId('tool-stickers')).toHaveAttribute('title', 'Pack found in Telegram')
  const tile = tray.getByTestId('sticker-pick').first(), width = (await tile.boundingBox())!.width
  await expect(list.getByRole('listitem').locator('small')).toHaveText('From Telegram', { timeout: 15_000 })
  expect((await tile.boundingBox())!.width).toBe(width)
  // The row's plus adds the pack straight from the list and shows it.
  await list.getByRole('button', { name: 'Add Puppy parade', exact: true }).click()
  await expect(page.getByText('Puppy parade added to your stickers.')).toBeVisible()
  await expect(list).toHaveCount(0)
  await expect(tray.locator('.sticker-pack-title')).toContainText('Puppy parade')
  await expect(tray.getByRole('button', { name: 'Puppy parade', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect((await (await page.request.get('/api/stickers')).json()).packs.map((p: { name: string }) => p.name)).toEqual(['DoggyFixture', 'PuppyParade42x'])
  await expect(page.getByTestId('sticker-found-badge')).toHaveCount(0)
  expect((await (await page.request.get('/api/stickers/telegram')).json()).suggestions).toEqual([])
  expect(peak()).toBe(2)
  expect((await page.request.delete('/api/stickers/telegram')).status()).toBe(200)
})
