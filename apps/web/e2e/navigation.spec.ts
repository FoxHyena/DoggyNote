import { expect, test } from '@playwright/test'
import { freshBoard, postSync, waitForSync, addNote } from './helpers.ts'

const longTitle = 'A long board title for planning the next excellent dog adventure'

test('compact navigation stays usable across themes, narrow windows and long ancestry', async ({ page }, info) => {
  await freshBoard(page, longTitle)
  const child = page.url().split('/').at(-1)!
  const parents = [crypto.randomUUID(), crypto.randomUUID()]
  await postSync(page.request, { data: { changes: [
    { id: parents[0], patch: { id: parents[0], kind: 'board', parentId: 'home', title: 'An especially long project ancestor', icon: 'paw', color: 'none', createdAt: Date.now() } },
    { id: parents[1], patch: { id: parents[1], kind: 'board', parentId: parents[0], title: 'Another very long ancestor', icon: 'paw', color: 'none', createdAt: Date.now() } },
    { id: child, patch: { parentId: parents[1] } },
  ] } })
  await page.reload()
  await waitForSync(page)
  for (const mode of ['Light', 'Dark']) {
    await page.getByTestId('account').click()
    await page.getByRole('radio', { name: mode, exact: true }).click()
    await page.keyboard.press('Escape')
    for (const width of [1440, 720, 600, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate((native) => document.documentElement.classList.toggle('tauri', native), width === 720)
      await expect(page.getByTestId('board-name')).toBeVisible()
      await expect(page.getByTestId('toybox-button')).toContainText('Inbox')
      for (const id of ['board-navigation', 'board-name', 'sync-status', 'open-fetch', 'toybox-button', 'share', 'board-more', 'account', 'canvas-controls']) {
        const bounds = await page.getByTestId(id).boundingBox()
        expect(bounds, `${id} exists at ${width}`).not.toBeNull()
        expect(bounds!.x, `${id} left at ${width}`).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width, `${id} right at ${width}`).toBeLessThanOrEqual(width + 1)
      }
      await page.getByTestId('parent-boards').click()
      await expect(page.getByRole('button', { name: 'Another very long ancestor', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('parent-boards')).toBeFocused()
      await page.getByTestId('board-more').click()
      await expect(page.getByTestId('agent-proposals')).toBeVisible()
      await page.getByTestId('export').click()
      const panel = await page.getByTestId('export-panel').boundingBox()
      expect(panel!.x).toBeGreaterThanOrEqual(0)
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(width + 1)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('board-more')).toBeFocused()
      await page.mouse.move(width - 1, 880)
      await page.screenshot({ path: info.outputPath(`navigation-${mode.toLowerCase()}-${width}.png`) })
    }
  }
})

test('canvas commands, menu dismissal and icon tooltips keep selected cards safe', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'Keep this note while using menus')
  await expect(page.getByTestId('undo')).toBeEnabled()
  await page.getByTestId('snap-toggle').click()
  await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('zoom').click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.getByTestId('zoom')).toHaveText('125%')
  await page.keyboard.press('Tab')
  await page.getByTestId('board-more').focus()
  await expect.poll(() => page.getByTestId('board-more').evaluate((el) => getComputedStyle(el, '::after').visibility)).toBe('visible')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('agent-proposals')).toBeFocused()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('board-more')).toBeFocused()
  await expect(page.getByTestId('card').filter({ hasText: 'Keep this note' })).toBeVisible()
  await expect(page.getByTestId('note-editor')).toHaveCount(0)
  await page.getByTestId('sync-status').click()
  await expect(page.getByTestId('sync-details')).toBeVisible()
  await page.getByTestId('sync-now').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sync-status')).toBeFocused()
  await expect(page.getByTestId('card').filter({ hasText: 'Keep this note' })).toHaveClass(/selected/)
  await page.getByTestId('board-navigation').click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('board-navigation')).toBeFocused()
})

test('legacy private Inbox titles display consistently without rewriting data', async ({ page }) => {
  await freshBoard(page)
  const { user } = await (await page.request.get('/api/me')).json()
  const id = `toybox:${user.id}`
  await postSync(page.request, { data: { changes: [{ id, patch: { id, kind: 'board', parentId: null, title: 'Toy box', icon: 'ball', color: 'gold', createdAt: Date.now() } }] } })
  await page.goto(`/#/b/${id}`)
  await page.reload()
  await expect(page.getByTestId('board-name')).toHaveText('Inbox')
  await page.getByTestId('open-fetch').click()
  await page.getByTestId('fetch-input').fill('Inbox')
  await expect(page.getByTestId('fetch-hit').filter({ hasText: 'Inbox' }).first()).toBeVisible()
})

test('pending proposals move from Review to a More count and preserve a single dialog', async ({ page }) => {
  await page.route('**/api/agent-proposals?*', (route) => route.fulfill({ json: { proposals: [{ id: 'qa-proposal', label: 'Organize the dog walk', status: 'pending', count: 2, createdAt: Date.now() }] } }))
  await freshBoard(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByTestId('review-changes')).toHaveText('Review changes · 1')
  await page.getByTestId('review-changes').click()
  await expect(page.getByTestId('agent-review')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 600, height: 900 })
  await expect(page.getByTestId('review-changes')).toBeHidden()
  await expect(page.getByTestId('board-more')).toContainText('1')
  await page.getByTestId('board-more').click()
  await expect(page.getByTestId('board-actions-menu').getByRole('menuitem').first()).toContainText('Agent proposals · 1')
  await page.getByTestId('agent-proposals').click()
  await expect(page.getByTestId('agent-review')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('board-more')).toBeFocused()
})
