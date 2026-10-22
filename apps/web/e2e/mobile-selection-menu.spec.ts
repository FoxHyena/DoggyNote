import { expect, test } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { center, longPress, note, seedCards, selectionBarFits, tapOn } from './touch.ts'

test('phone selections keep docked actions and long-press lifting without a mouse menu', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Neighbour idea', 0, 0), note('Phone selection', 0, 110)])
  const card = page.getByTestId('card').filter({ hasText: 'Phone selection' })
  await longPress(page, await center(card))
  await expect(card).toHaveClass(/selected/)
  const bar = page.getByTestId('selection-bar')
  await expect(bar).toHaveClass(/docked/)
  await selectionBarFits(page)
  await expect(page.getByTestId('canvas-context-menu')).toHaveCount(0)
  await tapOn(page, page.getByTestId('labels-button'))
  await expect(page.getByTestId('labels-popover')).toBeVisible()
  await page.getByTestId('labels-input').fill('Phone label')
  await page.getByTestId('label-create').tap()
  await expect(card.getByTestId('card-labels')).toHaveText('Phone label')
})
