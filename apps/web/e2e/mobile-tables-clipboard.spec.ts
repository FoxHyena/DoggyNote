import { expect, test, type Page } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { seedCards, tapEmpty, tapOn } from './touch.ts'
import { cell, grid, input, table, tableFields } from './tables.ts'

// Phones have no ⌘C: copying goes through the system's selection menu, which no
// test can drive, so only what arrives is tested here. The paste handler is the
// same one the keyboard shortcut and the system's Paste bubble reach, so a
// synthetic paste event stands in for "Paste" and is checked on both phones.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

async function pasteFrom(page: Page, text: string) {
  await page.evaluate((text) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

test('Paste in a selected cell fills from it and grows the table; the keyboard stays up', async ({ page }) => {
  const { fields } = tableFields(['Pup', 'Treat'], [['Rex', 'Bacon'], ['Mochi', 'Cheese']])
  await seedCards(page, [{ type: 'table', x: 70, y: 140, w: 300, content: { title: '' }, fields }])
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await tapOn(page, cell(page, 0, 0), { x: 20, y: 10 })
  await expect(input(page)).toBeFocused()
  // The board glides to bring the cell above the keyboard: tap once it has settled.
  await page.waitForTimeout(500)
  // A tap on another cell selects it (a second tap would edit it); Paste then lands in the grid.
  await tapOn(page, cell(page, 1, 1), { x: 20, y: 10 })
  await expect(input(page)).toHaveValue('')
  await pasteFrom(page, 'a\tb\r\nc\td')
  expect(await grid(page)).toEqual([['Pup', 'Treat', ''], ['Rex', 'Bacon', ''], ['Mochi', 'a', 'b'], ['', 'c', 'd']])
  await expect(input(page)).toBeFocused()
})

test('a pasted sheet on the board becomes a table card', async ({ page }) => {
  await tapEmpty(page)
  await pasteFrom(page, 'Pup\tAge\r\nRex\t4\r\nMochi\t7')
  await expect(page.locator('[data-type=table]')).toHaveCount(1)
  expect(await grid(page)).toEqual([['Pup', 'Age'], ['Rex', '4'], ['Mochi', '7']])
  await expect(table(page)).toBeVisible()
})
