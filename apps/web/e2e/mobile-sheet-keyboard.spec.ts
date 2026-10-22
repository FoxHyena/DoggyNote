import { expect, test, type Locator, type Page } from '@playwright/test'
import { freshBoard } from './helpers.ts'
import { note, seedCards, tapOn } from './touch.ts'

// A phone sheet with a text field rides on the on-screen keyboard: the field you
// are typing in and the button that confirms it stay above the keys, the sheet
// scrolls inside itself, and the page never scrolls.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

/** The keyboard, as the browser reports it: a shorter visual viewport (as mobile-pwa.spec.ts does). */
async function raiseKeyboard(page: Page, keys = 320) {
  await page.evaluate((keys) => {
    Object.defineProperty(visualViewport!, 'height', { configurable: true, value: innerHeight - keys })
    visualViewport!.dispatchEvent(new Event('resize'))
  }, keys)
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--vv-height'))).toBe(`${await page.evaluate((k) => innerHeight - k, keys)}px`)
}

/** Fully on screen and above the keyboard's top edge. */
async function aboveKeyboard(target: Locator) {
  await expect.poll(() => target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const keysTop = visualViewport!.offsetTop + visualViewport!.height
    return r.height > 0 && r.top >= 0 && r.bottom <= keysTop + 0.5 ? 'ok' : `top ${Math.round(r.top)} bottom ${Math.round(r.bottom)}, keyboard at ${Math.round(keysTop)}`
  })).toBe('ok')
}

test('the label menu sits on the keyboard: the field and Create stay in view', async ({ page }) => {
  await seedCards(page, [note('Walkies at 5', 0, 0)])
  await tapOn(page, page.locator('[data-testid="card"]', { hasText: 'Walkies at 5' }))
  await page.getByTestId('labels-button').tap()
  const input = page.getByTestId('labels-input')
  // Focused in the tap itself, so iOS raises the keyboard.
  await expect(input).toBeFocused()
  await raiseKeyboard(page)
  await page.keyboard.type('Park day')
  await expect(page.getByTestId('label-create')).toBeVisible()
  await aboveKeyboard(input)
  await aboveKeyboard(page.getByTestId('label-create'))
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await page.getByTestId('label-create').tap()
  await expect(page.locator('[data-testid="card"]', { hasText: 'Walkies at 5' })).toContainText('Park day')
  expect(await page.evaluate(() => scrollY)).toBe(0)
})

test('the share sheet sits on the keyboard: the username field and Invite stay in view', async ({ page }) => {
  await page.getByTestId('share').tap()
  const form = page.getByTestId('share-member-form')
  const field = form.locator('input').first()
  await field.tap()
  await expect(field).toBeFocused()
  await raiseKeyboard(page)
  await aboveKeyboard(field)
  await aboveKeyboard(form.locator('button').last())
  expect(await page.evaluate(() => scrollY)).toBe(0)
})
