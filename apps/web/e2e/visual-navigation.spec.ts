import { expect, test, type Locator, type Page } from '@playwright/test'
import { freshBoard, postSync, waitForSync } from './helpers.ts'

const widths = [1440, 1024, 720, 600, 360]
const title = 'A long shared board title for planning walks, meals, and the next excellent dog adventure'

async function setAppearance(page: Page, appearance: 'Light' | 'Dark') {
  await page.getByTestId('account').click()
  await page.getByRole('radio', { name: appearance, exact: true }).click()
  await page.keyboard.press('Escape')
}

async function contained(locator: Locator, width: number, height: number) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(height)
}

async function x(locator: Locator) {
  return (await locator.boundingBox())!.x
}

test('Boards empty descriptions align with labels in both appearances and short viewports', async ({ page }, info) => {
  await freshBoard(page)
  // Isolate the empty shared-board state from concurrent tests sharing the fixture account.
  await page.route('**/api/access', async (route) => {
    const response = await route.fetch()
    const access = await response.json()
    await route.fulfill({ json: { ...access, legacyShared: true, boards: access.boards.map((board: { ownerId: string | null }) => ({ ...board, legacy: true })) } })
  })
  await page.reload()
  await waitForSync(page)
  for (const appearance of ['Light', 'Dark'] as const) {
    await setAppearance(page, appearance)
    for (const width of widths) {
      await page.setViewportSize({ width, height: 480 })
      await page.getByTestId('board-navigation').click()
      const menu = page.getByTestId('board-navigation-menu')
      await contained(menu, width, 480)
      const personal = page.getByTestId('personal-home')
      const labelX = await x(personal.locator('.nav-menu-label'))
      expect(await x(personal.locator('svg'))).toBeLessThan(labelX)
      for (const supporting of [menu.locator('.nav-menu-description').first(), menu.locator('.nav-menu-description').last(), menu.locator('.nav-menu-section-label')]) {
        expect(Math.abs(await x(supporting) + await supporting.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)) - labelX)).toBeLessThanOrEqual(1)
      }
      const row = await personal.boundingBox()
      expect(row!.height).toBeGreaterThanOrEqual(36)
      await page.mouse.move(width - 1, 479)
      await menu.screenshot({ path: info.outputPath(`boards-empty-${appearance.toLowerCase()}-${width}.png`) })
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('board-navigation')).toBeFocused()
    }
  }
})

test('Boards long shared names keep permissions separate and scroll below a visible header', async ({ page }, info) => {
  await freshBoard(page)
  const ids = Array.from({ length: 18 }, () => crypto.randomUUID())
  const response = await postSync(page.request, { data: { changes: ids.map((id, i) => ({ id, patch: { id, kind: 'board', parentId: 'home', title: `${title} ${i + 1}`, icon: 'paw', color: 'none', createdAt: Date.now() } })) } })
  expect(response.ok()).toBe(true)
  await page.route('**/api/access', async (route) => {
    const response = await route.fetch()
    const access = await response.json()
    await route.fulfill({ json: { ...access, legacyShared: true, boards: [
      ...access.boards.filter((board: { id: string }) => !ids.includes(board.id)).map((board: object) => ({ ...board, legacy: true })),
      ...ids.map((id, i) => ({ id, parentId: null, ownerId: 'visual-fixture-owner', legacy: false, canEdit: i % 2 === 0, canManage: false })),
    ] } })
  })
  await page.reload()
  await waitForSync(page)
  for (const appearance of ['Light', 'Dark'] as const) {
    await setAppearance(page, appearance)
    for (const width of widths) {
      await page.setViewportSize({ width, height: 480 })
      await page.getByTestId('board-navigation').click()
      const menu = page.getByTestId('board-navigation-menu')
      await contained(menu, width, 480)
      await expect(page.getByTestId('shared-board-link')).toHaveCount(18)
      const first = page.getByTestId('shared-board-link').first()
      const label = await first.locator('.nav-menu-label').boundingBox()
      const permission = await first.locator('.nav-menu-meta').boundingBox()
      expect(label!.x + label!.width + 7).toBeLessThanOrEqual(permission!.x)
      expect(Math.abs(await x(first.locator('.nav-menu-label')) - await x(page.getByTestId('personal-home').locator('.nav-menu-label')))).toBeLessThanOrEqual(1)
      await page.mouse.move(width - 1, 479)
      await menu.screenshot({ path: info.outputPath(`boards-populated-${appearance.toLowerCase()}-${width}.png`) })
      const headBefore = await menu.locator('.nav-menu-head').boundingBox()
      await page.keyboard.press('End')
      await expect(page.getByTestId('shared-board-link').last()).toBeFocused()
      await expect.poll(() => page.getByTestId('board-navigation-list').evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      const headAfter = await menu.locator('.nav-menu-head').boundingBox()
      expect(headAfter!.y).toBe(headBefore!.y)
      await expect(menu.getByRole('button', { name: 'Close boards' })).toBeInViewport()
      await contained(page.getByTestId('shared-board-link').last(), width, 480)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('board-navigation')).toBeFocused()
    }
  }
})
