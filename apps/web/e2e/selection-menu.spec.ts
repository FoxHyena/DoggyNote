import { runCardAction } from './helpers.ts'
import { expect, test, type Locator } from '@playwright/test'
import { at, cardByText, freshBoard, MOD } from './helpers.ts'
import { note, seedCards, setCamera } from './touch.ts'

async function clearOf(panel: Locator, cards: Locator[]) {
  await expect.poll(async () => {
    const p = await panel.boundingBox()
    if (!p) return false
    for (const card of cards) {
      const c = await card.boundingBox()
      if (c && p.x < c.x + c.width && p.x + p.width > c.x && p.y < c.y + c.height && p.y + p.height > c.y) return false
    }
    return true
  }, { message: 'floating controls cover card content' }).toBe(true)
}

test('selection actions flip below a neighbour, then labels stay clear as their panel grows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await freshBoard(page)
  await seedCards(page, [note('Keep the neighbour readable', 300, 175), note('Label this idea', 300, 260)])
  const selected = cardByText(page, 'Label this idea'), neighbour = cardByText(page, 'Keep the neighbour readable')
  await selected.click()
  const bar = page.getByTestId('selection-bar')
  await clearOf(bar, [selected, neighbour])
  expect((await bar.boundingBox())!.y).toBeGreaterThan((await selected.boundingBox())!.y)
  await runCardAction(page, 'Labels')
  const panel = page.getByTestId('labels-popover')
  await clearOf(panel, [selected, neighbour])
  await page.getByTestId('labels-input').fill('Weekend')
  await clearOf(panel, [selected, neighbour])
  await page.getByTestId('labels-input').press('Enter')
  await expect(selected.getByTestId('card-labels')).toHaveText('Weekend')
  await clearOf(panel, [selected, neighbour])
  await page.keyboard.press('Escape')
  await expect(selected).toBeFocused()
})

test('crowded actions find an offset when both above and below contain cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await freshBoard(page)
  await seedCards(page, [note('Above', 400, 175), note('Picked', 400, 260), note('Below', 400, 340)])
  const selected = cardByText(page, 'Picked')
  await selected.click()
  await clearOf(page.getByTestId('selection-bar'), [selected, cardByText(page, 'Above'), cardByText(page, 'Below')])
})

test('card context actions support arrows, Escape, editing, duplication, labels, comments and bury undo', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Right click idea', 260, 240)])
  const card = cardByText(page, 'Right click idea'), menu = page.getByTestId('canvas-context-menu')
  const open = () => card.click({ button: 'right', position: { x: 30, y: 20 } })
  await open()
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)
  await expect(menu.getByRole('menuitem')).toHaveText(['Edit', 'Duplicate', 'Labels', 'Comment', 'Bury'])
  // Menus share the migrated icon family and Bury uses Archive, distinct from permanent deletion.
  await expect(menu.locator('svg')).toHaveCount(5)
  for (const name of ['edit', 'duplicate', 'label', 'comment', 'bury']) {
    const icon = menu.locator(`svg[data-icon="${name}"]`)
    await expect(icon).toHaveAttribute('viewBox', '0 0 256 256')
    await expect(icon).toHaveAttribute('aria-hidden', 'true')
    await expect(icon.locator('path')).not.toHaveCount(0)
  }
  await expect(menu.locator('svg svg')).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'Bury', exact: true })).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(card).toBeFocused()
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await open()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.type(' edited')
  await page.keyboard.press('Escape')
  await open()
  await menu.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByTestId('card')).toHaveCount(2)
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByTestId('card')).toHaveCount(1)
  await open()
  await menu.getByRole('menuitem', { name: 'Labels', exact: true }).click()
  await expect(page.getByTestId('labels-input')).toBeFocused()
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await clearOf(page.getByTestId('labels-popover'), [card])
  await page.getByTestId('labels-input').fill('Context label')
  await page.keyboard.press('Enter')
  await expect(card.getByTestId('card-labels')).toHaveText('Context label')
  await page.keyboard.press('Escape')
  await expect(card).toBeFocused()
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await open()
  await menu.getByRole('menuitem', { name: 'Comment', exact: true }).click()
  await expect(page.getByTestId('comments-panel')).toBeVisible()
  await page.getByTestId('comments-close').click()
  await open()
  await menu.getByRole('menuitem', { name: 'Bury', exact: true }).click()
  await expect(card).toHaveCount(0)
  await page.getByTestId('toast-action').click()
  await expect(card).toBeVisible()
})

test('solo empty canvas preserves the native menu and outside clicks dismiss card actions', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Outside click', 260, 240)])
  await page.getByTestId('collaborators').click()
  await expect(page.getByTestId('live-status')).toHaveText('Live')
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.addEventListener('contextmenu', (event) => {
    document.documentElement.dataset.contextPrevented = String(event.defaultPrevented)
  }))
  const p = await at(page, 0.9, 0.85)
  await page.mouse.click(p.x, p.y, { button: 'right' })
  await expect(page.locator('html')).toHaveAttribute('data-context-prevented', 'false')
  await expect(page.getByTestId('canvas-context-menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  const card = cardByText(page, 'Outside click')
  await card.click({ button: 'right' })
  await expect(page.getByTestId('canvas-context-menu')).toBeVisible()
  await page.locator('.topbar').click({ position: { x: 430, y: 20 } })
  await expect(page.getByTestId('canvas-context-menu')).toHaveCount(0)
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await page.mouse.click(p.x, p.y)
  await expect(card).not.toHaveClass(/selected/)
})

test('a card can be right-clicked in the low-detail overview', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('Overview card', 0, 0)])
  await setCamera(page, { x: -600, y: -450, zoom: 0.3 })
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.click(canvas.x + 195, canvas.y + 140, { button: 'right' })
  await expect(page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Edit', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('canvas')).toBeFocused()
})


test('form controls retain native menus while to-do text opens card actions', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [{ type: 'todo', x: 260, y: 240, content: { title: 'Packing', items: [{ id: 'snacks', text: 'Bring snacks', done: false }] } }])
  await page.evaluate(() => document.addEventListener('contextmenu', (event) => {
    document.documentElement.dataset.contextPrevented = String(event.defaultPrevented)
  }))
  await page.getByRole('checkbox', { name: 'Bring snacks' }).click({ button: 'right' })
  await expect(page.locator('html')).toHaveAttribute('data-context-prevented', 'false')
  await expect(page.getByTestId('canvas-context-menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('.todo-title', { hasText: 'Packing' }).click({ button: 'right' })
  await expect(page.getByTestId('canvas-context-menu').getByRole('menuitem', { name: 'Edit', exact: true })).toBeFocused()
})
