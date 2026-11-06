import { expect, test } from '@playwright/test'
import { camera, cardByText, freshBoard, setAccountAppearance, waitForSync } from './helpers.ts'
import { moveFixture } from './move-board-fixture.ts'
import { Fingers, boardOf, center, fakeKeyboard, touchDrag, tapOn } from './touch.ts'

test.beforeEach(async ({ page }) => { await freshBoard(page); await moveFixture(page, true) })

test('phone More opens the searchable sheet without raising the keyboard, then moves to an existing board', async ({ page }) => {
  const source = boardOf(page), card = cardByText(page, 'Move first idea')
  await tapOn(page, card); await page.getByTestId('selection-more').tap(); await page.getByTestId('move-to-board').tap()
  const picker = page.getByTestId('move-board-picker'), search = page.getByTestId('move-board-search')
  await expect(picker).toBeVisible(); await expect(search).not.toBeFocused()
  await search.fill('Move destination')
  await page.getByTestId('move-board-result').filter({ hasText: 'Move destination' }).first().tap()
  await expect(card).toHaveCount(0); expect(boardOf(page)).toBe(source)
  await expect(page.getByTestId('toast')).toContainText('Moved 1 item')
})

test('new board naming and search remain above the phone keyboard', async ({ page }) => {
  await tapOn(page, cardByText(page, 'Move first idea'))
  await page.getByTestId('selection-more').tap(); await page.getByTestId('move-to-board').tap()
  await page.getByTestId('move-board-new').tap()
  const field = page.getByTestId('move-board-name')
  await expect(field).toBeFocused(); await field.fill('Phone collection')
  await fakeKeyboard(page, true)
  const submit = page.getByRole('button', { name: 'Create and move' })
  const b = (await submit.boundingBox())!, height = await page.evaluate(() => visualViewport!.height)
  expect(b.y + b.height).toBeLessThanOrEqual(height + 2)
  await submit.tap(); await fakeKeyboard(page, false)
  await expect(cardByText(page, 'Move first idea')).toHaveCount(0)
  await expect(page.getByTestId('board-title').filter({ hasText: 'Phone collection' })).toBeVisible()
})

test('selected touch drag offers a board target and cancellation restores the item', async ({ page }) => {
  const card = cardByText(page, 'Move first idea')
  await tapOn(page, card)
  const from = await center(card), to = await center(page.locator('[data-type="board"] .board-tile'))
  const f = new Fingers(page)
  await f.press(0, from)
  for (let i = 1; i <= 12; i++) await f.move(0, { x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 })
  await expect(page.getByTestId('board-drop-target')).toContainText('Add to this board')
  await f.cancel(); await expect(card).toBeVisible(); await expect(page.getByTestId('board-drop-target')).toHaveCount(0)
  await touchDrag(page, from, to)
  await expect(card).toHaveCount(0)
  await waitForSync(page)
})

test('unselected one-finger gestures still pan over items', async ({ page }) => {
  const from = await center(cardByText(page, 'Move first idea')), before = await camera(page)
  await touchDrag(page, from, { x: from.x + 40, y: from.y + 80 })
  const after = await camera(page)
  expect(Math.abs(after.tx - before.tx) + Math.abs(after.ty - before.ty)).toBeGreaterThan(40)
  await expect(page.getByTestId('board-drop-target')).toHaveCount(0)
})

for (const theme of ['Light', 'Dark'] as const) test(`phone picker visual review ${theme}`, async ({ page }, info) => {
  await setAccountAppearance(page, theme, { tap: true })
  await tapOn(page, cardByText(page, 'Move first idea'))
  await page.getByTestId('selection-more').tap(); await page.getByTestId('move-to-board').tap()
  await expect(page.getByTestId('move-board-picker')).toBeVisible()
  await page.screenshot({ path: `../../docs/qa/move-to-board/${info.project.name}-${theme.toLowerCase()}-picker.png` })
})
