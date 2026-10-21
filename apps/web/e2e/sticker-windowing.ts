import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { StickerPack } from '../src/state/stickers.ts'

/** Real membership and placement assets, with 100 distinct image URLs in the UI.
 * Only the test manifest/progress and artwork responses are expanded; the Worker
 * still validates any placement against its real seeded pack. */
export async function hundredStickerPack(page: Page, cold = false) {
  await page.request.post('/api/stickers/preview', { data: { link: 'DoggyFixture' } })
  const added = await page.request.post('/api/stickers/packs/DoggyFixture', { data: {} })
  const source = (await added.json()).pack as StickerPack
  const pack: StickerPack = { ...source, stickers: Array.from({ length: 100 }, (_, i) => ({
    ...source.stickers[i % source.stickers.length],
    assetId: i < source.stickers.length ? source.stickers[i].assetId : crypto.randomUUID(),
    stickerId: i < source.stickers.length ? source.stickers[i].stickerId : `stress_${i}`,
    format: 'static', available: !cold,
  })) }
  const images = Array.from({ length: 12 }, (_, i) => readFileSync(new URL(`./fixtures/stickers/${i}.png`, import.meta.url)))
  const requested = new Set<string>()
  await page.route('**/api/assets/*/thumb*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!, index = pack.stickers.findIndex((s) => s.assetId === id)
    if (index < 0) return route.continue()
    requested.add(id)
    await route.fulfill({ contentType: 'image/png', body: images[index % images.length] })
  })
  await page.route('**/api/stickers', (route) => route.fulfill({ json: { packs: [pack], preferences: [] } }))
  await page.route('**/api/stickers/preview', (route) => route.fulfill({ json: { pack } }))
  await page.route('**/api/stickers/packs/*/load', async (route) => {
    const { offset, count } = route.request().postDataJSON() as { offset: number; count: number }
    await new Promise((resolve) => setTimeout(resolve, 120))
    for (const s of pack.stickers.slice(offset, offset + count)) s.available = true
    await route.fulfill({ json: { pack } })
  })
  return { pack, requested }
}
