import { expect, test, type Page } from '@playwright/test'
import { clickEmpty, freshBoard, waitForSync } from './helpers.ts'
import { MOD, bodyRows, cell, grid, headerCells, input, openEditing, rowGrip, seedTable, table } from './tables.ts'

// Copy, cut and paste inside a table, and tab-separated text pasted onto the
// board. Real keys for copying and pasting our own cells; synthetic paste events
// (a DataTransfer with exactly the formats wanted) for what other apps send.

const PACK = [['Rex', '4', 'Bacon'], ['Mochi', '7', 'Cheese'], ['Biscuit', '2', 'Roast chicken'], ['Fido', '9', 'Kibble']]
const COLS = ['Pup', 'Age', 'Treat']

test.beforeEach(async ({ page, browserName }) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await freshBoard(page)
})

/** What another app's Copy would put on the clipboard, delivered as a paste to the focused element. */
async function pasteFrom(page: Page, formats: Record<string, string>) {
  await page.evaluate((f) => {
    const dt = new DataTransfer()
    for (const [type, value] of Object.entries(f)) dt.setData(type, value)
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, formats)
}

const body = async (page: Page) => (await grid(page)).slice(1)

test('copy a range, move, paste: the cells land where the cursor is, one undo takes them back', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 0, 0)
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press(`${MOD}+c`)
  // Nothing changed by copying, and the field is empty again so typing still replaces.
  await expect(input(page)).toHaveValue('')
  expect(await body(page)).toEqual(PACK)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press(`${MOD}+v`)
  expect(await body(page)).toEqual([['Rex', '4', 'Bacon'], ['Mochi', '7', 'Cheese'], ['Biscuit', 'Rex', '4'], ['Fido', 'Mochi', '7']])
  // The pasted cells are selected.
  const range = (await page.getByTestId('table-range').boundingBox())!
  const a = (await cell(page, 2, 1).boundingBox())!, b = (await cell(page, 3, 2).boundingBox())!
  expect(Math.abs(range.x - a.x)).toBeLessThan(2)
  expect(Math.abs(range.y + range.height - (b.y + b.height))).toBeLessThan(2)
  await page.keyboard.press(`${MOD}+z`)
  expect(await body(page)).toEqual(PACK)
})

test('the copy is tab-separated text and a plain HTML table, with markup escaped', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Reading the system clipboard back needs Chromium permissions')
  await seedTable(page, ['Pup', 'Note'], [['Rex', '<img src=x onerror=alert(1)>'], ['Mochi', 'say "hi"\ttab']])
  await openEditing(page, 0, 0)
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.press(`${MOD}+c`)
  const got = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return { types: item!.types, text: await (await item!.getType('text/plain')).text(), html: await (await item!.getType('text/html')).text() }
  })
  expect(got.text).toBe('Rex\t<img src=x onerror=alert(1)>\r\nMochi\t"say ""hi""\ttab"')
  expect(got.html).toContain('<table>')
  expect(got.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(got.html).not.toMatch(/<img/i)
  // Copying a header range puts the names first.
  await page.keyboard.press(`${MOD}+ArrowUp`)
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press(`${MOD}+c`)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Pup\tNote')
})

test('pasting tab-separated text grows the table with the rows and columns it needs', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 3, 2)
  await pasteFrom(page, { 'text/plain': 'a\tb\tc\r\nd\te\tf\r\n' })
  const g = await grid(page)
  expect(g).toHaveLength(6)
  expect(g[0]).toEqual([...COLS, '', ''])
  expect(g[4]).toEqual(['Fido', '9', 'a', 'b', 'c'])
  expect(g[5]).toEqual(['', '', 'd', 'e', 'f'])
  await expect(headerCells(page)).toHaveCount(5)
  // One undo takes back the cells, the rows and the columns together.
  await page.keyboard.press(`${MOD}+z`)
  expect(await grid(page)).toEqual([COLS, ...PACK])
})

test('values are read by the column they land in', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 0, 1)
  await pasteFrom(page, { 'text/plain': '1,500\nsoon' })
  // Text in a text column stays text; a number column would hold numbers: right alignment is by type, so only the text is compared.
  expect((await body(page)).slice(0, 2).map((r) => r[1])).toEqual(['1,500', 'soon'])
})

test('one value pasted over a range fills it', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 1, 2)
  await page.keyboard.press(`${MOD}+c`)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press(`${MOD}+v`)
  expect(await body(page)).toEqual([['Rex', 'Cheese', 'Cheese'], ['Mochi', 'Cheese', 'Cheese'], ['Biscuit', 'Cheese', 'Cheese'], ['Fido', '9', 'Kibble']])
  await page.keyboard.press(`${MOD}+z`)
  expect(await body(page)).toEqual(PACK)
})

test('cut empties the range in one step, and pasting brings the cells back elsewhere', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 0, 0)
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press(`${MOD}+x`)
  expect(await body(page)).toEqual([['', '', 'Bacon'], ['', '', 'Cheese'], ['Biscuit', '2', 'Roast chicken'], ['Fido', '9', 'Kibble']])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press(`${MOD}+v`)
  expect(await body(page)).toEqual([['', '', 'Bacon'], ['', '', 'Cheese'], ['Rex', '4', 'Roast chicken'], ['Mochi', '7', 'Kibble']])
  await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press(`${MOD}+z`)
  expect(await body(page)).toEqual(PACK)
})

