import { expect, test, type Locator } from '@playwright/test'
import { cardByText, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

export function iconChecks() {
  test('board icon choices keep their saved IDs and unknown icons fall back safely', async ({ page }, info) => {
    test.setTimeout(60_000) // Eight persisted choices, each reopened through More on phones.
    await freshBoard(page)
    const parentId = new URL(page.url()).hash.slice(4)
    const boardId = crypto.randomUUID(), cardId = crypto.randomUUID()
    const response = await postSync(page.request, { data: { changes: [
      { id: boardId, patch: { id: boardId, kind: 'board', parentId, title: 'Icon round trip', icon: 'paw', color: 'none', createdAt: Date.now() } },
      { id: cardId, patch: { id: cardId, kind: 'card', type: 'board', boardId: parentId, content: { boardId }, color: 'none', x: 80, y: 80, w: 180, h: 120, z: 1, createdAt: Date.now() } },
    ] } })
    expect(response.ok(), await response.text()).toBe(true)
    await page.reload()
    const press = (el: Locator) => info.project.use.hasTouch ? el.tap() : el.click()
    const tile = cardByText(page, 'Icon round trip')
    const ids = ['paw', 'bone', 'ball', 'collar', 'kennel', 'bowl', 'star', 'heart']
    for (const icon of ids) {
      await press(tile)
      if (info.project.name.startsWith('mobile-')) { await press(page.getByTestId('selection-more')); await press(page.getByTestId('selection-icon')) }
      await expect(page.locator('.icon-picker button')).toHaveCount(8)
      await press(page.getByTestId(`icon-${icon}`))
      await expect(page.getByTestId(`icon-${icon}`)).toHaveAttribute('aria-pressed', 'true')
      await expect(tile.locator('.board-tile svg')).toHaveAttribute('data-icon', icon)
      await waitForSync(page)
      const { objects } = await pullAllObjects(page.request)
      expect(objects.find((o) => o.id === boardId).icon).toBe(icon)
      await page.reload()
      await expect(tile.locator('.board-tile svg')).toHaveAttribute('data-icon', icon)
    }
    const malformed = await postSync(page.request, { data: { changes: [{ id: boardId, patch: { icon: 'toString' } }] } })
    expect(malformed.ok()).toBe(true)
    await page.reload()
    await expect(tile.locator('.board-tile svg')).toHaveAttribute('data-icon', 'paw')
    await expect(tile.locator('.board-tile svg path')).not.toHaveCount(0)
    await expect(page.locator('svg svg')).toHaveCount(0)
  })

  test('theme-aware icons retain their names and geometry offline', async ({ page, context }, info) => {
    await freshBoard(page)
    const press = (el: Locator) => info.project.use.hasTouch ? el.tap() : el.click()
    for (const appearance of ['Light', 'Dark']) {
      await press(page.getByTestId('account'))
      await press(page.getByRole('radio', { name: appearance, exact: true }))
      await page.keyboard.press('Escape')
      const account = page.getByTestId('account')
      await expect(account).toHaveAccessibleName('Account')
      await expect(account.locator('svg')).toHaveAttribute('aria-hidden', 'true')
      await expect(account.locator('svg')).toHaveAttribute('viewBox', '0 0 256 256')
      await expect(account.locator('svg')).toHaveAttribute('data-icon', 'user')
      await expect.poll(() => account.locator('svg').evaluate((el) => getComputedStyle(el.querySelector('path')!).fill === getComputedStyle(el).color)).toBe(true)
      await page.screenshot({ path: info.outputPath(`icons-${appearance.toLowerCase()}.png`) })
    }
    await context.setOffline(true)
    try {
      await press(page.getByTestId('tool-trash'))
      await expect(page.getByTestId('trash-panel')).toBeVisible()
      await expect(page.getByTestId('tool-trash').locator('svg path')).not.toHaveCount(0)
      expect(await page.locator('.trash-empty').evaluate((el) => getComputedStyle(el, '::before').maskImage)).toContain('data:image/svg+xml')
      await expect(page.locator('svg svg')).toHaveCount(0)
    } finally { await context.setOffline(false) }
  })
}
