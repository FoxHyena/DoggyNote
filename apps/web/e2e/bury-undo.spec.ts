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

test('Bury in the selection bar shows the same toast', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'Old bone')
  await page.getByTestId('bury').click()
  await expect(page.getByTestId('toast')).toContainText('Buried 1 card')
  await expect(page.getByTestId('toast-action')).toHaveText('Undo')
  await page.getByTestId('toast-action').click()
  await expect(cardByText(page, 'Old bone')).toBeVisible()
})
