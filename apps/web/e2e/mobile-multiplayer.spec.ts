import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'

test('people and pings are reachable by touch without crowding the phone header', async ({ page }) => {
  await freshBoard(page, 'A board with a deliberately long shared project title')
  const trigger = page.getByTestId('collaborators'), box = (await trigger.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44)
  await trigger.tap()
  await expect(page.getByTestId('live-status')).toHaveText('Live')
  const menu = page.locator('.people-menu'), bounds = (await menu.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  await page.getByRole('button', { name: 'Look here', exact: true }).tap()
  await expect(page.getByTestId('remote-ping')).toBeVisible()
  await expect(page.getByTestId('remote-ping')).toHaveCount(0, { timeout: 5000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
