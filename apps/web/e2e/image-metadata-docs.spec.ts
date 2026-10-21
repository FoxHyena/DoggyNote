import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test.use({ storageState: { cookies: [], origins: [] } })

if (!process.env.IMAGE_DOCS_PREVIEW) {
  test('unpublished image guide is absent from public routes and navigation', async ({ page }) => {
    await page.goto('/docs/image-captions-and-sources')
    await expect(page.getByRole('heading', { name: 'Let’s find your way back.', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Caption images and keep their sources', exact: true })).toHaveCount(0)
  })
} else {
  // Registered only by the reversible preview runner; no skipped tests are
  // counted as rendered guide evidence in ordinary draft builds.
  test('actual image guide template shows its flow and real figures anonymously', async ({ page }, info) => {
    const api: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url())
    })
    await page.goto('/docs')
    await page.getByRole('searchbox', { name: 'Find a guide' }).fill('Caption images')
    await page.locator('.docs-guide-card').getByRole('heading', { name: 'Caption images and keep their sources', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('Caption images and keep their sources')
    await expect(page.locator('.docs-flow ol li')).toHaveCount(3)
    const figures = page.locator('.docs-article figure img')
    await expect(figures).toHaveCount(2)
    for (const figure of await figures.all()) {
      await figure.scrollIntoViewIfNeeded()
      await expect.poll(() => figure.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
    }
    for (const mode of ['light', 'dark']) for (const width of [360, 600, 720, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole('combobox', { name: 'Appearance' }).selectOption(mode)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const figure of await figures.all()) {
        const bounds = (await figure.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      }
      if (process.env.IMAGE_QA_ROUND) await page.screenshot({
        path: resolve(`../../docs/qa/image-metadata/${process.env.IMAGE_QA_ROUND}-${info.project.name}-guide-${width}-${mode}.png`), fullPage: true,
      })
    }
    await page.locator('.docs-toc:visible').getByRole('link', { name: 'Add a caption and source', exact: true }).click()
    await expect(page).toHaveURL(/#add-caption-and-source$/)
    await page.reload()
    await expect(page.locator('#add-caption-and-source')).toBeInViewport()
    await expect(page.locator('.stage, .canvas, [data-testid="login-form"]')).toHaveCount(0)
    expect(api).toEqual([])
  })
}
