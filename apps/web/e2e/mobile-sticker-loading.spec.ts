import { expect, test, type Route } from '@playwright/test'
import { waitForSync } from './helpers.ts'
import { importFixturePack, openStickerTray, stickerBoard } from './sticker-helpers.ts'

test('on a phone, slow artwork shows a blank sticker with its emoji on the board and in the shelf', async ({ page, request, browser }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  await page.getByTestId('sticker-pick').first().tap(); await page.getByRole('button', { name: 'Place at center', exact: true }).tap()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1); await waitForSync(page)
  // A fresh phone has no rendered outlines yet, so every sticker waits on the network.
  const ctx = await browser.newContext({ ...test.info().project.use, storageState: await page.context().storageState() })
  try {
    const phone = await ctx.newPage(), held: Route[] = []
    let holding = true
    await phone.route('**/api/assets/**', (route) => holding ? void held.push(route) : route.continue())
    await phone.goto(page.url())
    const placed = phone.getByTestId('placed-sticker').locator('.sticker-image')
    await expect(placed.locator('.sticker-blank')).toBeVisible()
    await expect(placed.locator('.sticker-blank')).toHaveText('🐶')
    await openStickerTray(phone)
    const tile = phone.getByTestId('sticker-pick').first().locator('.sticker-image')
    await expect(tile.locator('.sticker-blank')).toBeVisible()
    await phone.screenshot({ path: test.info().outputPath('loading.png') })
    holding = false
    for (const route of held.splice(0)) await route.continue()
    for (const image of [placed, tile]) {
      await expect(image).toHaveAttribute('data-state', 'ready')
      await expect(image.locator('.sticker-blank')).toHaveCount(0)
    }
  } finally { await ctx.close() }
})
