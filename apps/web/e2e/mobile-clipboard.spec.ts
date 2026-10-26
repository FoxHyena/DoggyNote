import { expect, test } from '@playwright/test'
import { camera, cardByText, freshBoard, selectAllText } from './helpers.ts'
import { fakeKeyboard, note, seedCards, selectionBarFits, tapOn } from './touch.ts'

// Phones have no ⌘D: Duplicate sits in the selection bar's More sheet.

test('Duplicate from the selection bar copies the card beside it', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Walkies at 5', 0, 0)])
  await tapOn(page, cardByText(page, 'Walkies at 5'))
  // Every bar button is on the screen.
  await selectionBarFits(page)
  expect((await page.getByTestId('selection-bar').boundingBox())!.height).toBeLessThanOrEqual(200)
  await page.getByTestId('selection-more').tap()
  await page.getByTestId('duplicate-selection').tap()
  await expect(page.locator('[data-type=note]', { hasText: 'Walkies at 5' })).toHaveCount(2)
  await page.screenshot({ path: test.info().outputPath('bar.png') })
})

test('touch text menus remain native inside the editor and are suppressed on bare canvas', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Copy these words', 0, 0)])
  const card = cardByText(page, 'Copy these words')
  await tapOn(page, card); await tapOn(page, card)
  const editor = page.getByTestId('note-editor')
  await expect(editor).toBeFocused()
  await selectAllText(page)
  const prevented = await editor.evaluate((el) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(prevented, 'the browser must receive native editor context menus').toBe(false)
  await expect(editor).toBeFocused()
  expect(await page.evaluate(() => getSelection()?.toString())).toContain('Copy these words')
  const copied = await editor.evaluate((el) => {
    const data = new DataTransfer()
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return data.getData('text/plain')
  })
  expect(copied).toBe('Copy these words')
  await editor.evaluate((el) => el.dispatchEvent(new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })))
  await expect(editor).toHaveText('')
  await editor.evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, copied)
  await expect(editor).toHaveText('Copy these words')
  expect(await page.getByTestId('canvas').evaluate((el) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)
})

test('selecting a long note keeps the camera and native selection anchor stationary', async ({ page }) => {
  await freshBoard(page)
  const text = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} for copying`).join('\n\n')
  await seedCards(page, [note(text, 0, 0)])
  const card = cardByText(page, 'Line 1 for copying')
  await tapOn(page, card, { x: 40, y: 15 }); await tapOn(page, card, { x: 40, y: 15 })
  const editor = page.getByTestId('note-editor')
  await expect(editor).toBeFocused()
  await fakeKeyboard(page, true)
  await selectAllText(page); await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('canvas')).not.toHaveClass(/moving/)
  const before = await camera(page)
  await selectAllText(page)
  // Observe beyond the edit camera's longest animation, including selectionchange.
  await page.waitForTimeout(350)
  expect(await camera(page)).toEqual(before)
  expect(await page.evaluate(() => getSelection()?.toString())).toContain('Line 40 for copying')
})
