import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { boardOf, note, seedCards } from './touch.ts'

// On a phone the board "…" menu is a sheet with finger-sized rows, and the
// template picker fits the screen with 44px rows.

test('board menu copy actions and the template picker are reachable by touch', async ({ page }) => {
  const name = await freshBoard(page, `Pocket ${Math.random().toString(36).slice(2, 6)}`)
  await seedCards(page, [note('Treats list', 0, 0)])
  const vp = page.viewportSize()!

  await page.getByTestId('board-more').tap()
  const sheet = page.getByTestId('board-actions-menu')
  await expect(sheet).toBeVisible()
  // The sheet slides up; measure where it settles.
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  for (const id of ['duplicate-board', 'save-template', 'open-templates', 'export', 'agent-proposals']) {
    const b = (await sheet.getByTestId(id).boundingBox())!
    expect(b.height, id).toBeGreaterThanOrEqual(44)
    expect(b.y + b.height, id).toBeLessThanOrEqual(vp.height)
    // One line per item.
    expect(b.height, id).toBeLessThan(60)
  }
  await sheet.getByTestId('save-template').tap()
  await expect(page.getByTestId('toast')).toContainText('template')

  await page.getByTestId('board-more').tap()
  await page.getByTestId('open-templates').tap()
  const picker = page.getByTestId('templates-popover')
  await expect(picker).toBeVisible()
  // A bottom sheet, like the other phone menus.
  await picker.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const box = (await picker.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
  const row = picker.locator(`[data-testid="template-row"][data-name="${name}"]`)
  for (const id of ['template-use', 'template-remove']) {
    const b = (await row.getByTestId(id).boundingBox())!
    expect(b.height, id).toBeGreaterThanOrEqual(44)
    expect(b.width, id).toBeGreaterThanOrEqual(44)
  }
  const source = boardOf(page)
  await row.getByTestId('template-use').tap()
  await expect(page.getByTestId('board-name')).toHaveText(name)
  expect(boardOf(page)).not.toBe(source)
  await expect(page.getByTestId('card').filter({ hasText: 'Treats list' })).toBeVisible()
})
