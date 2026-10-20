import { expect, test, type Page } from '@playwright/test'
import { at, camera, cardByText, freshBoard, waitForSync } from './helpers.ts'
import { note, seedCards, setCamera, tap, tapOn, touchAddNote } from './touch.ts'

// Editing on a phone: two taps to type, the card glides to a readable size,
// formatting and Done ride above the keyboard, and the board comes back after.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const fontSize = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

test('tap, tap, type, Done: the note glides into view and back', async ({ page }) => {
  await seedCards(page, [note('Shopping', 300, 500)])
  await setCamera(page, { x: -20, y: -20, zoom: 0.5 })
  const before = await camera(page)
  const card = cardByText(page, 'Shopping')
  await tapOn(page, card)
  await tapOn(page, card)
  const editor = page.getByTestId('note-editor')
  await expect(editor).toBeVisible()
  await expect(page.getByTestId('edit-dock')).toBeVisible()
  await expect(page.getByTestId('format-bar')).toHaveCount(0)
  // Readable, near the top of the screen, fully across.
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThanOrEqual(0.9)
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await expect.poll(async () => (await card.boundingBox())!.y - canvas.y).toBeLessThan(40)
  const box = (await card.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(canvas.x)
  expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width)

  await page.keyboard.press('End')
  await page.keyboard.type(' list')
  await page.getByTestId('dock-fmt-heading').tap()
  await expect(editor.locator('.cm-md-h2')).toHaveText('Shopping list')
  await page.getByTestId('edit-done').tap()
  await expect(editor).toHaveCount(0)
  await expect(cardByText(page, 'Shopping list').locator('h2')).toBeVisible()
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(before.zoom, 2)
  await waitForSync(page)
  await page.reload()
  await expect(cardByText(page, 'Shopping list')).toBeVisible()
})

test('double-tap, type, Done makes a note', async ({ page }) => {
  await touchAddNote(page, 'Squirrel spotted')
  await waitForSync(page)
  await page.reload()
  await expect(cardByText(page, 'Squirrel spotted')).toBeVisible()
})

test('zoomed right out, a double-tap still opens a note to type in', async ({ page }) => {
  await seedCards(page, [note('Far away', 0, 0)])
  await setCamera(page, { x: -400, y: -400, zoom: 0.2 })
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  const p = await at(page, 0.6, 0.7)
  await tap(page, p)
  await page.waitForTimeout(60)
  await tap(page, p)
  await expect(page.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.type('Close up')
  await page.getByTestId('edit-done').tap()
  await expect(cardByText(page, 'Close up')).toBeVisible()
})

test('a to-do edits with two taps and finishes with Done', async ({ page }) => {
  await seedCards(page, [{ type: 'todo', x: 0, y: 0, w: 240, content: { title: 'Errands', items: [{ id: 'a', text: 'Vet', done: false }] } }])
  const card = cardByText(page, 'Errands')
  await tapOn(page, card.getByText('Errands'))
  await tapOn(page, card.getByText('Vet'))
  await expect(page.getByTestId('todo-item-input').first()).toBeVisible()
  await expect(page.getByTestId('edit-dock')).toBeVisible()
  await expect(page.getByTestId('dock-fmt-bold')).toHaveCount(0)
  await page.getByTestId('edit-done').tap()
  await expect(page.getByTestId('todo-item-input')).toHaveCount(0)
})

test('the Edit button in the selection bar opens the editor', async ({ page }) => {
  await seedCards(page, [note('Via the bar', 0, 0)])
  await tapOn(page, cardByText(page, 'Via the bar'))
  await page.getByTestId('edit-card').tap()
  await expect(page.getByTestId('note-editor')).toBeVisible()
})

test('task boxes tick from the rendered note and inside the editor', async ({ page }) => {
  await seedCards(page, [note('Kit\n\n- [ ] Ball\n- [ ] Rope', 0, 0)])
  const card = cardByText(page, 'Kit')
  await card.getByTestId('task-check').first().tap()
  await expect(card.getByTestId('task-check').first()).toBeChecked()
  await expect(page.getByTestId('note-editor')).toHaveCount(0)

  await tapOn(page, card)
  await tapOn(page, card)
  await expect(page.getByTestId('note-editor')).toBeVisible()
  // Lines away from the caret show their box; un-tick Ball in place.
  await expect(page.getByTestId('note-editor')).toContainText('Rope')
  await expect(page.locator('.cm-md-task').first()).toBeChecked()
  await page.locator('.cm-md-task').first().tap()
  await expect(page.locator('.cm-md-task').first()).not.toBeChecked()
  await expect(page.getByTestId('note-editor')).toBeVisible()
})

test('fields outside cards are 16px on touch, so iOS does not zoom into them', async ({ page }) => {
  await page.getByTestId('open-fetch').tap()
  expect(await fontSize(page, '[data-testid=fetch-input]')).toBeGreaterThanOrEqual(16)
  await page.keyboard.press('Escape')
  await page.getByTestId('toybox-button').tap()
  expect(await fontSize(page, '[data-testid=toybox-input]')).toBeGreaterThanOrEqual(16)
})

test('the caret lands on the word you tapped, even as the card glides in', async ({ page }) => {
  await seedCards(page, [note('Leave at eight Saturday morning sharp', 300, 400, { w: 260 })])
  await setCamera(page, { x: -20, y: -20, zoom: 0.6 })
  const card = cardByText(page, 'Saturday')
  await tapOn(page, card)
  const word = card.getByText('Leave at eight Saturday morning sharp')
  const box = (await word.boundingBox())!
  // Tap just inside "Saturday" (the 4th word).
  const range = await word.evaluate((el) => {
    const r = document.createRange()
    const text = el.firstChild!
    const i = text.textContent!.indexOf('Saturday')
    r.setStart(text, i + 2)
    r.setEnd(text, i + 3)
    const b = r.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  expect(range.y).toBeGreaterThan(box.y)
  await tap(page, range)
  await expect(page.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.type('Z')
  // Inside the tapped word (a fingertip is a few letters wide).
  await expect(page.getByTestId('note-editor')).toContainText(/S\w*Z\w*y morning/)
})

test('bolding a whole heading line keeps it a heading', async ({ page }) => {
  await seedCards(page, [note('# Hike plan\nBring water', 0, 0)])
  const card = cardByText(page, 'Hike plan')
  await tapOn(page, card)
  await tapOn(page, card, { x: 40, y: 18 })
  await expect(page.getByTestId('note-editor')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+ArrowUp')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.getByTestId('dock-fmt-bold').tap()
  await page.getByTestId('edit-done').tap()
  await expect(cardByText(page, 'Hike plan').locator('h1 strong')).toHaveText('Hike plan')
})

test('the edit dock nests and un-nests list items (phones have no Tab key)', async ({ page }) => {
  await seedCards(page, [note('- kibble\n- treats', 0, 0)])
  const card = cardByText(page, 'kibble')
  await tapOn(page, card)
  await tapOn(page, card.getByText('treats'))
  const editor = page.getByTestId('note-editor')
  await expect(editor).toBeVisible()
  await page.getByTestId('dock-fmt-indent').tap()
  await expect(editor.locator('.cm-md-li[style*="--li-depth: 2"]')).toHaveText('◦treats')
  await page.getByTestId('dock-fmt-outdent').tap()
  await expect(editor.locator('.cm-md-li[style*="--li-depth: 2"]')).toHaveCount(0)
})
