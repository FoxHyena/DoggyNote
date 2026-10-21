import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { addImage } from './image-metadata.helpers.ts'
import { freshBoard, MOD } from './helpers.ts'
import { resolve } from 'node:path'
import { installImageMetadataFailureDiagnostics } from './image-metadata-failure-diagnostics.ts'

installImageMetadataFailureDiagnostics()

async function settleCamera(page: Page) {
  await expect.poll(async () => {
    const before = await page.getByTestId('world').getAttribute('style')
    await page.waitForTimeout(120)
    return before === await page.getByTestId('world').getAttribute('style')
  }).toBe(true)
}

async function shot(page: Page, info: TestInfo, name: string) {
  const round = process.env.IMAGE_QA_ROUND
  const file = round ? resolve(`../../docs/qa/image-metadata/${round}-${info.project.name}-${name}.png`) : info.outputPath(`${name}.png`)
  await page.screenshot({ path: file, animations: 'disabled' })
}

for (const theme of ['Light', 'Dark'] as const) {
  test(`image metadata remains readable at four widths in ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await freshBoard(page, `Image research • ${theme} • ${process.env.IMAGE_QA_ROUND ?? 'responsive check'}`)
    await page.getByTestId('account').click()
    await page.getByRole('radio', { name: theme, exact: true }).click()
    await page.keyboard.press('Escape')
    await addImage(page)
    await page.getByTestId('image-caption-input').fill('Warm side lighting; use for the opening scene.\nKeep the gold edge as a guide for the sunrise transition.\nA longer observation stays attached to this reference as it moves or changes size.\nFinal line: preserve the opening-scene context.')
    await page.getByTestId('image-source-input').fill('https://a-very-long-original-research-source-host.example.com/original/lighting-reference')
    await page.getByTestId('image-metadata-done').click()
    for (const width of [1440, 720, 600, 360]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 480 })
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
      await page.keyboard.press(`${MOD}+1`)
      await settleCamera(page)
      const cardBounds = (await page.locator('.card-image').boundingBox())!
      expect(cardBounds.x).toBeGreaterThanOrEqual(0)
      expect(cardBounds.x + cardBounds.width).toBeLessThanOrEqual(width)
      await expect(page.getByTestId('image-caption')).toBeVisible()
      await shot(page, info, `${theme.toLowerCase()}-${width}-compact`)
      await page.getByRole('button', { name: 'Read full caption' }).click()
      // ResizeObserver publishes the expanded local height on the next frame.
      // Fit must read that height rather than the compact measurement.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await page.keyboard.press(`${MOD}+1`)
      await settleCamera(page)
      const expandedBounds = (await page.locator('.card-image').boundingBox())!
      expect(expandedBounds.y).toBeGreaterThanOrEqual(0)
      expect(expandedBounds.y + expandedBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      await shot(page, info, `${theme.toLowerCase()}-${width}-expanded`)
      await page.getByRole('button', { name: 'Edit image caption and source' }).click()
      const dialog = page.getByRole('dialog', { name: 'Image caption and source', exact: true })
      await expect(dialog).toBeVisible()
      const bounds = (await dialog.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await expect(page.getByTestId('image-caption-input')).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(page.getByTestId('image-metadata-done')).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.getByTestId('image-caption-input')).toBeFocused()
      await shot(page, info, `${theme.toLowerCase()}-${width}-editor`)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await page.getByRole('button', { name: 'Show less' }).click()
    }
    // Real populated flow crops for the public task guide, captured directly
    // from the UI rather than reconstructed from component previews.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.keyboard.press(`${MOD}+1`)
    await settleCamera(page)
    await page.getByRole('button', { name: 'Edit image caption and source' }).click()
    await page.getByTestId('image-caption-input').fill('Warm side lighting; use for the opening scene.')
    await page.getByTestId('image-source-input').fill('https://example.com/original-reference')
    await page.getByTestId('image-metadata-done').click()
    await page.keyboard.press(`${MOD}+1`)
    await settleCamera(page)
    const card = (await page.locator('.card-image').boundingBox())!
    const bar = (await page.getByTestId('selection-bar').boundingBox())!
    const x = Math.floor(Math.min(card.x, bar.x) - 16), y = Math.floor(Math.min(card.y, bar.y) - 16)
    const right = Math.ceil(Math.max(card.x + card.width, bar.x + bar.width) + 16)
    const bottom = Math.ceil(Math.max(card.y + card.height, bar.y + bar.height) + 16)
    const round = process.env.IMAGE_QA_ROUND
    const output = (name: string) => round ? resolve(`../../docs/qa/image-metadata/${round}-${info.project.name}-${theme.toLowerCase()}-${name}.png`) : info.outputPath(`${name}.png`)
    await page.screenshot({ path: output('guide-result'), clip: { x, y, width: right - x, height: bottom - y }, animations: 'disabled' })
    await page.getByRole('button', { name: 'Edit image caption and source' }).click()
    await page.getByTestId('image-source-input').fill('example.com/no-protocol')
    await expect(page.getByTestId('image-source-input')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert')).toContainText('Invalid changes are not saved')
    const dialog = (await page.getByRole('dialog', { name: 'Image caption and source', exact: true }).boundingBox())!
    await page.screenshot({ path: output('guide-invalid-source'), clip: { x: dialog.x - 12, y: dialog.y - 12, width: dialog.width + 24, height: dialog.height + 24 }, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('image-source')).toHaveAttribute('href', 'https://example.com/original-reference')
  })
}
