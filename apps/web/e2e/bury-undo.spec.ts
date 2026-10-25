import { runCardAction } from './helpers.ts'
import { expect, test } from '@playwright/test'
import { MOD, addNote, cardByText, freshBoard } from './helpers.ts'

// Burying is the riskiest thing you can do on the canvas, so every way of doing it
// says what happened and offers Undo, with a mouse and keyboard as much as on touch.

test('the Delete key buries the selection, says so, and Undo brings it back', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'Slipped paw')
  await addNote(page, 'Second slip', 0.3, 0.3)
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.press('Delete')
  await expect(cardByText(page, 'Slipped paw')).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('Buried 2 cards')
  await page.getByTestId('toast-action').click()
  await expect(cardByText(page, 'Slipped paw')).toBeVisible()
  await expect(cardByText(page, 'Second slip')).toBeVisible()
})

test('Bury in the right-click menu shows the same toast', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'Old bone')
  await runCardAction(page, 'Bury')
  await expect(page.getByTestId('toast')).toContainText('Buried 1 card')
  await expect(page.getByTestId('toast-action')).toHaveText('Undo')
  await page.getByTestId('toast-action').click()
  await expect(cardByText(page, 'Old bone')).toBeVisible()
})

/** Count sinking copies as they're added, however quickly they finish. */
async function watchGhosts(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const w = window as unknown as { ghosts: number }
    w.ghosts = 0
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('bury-ghost')) w.ghosts++
    }).observe(document.body, { childList: true })
  })
  return () => page.evaluate(() => (window as unknown as { ghosts: number }).ghosts)
}

test('a buried card sinks into Buried bones, and the copy cleans itself up', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'Sinking bone')
  const ghosts = await watchGhosts(page)
  await runCardAction(page, 'Bury')
  expect(await ghosts()).toBe(1)
  // The copy is decoration: not a card, not announced, gone once it lands.
  await expect(page.locator('.bury-ghost')).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('Buried 1 card')
})

test('with reduced motion, burying just says so', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await freshBoard(page)
  await addNote(page, 'Still bone')
  const ghosts = await watchGhosts(page)
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('toast')).toContainText('Buried 1 card')
  expect(await ghosts()).toBe(0)
})
