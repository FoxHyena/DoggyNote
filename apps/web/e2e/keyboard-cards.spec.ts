import { expect, test, type Page } from '@playwright/test'
import { addNote, cardByText, freshBoard } from './helpers.ts'

// The board without a mouse: Tab lands on a card, Option/Alt + arrows go from card to
// card, Enter does what a double-click does, and every card has a name to hear.

/** Tab from the left toolbar until focus reaches the board. */
async function tabOntoBoard(page: Page) {
  await page.getByTestId('tool-trash').focus()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate(() => !!document.activeElement?.closest('[data-testid="canvas"]'))) return
  }
  throw new Error('Tab never reached the board')
}

test('Tab lands on the first card; Option/Alt + arrows move between cards; arrows still nudge', async ({ page }) => {
  await freshBoard(page)
  const left = await addNote(page, 'Left paw', 0.3, 0.3)
  const right = await addNote(page, 'Right paw', 0.7, 0.32)
  const below = await addNote(page, 'Tail', 0.3, 0.7)
  await page.keyboard.press('Escape')

  await tabOntoBoard(page)
  await expect(left).toBeFocused()
  await expect(left).toHaveClass(/selected/)
  await expect(left).toHaveAttribute('aria-label', 'Note: Left paw')

  await page.keyboard.press('Alt+ArrowRight')
  await expect(right).toBeFocused()
  await expect(right).toHaveClass(/selected/)
  await expect(left).not.toHaveClass(/selected/)
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(left).toBeFocused()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(below).toBeFocused()

  // Plain arrows move the card itself, as before.
  const x = (await below.boundingBox())!.x
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await below.boundingBox())!.x).toBeGreaterThan(x + 5)
  await expect(below).toBeFocused()
})

test('Enter edits a note and opens a board, like a double-click', async ({ page }) => {
  await freshBoard(page, 'Keys')
  await page.getByTestId('tool-board').click()
  await page.keyboard.type('Den by the door')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  const note = await addNote(page, 'Walkies', 0.3, 0.75)
  await page.keyboard.press('Escape')
  await tabOntoBoard(page)
  const board = cardByText(page, 'Den by the door')
  await expect(board).toHaveAttribute('aria-label', 'Board: Den by the door')
  // Reading order: the board tile was placed first, higher up.
  await expect(board).toBeFocused()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(note).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+ArrowUp')
  await expect(board).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('board-name')).toHaveText('Den by the door')
})

test('colours, the card toolbar and note headings make sense to a screen reader', async ({ page }) => {
  await freshBoard(page)
  const note = await addNote(page, '# Trip to the coast')
  await expect(page.getByRole('toolbar', { name: 'Card actions' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Collar red' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sky blue' })).toBeVisible()
  await expect(note.getByRole('heading', { level: 3, name: 'Trip to the coast' })).toBeVisible()
  await expect(note).toHaveAttribute('aria-label', 'Note: Trip to the coast')
})
