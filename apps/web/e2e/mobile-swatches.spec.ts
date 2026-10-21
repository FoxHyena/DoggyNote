import { expect, test } from '@playwright/test'
import { freshBoard, waitForSync } from './helpers.ts'
import { tapOn } from './touch.ts'

test('add and edit a swatch through the phone tools with durable HEX drafts', async ({ page }) => {
  await freshBoard(page)
  await tapOn(page, page.getByTestId('dock-add'))
  await tapOn(page, page.getByTestId('add-swatch'))
  await expect(page.getByTestId('swatch-hex-input')).toBeFocused()
  await page.getByTestId('swatch-hex-input').fill('#2F5D50')
  await page.getByTestId('swatch-name-input').fill('Forest')
  await page.getByTestId('swatch-caption-input').fill('Primary packaging')
  await tapOn(page, page.getByRole('dialog', { name: 'Edit color' }).getByRole('button', { name: 'Done', exact: true }))
  await expect(page.locator('.card-swatch')).toContainText('Forest')
  await waitForSync(page)
  await page.reload()
  await expect(page.getByTestId('swatch-value')).toHaveText('#2F5D50')
  await tapOn(page, page.getByTestId('edit-swatch'))
  await page.getByTestId('swatch-hex-input').fill('#2')
  await tapOn(page, page.getByRole('dialog', { name: 'Edit color' }).getByRole('button', { name: 'Done', exact: true }))
  await waitForSync(page)
  await page.reload()
  await tapOn(page, page.getByTestId('edit-swatch'))
  await expect(page.getByTestId('swatch-hex-input')).toHaveValue('#2')
  await expect(page.getByTestId('swatch-paint')).toHaveCSS('background-color', 'rgb(47, 93, 80)')
})
