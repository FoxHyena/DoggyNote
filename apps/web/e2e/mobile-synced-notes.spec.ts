import { expect, test } from '@playwright/test'
import { cardByText, freshBoard } from './helpers.ts'
import { note, seedCards, selectionMore, tapOn } from './touch.ts'

// On a phone a synced copy is made from the selection's More menu, and the
// marker opens the copies list as a sheet with finger-sized rows.

test('make a synced copy from More, see both copies, then unsync one by touch', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Groomer at 4', 0, 260)])
  await tapOn(page, cardByText(page, 'Groomer at 4'))
  await selectionMore(page)
  await page.getByTestId('selection-more-menu').getByTestId('make-synced-copy').tap()
  const copies = page.locator('[data-testid="card"]', { hasText: 'Groomer at 4' })
  await expect(copies).toHaveCount(2)
  await expect(copies.getByTestId('synced-marker')).toHaveCount(2)

  await page.getByTestId('selection-done').tap()
  const marker = copies.first().getByTestId('synced-marker')
  // The small chip has a fingertip-sized target around it.
  const hit = await marker.evaluate((el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el, '::before'); return { w: r.width - 2 * parseFloat(s.left), h: r.height - 2 * parseFloat(s.top) } })
  expect(hit.w).toBeGreaterThanOrEqual(44)
  expect(hit.h).toBeGreaterThanOrEqual(44)
  await marker.tap()
  const sheet = page.getByTestId('synced-menu')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('synced-copy')).toHaveCount(2)
  const vp = page.viewportSize()!
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  for (const row of [...await sheet.getByTestId('synced-copy').all(), sheet.getByTestId('make-independent')]) {
    const b = (await row.boundingBox())!
    expect(b.height).toBeGreaterThanOrEqual(44)
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height)
  }
  await sheet.getByTestId('make-independent').tap()
  await expect(page.getByTestId('synced-marker')).toHaveCount(0)
  await expect(copies).toHaveCount(2)
})
