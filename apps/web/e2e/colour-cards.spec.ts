import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MOD, clickEmpty, freshBoard, waitForSync } from './helpers.ts'

// Colour cards are edited in a small panel beside the card: preset dots, the
// system colour picker, HEX and name. Double-click opens it; Escape or a click
// elsewhere closes it. No dialog, no Edit button on the card.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const contexts = new Set<BrowserContext>()
test.afterEach(async () => {
  await Promise.all([...contexts].map((c) => c.close()))
  contexts.clear()
})

const colourCard = (page: Page) => page.locator('[data-testid="card"][data-type="swatch"]')
const paint = (page: Page) => colourCard(page).getByTestId('colour-paint').evaluate((el) => getComputedStyle(el).backgroundColor)

/** A new colour card from the toolbar; its panel opens straight away. Escape leaves it selected. */
async function addColourCard(page: Page) {
  await page.getByTestId('tool-swatch').click()
  await expect(colourCard(page)).toHaveCount(1)
  await expect(page.getByTestId('colour-panel')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('colour-panel')).toHaveCount(0)
  return colourCard(page)
}

test('double-click a colour card, pick a preset, a custom colour and a name: it stays after a reload', async ({ page }) => {
  const card = await addColourCard(page)
  await expect(card.getByTestId('colour-hex')).toHaveText('#2F5D50')
  await expect(card.getByRole('button')).toHaveCount(0)

  await card.getByTestId('colour-paint').dblclick()
  const panel = page.getByTestId('colour-panel')
  await expect(panel).toBeVisible()
  // Anchored beside the card, not a full-screen dialog.
  const c = (await card.boundingBox())!
  const p = (await panel.boundingBox())!
  expect(p.width).toBeLessThan(400)
  expect(p.y >= c.y + c.height || p.y + p.height <= c.y).toBe(true)

  // A preset recolours the card at once.
  await panel.locator('[data-testid="colour-preset"][data-hex="#0090FF"]').click()
  await expect(card.getByTestId('colour-hex')).toHaveText('#0090FF')
  expect(await paint(page)).toBe('rgb(0, 144, 255)')
  await expect(panel.locator('[data-hex="#0090FF"]')).toHaveAttribute('aria-pressed', 'true')

  // The system picker sets any colour.
  await page.getByTestId('colour-picker').fill('#a1b2c3')
  await expect(card.getByTestId('colour-hex')).toHaveText('#A1B2C3')
  expect(await paint(page)).toBe('rgb(161, 178, 195)')
  await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(0)

  // HEX applies once it's a real colour; half-typed text leaves the card alone.
  const hexField = page.getByTestId('colour-hex-input')
  await hexField.fill('#12')
  await expect(hexField).toHaveAttribute('aria-invalid', 'true')
  await expect(card.getByTestId('colour-hex')).toHaveText('#A1B2C3')
  await hexField.fill('f60')
  await expect(card.getByTestId('colour-hex')).toHaveText('#FF6600')

  await page.getByTestId('colour-name-input').fill('Tennis ball')
  await expect(card.getByTestId('colour-name')).toHaveText('Tennis ball')

  // A click on the board closes the panel.
  await clickEmpty(page)
  await expect(panel).toHaveCount(0)

  await waitForSync(page)
  await page.reload()
  await expect(colourCard(page).getByTestId('colour-hex')).toHaveText('#FF6600')
  await expect(colourCard(page).getByTestId('colour-name')).toHaveText('Tennis ball')
  expect(await paint(page)).toBe('rgb(255, 102, 0)')
})

test('Escape closes the panel and keeps the colour; Enter reopens it; one undo takes the edit back', async ({ page }) => {
  const card = await addColourCard(page)
  await expect(card).toHaveClass(/selected/)
  await page.keyboard.press('Enter')
  const panel = page.getByTestId('colour-panel')
  await expect(panel).toBeVisible()
  // Keyboard reaches the presets; Space or Enter picks one.
  await expect(panel.getByTestId('colour-preset').first()).toBeFocused()
  await page.keyboard.press('Space')
  await expect(card.getByTestId('colour-hex')).toHaveText('#E5484D')
  await page.getByTestId('colour-name-input').fill('Collar red')
  // Backspace edits the name, not the board.
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(card).toHaveCount(1)
  await expect(card.getByTestId('colour-name')).toHaveText('Collar re')
  await expect(card.getByTestId('colour-hex')).toHaveText('#E5484D')

  await page.keyboard.press(`${MOD}+z`)
  await expect(card.getByTestId('colour-hex')).toHaveText('#2F5D50')
  await expect(card.getByTestId('colour-name')).toHaveCount(0)
})

async function friend(browser: Browser, owner: Page) {
  const id = owner.url().split('/b/')[1]!
  const grant = await owner.request.post(`/api/boards/${id}/members`, { data: { username: 'fido', permission: 'edit', includeChildren: true } })
  expect(grant.ok(), await grant.text()).toBe(true)
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
  contexts.add(context)
  expect((await context.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  const page = await context.newPage()
  await page.goto(owner.url())
  await expect(page.getByTestId('canvas')).toBeVisible()
  return page
}

test('a new colour reaches someone else on the board', async ({ page, browser }) => {
  const card = await addColourCard(page)
  await waitForSync(page)
  const other = await friend(browser, page)
  await expect(colourCard(other)).toHaveCount(1)

  await page.bringToFront()
  await card.getByTestId('colour-paint').dblclick()
  await page.locator('[data-testid="colour-preset"][data-hex="#8E4EC6"]').click()
  await clickEmpty(page)
  await waitForSync(page)
  await expect(colourCard(other).getByTestId('colour-hex')).toHaveText('#8E4EC6')
})
