import { expect, test, type Page } from '@playwright/test'
import { MOD, at, cardByText, cards, freshBoard, openCardMenu, pullAllObjects, runCardAction, waitForSync } from './helpers.ts'
import { boardOf, note, seedCards } from './touch.ts'

// Cut, Copy and Paste from the right-click menu: notes and images, onto empty
// canvas or into a column, and whatever another app left on the clipboard.

test.beforeEach(async ({ page, browserName }) => {
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await freshBoard(page)
})

const menu = (page: Page) => page.getByTestId('canvas-context-menu')

/** Right-click empty canvas at a fraction of the board and choose Paste. Returns the screen point. */
async function pasteFromMenu(page: Page, fx: number, fy: number) {
  const p = await at(page, fx, fy)
  await page.mouse.click(p.x, p.y, { button: 'right' })
  await expect(menu(page).getByRole('menuitem')).toHaveText(['Paste⌘V'])
  await menu(page).getByRole('menuitem', { name: 'Paste', exact: true }).click()
  await expect(menu(page)).toHaveCount(0)
  return p
}

async function addImage(page: Page) {
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(64, 48)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#e8a849'
    ctx.fillRect(0, 0, 64, 48)
    let s = ''
    for (const b of new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())) s += String.fromCharCode(b)
    return btoa(s)
  })
  await page.getByTestId('image-input').setInputFiles({ name: 'pup.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByTestId('card-image')).toHaveCount(1)
}

/** What the system clipboard holds, as its types (Chromium can read it back). */
const clipboardTypes = (page: Page) => page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => [...i.types]))

test('Copy a note, then Paste on empty canvas: the copy lands at the pointer, one undo', async ({ page }) => {
  await seedCards(page, [note('Fetch the ball', 0, 0)])
  await expect(menu(page)).toHaveCount(0)
  await runCardAction(page, 'Copy', cardByText(page, 'Fetch the ball'))
  const p = await pasteFromMenu(page, 0.7, 0.6)
  const copies = page.locator('[data-testid=card]', { hasText: 'Fetch the ball' })
  await expect(copies).toHaveCount(2)
  await expect(copies.last()).toHaveClass(/selected/)
  const box = (await copies.last().boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - p.x)).toBeLessThan(30)
  expect(Math.abs(box.y + box.height / 2 - p.y)).toBeLessThan(30)
  await page.keyboard.press(`${MOD}+Z`)
  await expect(cards(page)).toHaveCount(1)
})

test('Cut buries the card; Paste brings the very same card back somewhere else', async ({ page }) => {
  const [id] = await seedCards(page, [note('Moving day', 0, 0)])
  await runCardAction(page, 'Cut', cardByText(page, 'Moving day'))
  await expect(cards(page)).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('Cut 1 card')
  await pasteFromMenu(page, 0.6, 0.6)
  await expect(cardByText(page, 'Moving day')).toBeVisible()
  await expect(cardByText(page, 'Moving day')).toHaveAttribute('data-card-id', id)
})

test('Copy on an image puts the picture on the clipboard; Paste makes a second card of the same picture', async ({ page, browserName }) => {
  await addImage(page)
  await runCardAction(page, 'Copy', page.locator('[data-type=image]'))
  if (browserName === 'chromium') await expect.poll(() => clipboardTypes(page)).toContain('image/png')
  await pasteFromMenu(page, 0.3, 0.7)
  await expect(page.getByTestId('card-image')).toHaveCount(2)
  await waitForSync(page)
  const { objects } = await pullAllObjects(page.request)
  const board = boardOf(page)
  const images = objects.filter((o: { type?: string; boardId?: string; deletedAt?: number | null }) => o.type === 'image' && o.boardId === board && !o.deletedAt)
  expect(images).toHaveLength(2)
  expect(images[0].content.assetId).toBe(images[1].content.assetId)
})

test('⌘C on an image card also copies the picture', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Reading the system clipboard back needs Chromium permissions')
  await addImage(page)
  await page.locator('[data-type=image]').click()
  await page.keyboard.press(`${MOD}+C`)
  await expect.poll(() => clipboardTypes(page)).toContain('image/png')
})

test('Paste takes a picture, words and a link from another app', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Filling the system clipboard from the test needs Chromium permissions')
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(40, 30)
    c.getContext('2d')!.fillRect(0, 0, 40, 30)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await c.convertToBlob({ type: 'image/png' }) })])
  })
  await pasteFromMenu(page, 0.3, 0.3)
  await expect(page.getByTestId('card-image')).toHaveCount(1)
  await page.evaluate(() => navigator.clipboard.writeText('Walk at six'))
  await pasteFromMenu(page, 0.7, 0.3)
  await expect(page.locator('[data-type=note]', { hasText: 'Walk at six' })).toHaveCount(1)
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/treats'))
  await pasteFromMenu(page, 0.5, 0.75)
  await expect(page.locator('[data-type=link]')).toHaveCount(1)
})

test('Paste from the menu over a column drops the card into it', async ({ page }) => {
  await seedCards(page, [{ type: 'column', x: 400, y: 0, w: 280, content: { title: 'Ideas' } }, note('Squeaky toy', 0, 0)])
  await runCardAction(page, 'Copy', cardByText(page, 'Squeaky toy'))
  const column = cardByText(page, 'Ideas')
  const body = (await column.getByTestId('column-body').boundingBox())!
  await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2, { button: 'right' })
  await menu(page).getByRole('menuitem', { name: 'Paste', exact: true }).click()
  await expect(column.getByTestId('column-body').getByTestId('card')).toHaveText(['Squeaky toy'])
})

test('the card menu lists Cut, Copy and Paste with their shortcuts', async ({ page }) => {
  await seedCards(page, [note('Shortcuts', 0, 0)])
  await openCardMenu(page, cardByText(page, 'Shortcuts'))
  for (const [name, keys] of [['Cut', 'Meta+X'], ['Copy', 'Meta+C'], ['Paste', 'Meta+V']]) {
    await expect(menu(page).getByRole('menuitem', { name, exact: true })).toHaveAttribute('aria-keyshortcuts', keys)
  }
  await expect(menu(page).locator('svg[data-icon="cut"]')).toHaveCount(1)
  await expect(menu(page).locator('svg[data-icon="copy"]')).toHaveCount(1)
  await expect(menu(page).locator('svg[data-icon="paste"]')).toHaveCount(1)
})
