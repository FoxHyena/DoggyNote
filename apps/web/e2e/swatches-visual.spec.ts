import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { MOD, freshBoard, waitForSync } from './helpers.ts'

// These are real rendered states for manual visual review, not a claim that
// screenshots alone prove the workflows. Fresh boards keep all content isolated.
for (const theme of ['light', 'dark'] as const) for (const width of [360, 600, 720, 1440]) {
  test(`swatch visual ${theme} ${width}: exact paint, long text, editing and invalid draft`, async ({ page }, info) => {
    await freshBoard(page, `Swatch visual ${theme} ${width} ${crypto.randomUUID().slice(0, 6)}`)
    await page.getByTestId('account').click()
    await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByTestId('tool-swatch').click()
    const hex = ({ 360: '#FFFFFF', 600: '#000000', 720: '#FF00FF', 1440: '#2F5D50' } as Record<number, string>)[width]
    await page.getByTestId('swatch-hex-input').fill(hex)
    await page.getByTestId('swatch-name-input').fill('Forest palette — a long name with an-unbroken-reference-name-to-check-wrapping')
    await page.getByTestId('swatch-caption-input').fill('Primary packaging\nA long caption stays with the exact chosen color. Compare this reference beside photography, type and layout explorations without changing its value when the theme changes.')
    await page.getByRole('dialog', { name: 'Edit color' }).getByRole('button', { name: 'Done', exact: true }).click()
    await page.setViewportSize({ width, height: 800 })
    // Let ResizeObserver consume the new viewport before Fit computes its
    // target, then wait for the camera animation to centre the whole card.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.keyboard.press(`${MOD}+1`)
    await expect.poll(async () => {
      const card = await page.locator('.card-swatch').boundingBox()
      const canvas = await page.getByTestId('canvas').boundingBox()
      return !!card && !!canvas
        && card.x >= canvas.x && card.y >= canvas.y
        && card.x + card.width <= canvas.x + canvas.width
        && card.y + card.height <= canvas.y + canvas.height
        && Math.abs(card.x + card.width / 2 - canvas.x - canvas.width / 2) < 2
        && Math.abs(card.y + card.height / 2 - canvas.y - canvas.height / 2) < 2
    }).toBe(true)
    await expect(page.getByTestId('swatch-paint')).toBeVisible()
    await expect.poll(() => page.locator('.color-card-details').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await waitForSync(page)
    const folder = info.outputPath('visual')
    await mkdir(folder, { recursive: true })
    await page.screenshot({ path: `${folder}/populated.png` })
    await page.getByTestId('edit-swatch').click()
    await expect(page.getByRole('dialog', { name: 'Edit color' })).toBeVisible()
    await page.screenshot({ path: `${folder}/editing.png` })
    await page.getByTestId('swatch-hex-input').fill('#2F')
    await expect(page.getByTestId('swatch-hex-input')).toHaveAttribute('aria-invalid', 'true')
    await page.screenshot({ path: `${folder}/invalid-draft.png` })
    await page.keyboard.press('Escape')
    await waitForSync(page)
    await page.reload()
    await expect(page.getByTestId('swatch-value')).toHaveText(hex)
    await page.getByTestId('edit-swatch').click()
    await expect(page.getByTestId('swatch-hex-input')).toHaveValue('#2F')
  })
}
