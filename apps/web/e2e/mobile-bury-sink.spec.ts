import { expect, test } from '@playwright/test'
import { cardByText, freshBoard } from './helpers.ts'
import { note, seedCards, tapOn } from './touch.ts'

test('on a phone, a buried card sinks into Bones in the dock', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Pocket bone', 0, 0)])
  await page.evaluate(() => {
    const w = window as unknown as { ghosts: number }
    w.ghosts = 0
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('bury-ghost')) w.ghosts++ }).observe(document.body, { childList: true })
  })
  await tapOn(page, cardByText(page, 'Pocket bone'))
  await page.getByTestId('bury').tap()
  expect(await page.evaluate(() => (window as unknown as { ghosts: number }).ghosts)).toBe(1)
  await expect(page.locator('.bury-ghost')).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('Buried 1 card')
})
