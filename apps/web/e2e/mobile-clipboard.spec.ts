import { expect, test } from '@playwright/test'
import { cardByText, freshBoard } from './helpers.ts'
import { note, seedCards, tapOn } from './touch.ts'

// Phones have no ⌘D: Duplicate sits in the selection bar.

test('Duplicate from the selection bar copies the card beside it', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Walkies at 5', 0, 0)])
  await tapOn(page, cardByText(page, 'Walkies at 5'))
  // Every bar button fits on the screen.
  for (const b of await page.getByTestId('selection-bar').locator('.bar-btn').all()) await expect(b).toBeInViewport({ ratio: 1 })
  await page.getByTestId('duplicate-selection').tap()
  await expect(page.locator('[data-type=note]', { hasText: 'Walkies at 5' })).toHaveCount(2)
  await page.screenshot({ path: test.info().outputPath('bar.png') })
})
