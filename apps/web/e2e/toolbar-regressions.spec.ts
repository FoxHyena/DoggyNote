import { expect, test } from '@playwright/test'
import { addNote, at, cardByText, cards, freshBoard } from './helpers.ts'

test.beforeEach(async ({ page }) => { await freshBoard(page) })

test('Backspace edits the board title and never buries a selected card', async ({ page }) => {
  await addNote(page, 'Keep me')
  await page.keyboard.press('Escape')
  await cardByText(page, 'Keep me').click()
  await expect(cardByText(page, 'Keep me')).toHaveClass(/selected/)

  await page.getByTestId('board-name').click()
  const input = page.getByTestId('board-name-input')
  await input.fill('Doghouse')
  await input.press('End')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
  await page.keyboard.type('Kennel')
  await expect(input).toHaveValue('DogKennel')
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('board-name')).toHaveText('DogKennel')
  await expect(cardByText(page, 'Keep me')).toBeVisible()
})

test('a tool dragged from a scrolling toolbar stays visible over the board', async ({ page }) => {
  // Short enough that the toolbar scrolls, which used to clip the drag chip to it.
  await page.setViewportSize({ width: 1280, height: 560 })
  const toolbar = page.locator('aside.toolbar')
  expect(await toolbar.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

  const before = await cards(page).count()
  const from = (await page.getByTestId('tool-note').boundingBox())!
  const to = await at(page, 0.5, 0.5)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })

  const ghost = page.locator('.tool-ghost')
  await expect(ghost).toBeVisible()
  // The chip ignores the pointer; let it be hit for a moment so hit-testing shows
  // whether it is really painted on top at the cursor, not clipped to the toolbar.
  const shown = await page.evaluate(({ x, y }) => {
    const el = document.querySelector<HTMLElement>('.tool-ghost')!
    el.style.pointerEvents = 'auto'
    const hit = !!document.elementFromPoint(x, y)?.closest('.tool-ghost')
    el.style.pointerEvents = ''
    return { hit, inToolbar: !!el.closest('.toolbar') }
  }, to)
  expect(shown).toEqual({ hit: true, inToolbar: false })

  await page.mouse.up()
  await expect(ghost).toHaveCount(0)
  await expect(cards(page)).toHaveCount(before + 1)
})
