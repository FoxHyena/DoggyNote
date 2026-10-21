import { expect, test, type Page } from '@playwright/test'
import { cardByText, freshBoard, waitForSync } from './helpers.ts'
import { center, note, seedCards, tapOn, touchDrag } from './touch.ts'

async function toolbarActionsFit(page: Page) {
  await expect.poll(() => page.getByTestId('selection-bar').evaluate((bar) => {
    const box = bar.getBoundingClientRect()
    const buttons = [...bar.querySelectorAll('button')].filter((button) => button.getClientRects().length)
    return buttons.length > 0 && buttons.every((button) => {
      const rect = button.getBoundingClientRect()
      return rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom
        && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
        && button.scrollWidth <= button.clientWidth + 1
    })
  })).toBe(true)
}

test('touch alignment has immediate Undo and position locks survive a new session', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page,[note('First reference',0,0,{w:120}),note('Second reference',155,100,{w:120})])
  const first=cardByText(page,'First reference'), second=cardByText(page,'Second reference')
  const y=()=>second.evaluate((el:HTMLElement)=>parseFloat(el.style.top))
  await tapOn(page,first)
  await toolbarActionsFit(page)
  await page.getByTestId('position-lock').tap()
  await page.getByTestId('selection-more').tap(); await page.getByTestId('select-more').tap(); await tapOn(page,second)
  await expect(page.locator('.card.selected')).toHaveCount(2)
  await toolbarActionsFit(page)
  const align=page.getByTestId('align-top')
  const control=(await align.boundingBox())!, toolbar=(await page.getByTestId('selection-bar').boundingBox())!
  expect(control.height).toBeGreaterThanOrEqual(44)
  expect(control.x).toBeGreaterThanOrEqual(toolbar.x)
  expect(control.x+control.width).toBeLessThanOrEqual(toolbar.x+toolbar.width)
  await expect(page.getByTestId('selection-bar').getByRole('status')).toHaveText('1 locked')
  await align.tap()
  expect(await y()).toBe(0)
  await page.getByTestId('toast-action').tap()
  expect(await y()).toBe(100)
  await page.getByTestId('position-lock').tap()
  await expect(page.getByTestId('position-lock')).toHaveAccessibleName('Unlock position')
  await expect(page.getByTestId('align-selection')).toHaveCount(0)
  await page.getByTestId('selection-done').tap()
  await tapOn(page,first)
  const point=await center(first)
  const before=await first.evaluate((el:HTMLElement)=>({x:el.style.left,y:el.style.top}))
  await touchDrag(page,point,{x:point.x+50,y:point.y+40})
  expect(await first.evaluate((el:HTMLElement)=>({x:el.style.left,y:el.style.top}))).toEqual(before)
  await expect(first.getByTestId('resize-handle')).toHaveCount(0)
  await waitForSync(page); await page.reload(); await tapOn(page,first)
  await expect(page.getByTestId('position-lock')).toHaveAccessibleName('Unlock position')
  await page.getByTestId('position-lock').tap()
  await expect(first.getByTestId('resize-handle')).toBeVisible()
})
