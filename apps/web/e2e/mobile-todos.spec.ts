import { expect, test, type Page } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { seedCards, tap, tapOn } from './touch.ts'

// Phones: ticking chores with a thumb. Rows settle a beat after the last tap, so
// quick taps down a list never land on a row that just moved.

const list = (page: Page) => page.locator('[data-type=todo]').first()
const texts = (page: Page) => list(page).locator('.todo-item .todo-text').evaluateAll((els) => els.map((e) => e.firstChild?.textContent ?? ''))

async function tapGutter(page: Page, text: string) {
  const box = (await list(page).getByRole('checkbox', { name: text }).boundingBox())!
  // A fingertip lands a little off the 14px box.
  await tap(page, { x: box.x + box.width / 2 + 10, y: box.y + box.height / 2 + 4 })
}

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [{ type: 'todo', x: 0, y: 0, w: 280, content: { title: 'Chores', items: ['Vacuum', 'Dishes', 'Laundry', 'Bins'].map((t) => ({ id: t.toLowerCase(), text: t, done: false })) } }])
})

test('quick taps down a list tick the rows under the finger, then they settle', async ({ page }) => {
  await tapGutter(page, 'Vacuum')
  await page.waitForTimeout(250)
  await tapGutter(page, 'Dishes')
  await page.waitForTimeout(250)
  await tapGutter(page, 'Laundry')
  // Nothing has moved yet: each tap restarted the wait.
  expect(await texts(page)).toEqual(['Vacuum', 'Dishes', 'Laundry', 'Bins'])
  await expect(list(page).getByRole('checkbox', { name: 'Laundry' })).toBeChecked()
  await expect.poll(() => texts(page)).toEqual(['Bins', 'Vacuum', 'Dishes', 'Laundry'])
  await expect(list(page).getByRole('checkbox', { name: 'Bins' })).not.toBeChecked()
  await expect(list(page).getByTestId('todo-done-at')).toHaveCount(3)
  await expect(page.getByTestId('todo-item-input')).toHaveCount(0)
})

test('list options open as a sheet from the selection bar', async ({ page }) => {
  await tapOn(page, list(page).locator('.todo-title'))
  await page.getByTestId('todo-options').tap()
  const menu = page.getByTestId('todo-options-menu')
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.x).toBeLessThanOrEqual(1)
  expect(box.x + box.width).toBeGreaterThanOrEqual(viewport.width - 1)
  await page.getByTestId('todo-hide-done').tap()
  await expect(page.getByTestId('todo-hide-done')).toHaveAttribute('aria-checked', 'true')
})
