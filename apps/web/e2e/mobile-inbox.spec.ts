import { expect, test } from '@playwright/test'
import { cardByText, freshBoard, waitForSync } from './helpers.ts'
import { touchDrag } from './touch.ts'

// Quick capture on a phone: jot into the Inbox with a button, place it on a
// board with a tap, and things shared from other apps land there too.

const uniq = (s: string) => `${s} ${Math.random().toString(36).slice(2, 7)}`

test('jot into the Inbox with Add, then Place it on the board', async ({ page }) => {
  await freshBoard(page)
  const text = uniq('Buy kibble')
  await page.getByTestId('toybox-button').tap()
  await expect(page.getByTestId('toybox-add')).toBeDisabled()
  await page.getByTestId('toybox-input').fill(text)
  await page.getByTestId('toybox-add').tap()
  const item = page.getByTestId('toybox-item').filter({ hasText: text })
  await expect(item).toBeVisible()
  await expect(page.getByTestId('toybox-input')).toHaveValue('')
  await item.getByTestId('toybox-place').tap()
  await expect(item).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(cardByText(page, text)).toBeVisible()
})

test('the Inbox list scrolls with a finger instead of dragging items', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('toybox-button').tap()
  for (let i = 0; i < 12; i++) {
    await page.getByTestId('toybox-input').fill(uniq(`Scroll item ${i}`))
    await page.getByTestId('toybox-add').tap()
  }
  const list = page.locator('.toybox .trash-list')
  const touchAction = await page.getByTestId('toybox-item').first().evaluate((el) => getComputedStyle(el).touchAction)
  expect(touchAction).toBe('pan-y')
  const b = (await list.boundingBox())!
  await touchDrag(page, { x: b.x + 40, y: b.y + b.height - 20 }, { x: b.x + 40, y: b.y + 20 })
  await expect(page.locator('.tool-ghost')).toHaveCount(0)
})

test('a link shared from another app lands in the Inbox', async ({ page }) => {
  await freshBoard(page)
  const url = `https://example.com/${uniq('walkies').replace(' ', '-')}`
  await page.goto(`/share?title=${encodeURIComponent('Walk route')}&text=${encodeURIComponent(`Look ${url}`)}`)
  await expect(page.getByTestId('toybox-panel')).toBeVisible()
  await expect(page.getByTestId('toast')).toContainText('Fetched!')
  await expect(page.getByTestId('toybox-item').filter({ hasText: url.split('//')[1].split('/')[0] }).first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
  await waitForSync(page)
})

test('the home-screen shortcut opens the Inbox', async ({ page }) => {
  await freshBoard(page)
  await page.goto('/?inbox=1')
  await expect(page.getByTestId('toybox-panel')).toBeVisible()
  expect(page.url()).not.toContain('inbox=1')
})

test('quick capture has a Save button on the web', async ({ page }) => {
  await page.goto('/#/capture')
  const text = uniq('Captured on the go')
  await page.getByTestId('capture-input').fill(text)
  await page.getByTestId('capture-save').tap()
  await expect(page.getByTestId('capture-status')).toContainText('Saved')
  await expect(page.getByTestId('capture-open')).toBeVisible()
})