test('copying and cutting whole rows and columns works from their grips', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 0, 0)
  await rowGrip(page, 1).click()
  await page.keyboard.press(`${MOD}+c`)
  await rowGrip(page, 3).click()
  await page.keyboard.press(`${MOD}+v`)
  expect((await body(page))[3]).toEqual(['Mochi', '7', 'Cheese'])
  await page.getByTestId('table-column-grip').nth(1).click()
  await page.keyboard.press(`${MOD}+x`)
  expect((await body(page)).map((r) => r[1])).toEqual(['', '', '', ''])
})

test('only plain text is read: a paste with HTML alone does nothing, with both it uses the text', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 0, 0)
  await pasteFrom(page, { 'text/html': '<table><tr><td>Sneaky</td></tr></table>' })
  expect(await body(page)).toEqual(PACK)
  await pasteFrom(page, { 'text/html': '<table><tr><td>Sneaky</td></tr></table>', 'text/plain': 'Honest' })
  expect((await body(page))[0]![0]).toBe('Honest')
})

test('a paste while editing a cell is plain text in the draft, not a grid', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 0, 0)
  await page.keyboard.press('Enter')
  const before = await body(page)
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'x')
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    document.activeElement!.dispatchEvent(ev)
    ;(window as unknown as { __prevented: boolean }).__prevented = ev.defaultPrevented
  })
  // Left to the browser: the table is untouched and we did not swallow the event.
  expect(await page.evaluate(() => (window as unknown as { __prevented: boolean }).__prevented)).toBe(false)
  expect(await body(page)).toEqual(before)
})

test('a paste that does not fit stops at the limits and says so', async ({ page }) => {
  const rows = Array.from({ length: 99 }, (_, i) => [`row ${i + 1}`, '', ''])
  await seedTable(page, COLS, rows)
  await openEditing(page, 0, 0)
  await page.keyboard.press(`${MOD}+ArrowDown`)
  await pasteFrom(page, { 'text/plain': 'a\nb\nc' })
  await expect(page.getByTestId('toast')).toContainText('100 rows')
  expect(await bodyRows(page).count()).toBe(100)
  expect((await body(page))[98]![0]).toBe('a')
  expect((await body(page))[99]![0]).toBe('b')
})

test('copying a table card after removing a row keeps only the rows still there', async ({ page }) => {
  await seedTable(page, COLS, PACK)
  await openEditing(page, 0, 0)
  await rowGrip(page, 1).click()
  await page.getByTestId('table-delete').click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await table(page).click()
  await page.keyboard.press(`${MOD}+c`)
  await page.mouse.move(700, 500)
  await page.keyboard.press(`${MOD}+v`)
  await expect(page.locator('[data-type=table]')).toHaveCount(2)
  await expect(page.locator('[data-type=table]').nth(1).locator('tbody tr')).toHaveCount(3)
})

test('tab-separated text pasted on the board becomes a table, names from the first row', async ({ page }) => {
  await clickEmpty(page)
  await pasteFrom(page, { 'text/plain': 'Pup\tAge\tTreat\r\nRex\t4\tBacon\r\nMochi\t7\tCheese\r\n' })
  await expect(page.locator('[data-type=table]')).toHaveCount(1)
  expect(await grid(page)).toEqual([COLS, ['Rex', '4', 'Bacon'], ['Mochi', '7', 'Cheese']])
  await waitForSync(page)
  await page.reload()
  await expect(table(page)).toBeVisible()
  expect(await grid(page)).toEqual([COLS, ['Rex', '4', 'Bacon'], ['Mochi', '7', 'Cheese']])
})

test('pasted numbers without names get Column 1, Column 2; one undo removes the table', async ({ page }) => {
  await clickEmpty(page)
  await pasteFrom(page, { 'text/plain': '1\t2\r\n3\t4' })
  expect(await grid(page)).toEqual([['Column 1', 'Column 2'], ['1', '2'], ['3', '4']])
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.locator('[data-type=table]')).toHaveCount(0)
})

test('text with no tabs is still a note, and so is a tabbed single line', async ({ page }) => {
  await clickEmpty(page)
  await pasteFrom(page, { 'text/plain': 'just a thought' })
  await expect(page.locator('[data-type=note]')).toHaveCount(1)
  await pasteFrom(page, { 'text/plain': 'one line\twith a tab' })
  await expect(page.locator('[data-type=note]')).toHaveCount(2)
  await expect(page.locator('[data-type=table]')).toHaveCount(0)
})

test('⌘V pastes a copied sheet as a table; ⌘⇧V keeps it a note', async ({ page }) => {
  // Browsers differ in what they fire for the keys themselves, so the paste arrives as the keys are released.
  await page.evaluate(() => window.addEventListener('paste', (e) => { if (e.isTrusted) e.stopImmediatePropagation() }, true))
  const pasteOnRelease = (text: string) => page.evaluate((text) => {
    window.addEventListener('keyup', function up(e) {
      if (e.key.toLowerCase() !== 'v') return
      window.removeEventListener('keyup', up, true)
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, true)
  }, text)
  const sheet = 'A\tB\r\n1\t2\r\n3\t4'
  await clickEmpty(page)
  await page.mouse.move(500, 400)
  await pasteOnRelease(sheet)
  await page.keyboard.press(`${MOD}+V`)
  await expect(page.locator('[data-type=table]')).toHaveCount(1)
  await clickEmpty(page)
  await page.mouse.move(300, 200)
  await pasteOnRelease(sheet)
  await page.keyboard.press(`${MOD}+Shift+V`)
  await expect(page.locator('[data-type=note]')).toHaveCount(1)
  await expect(page.locator('[data-type=table]')).toHaveCount(1)
})
