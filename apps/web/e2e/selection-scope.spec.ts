import { expect, test, type Locator, type Page } from '@playwright/test'
import { MOD, cardByText, clickEmpty, freshBoard, openCardMenu, postSync, runCardAction } from './helpers.ts'
import { columnFixture } from './column-fixture.ts'
import { boardOf, note, seedCards, setCamera } from './touch.ts'

async function nearby(page: Page, item: Locator) {
  await expect.poll(async () => {
    const b = await page.getByTestId('selection-bar').boundingBox(), c = await item.boundingBox(), canvas = await page.getByTestId('canvas').boundingBox()
    if (!b || !c || !canvas) return false
    const dx = Math.max(c.x - b.x - b.width, b.x - c.x - c.width, 0)
    const dy = Math.max(c.y - b.y - b.height, b.y - c.y - c.height, 0)
    const overlaps = dx === 0 && dy === 0
    return !overlaps && dx + dy <= 78.5 && b.x >= canvas.x && b.y >= canvas.y && b.x + b.width <= canvas.x + canvas.width && b.y + b.height <= canvas.y + canvas.height
  }, { message: 'bar must stay within its 14px gap plus 64px local adjustment' }).toBe(true)
}

for (const theme of ['dark', 'light']) test(`crowded column members keep item-scoped controls nearby in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  const f = await columnFixture(page, 8)
  await page.evaluate((value) => localStorage.setItem('doggynote.theme', value), theme)
  // Tall surrounding columns used to send the collision search far above the selected member.
  await seedCards(page, [
    { type: 'column', x: 390, y: 60, w: 280, content: { title: 'Neighboring column' }, id: `${f.prefix}-neighbor` },
    ...Array.from({ length: 8 }, (_, i) => ({ ...note(`Neighbor ${i}`, 0, 0), columnId: `${f.prefix}-neighbor`, order: i + 1 })),
  ], { x: 0, y: 0 })
  for (const index of [0, 5]) {
    await clickEmpty(page)
    const child = page.locator(`[data-card-id="${f.kids[index]!.id}"]`)
    await child.click()
    await nearby(page, child)
    const bar = page.getByTestId('selection-bar')
    for (const id of ['selection-column-toggle', 'unlock-column-layout', 'labels-button', 'duplicate-selection', 'comment-button', 'bury']) await expect(bar.getByTestId(id)).toHaveCount(0)
    if (index === 0) await f.toggle.click({ trial: true })
  }
  await page.getByTestId('selection-bar').evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)) })
  await page.screenshot({ path: info.outputPath(`crowded-${theme}.png`) })
  // Pan and zoom must recompute the member anchor rather than use saved screen coordinates.
  await setCamera(page, { x: -150, y: -60, zoom: 0.8 })
  const child = page.locator(`[data-card-id="${f.kids[5]!.id}"]`)
  await child.click()
  await nearby(page, child)
  await page.setViewportSize({ width: 680, height: 900 })
  await nearby(page, child)
})

test('right-click preserves a group for labels, duplicate and bury; another card becomes the selection', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('First selected', 160, 220), note('Second selected', 520, 220), note('Leave alone', 160, 480)])
  const a = cardByText(page, 'First selected'), b = cardByText(page, 'Second selected'), other = cardByText(page, 'Leave alone')
  await a.click()
  await b.click({ modifiers: ['Shift'] })
  await openCardMenu(page, b)
  const menu = page.getByTestId('canvas-context-menu')
  await expect(page.locator('.card.selected')).toHaveCount(2)
  await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toBeDisabled()
  await expect(menu.getByRole('menuitem', { name: 'Comment', exact: true })).toBeDisabled()
  await menu.getByRole('menuitem', { name: 'Labels', exact: true }).click()
  await page.getByTestId('labels-input').fill('Together')
  await page.keyboard.press('Enter')
  await expect(a.getByTestId('card-labels')).toHaveText('Together')
  await expect(b.getByTestId('card-labels')).toHaveText('Together')
  await page.keyboard.press('Escape')
  await runCardAction(page, 'Duplicate', b)
  await expect(page.getByTestId('card')).toHaveCount(5)
  await page.keyboard.press(`${MOD}+z`)
  // Undo restores the original group selection.
  await clickEmpty(page)
  await a.click()
  await b.click({ modifiers: ['Shift'] })
  await runCardAction(page, 'Bury', a)
  await expect(page.getByTestId('card')).toHaveCount(1)
  await page.getByTestId('toast-action').click()
  await expect(page.getByTestId('card')).toHaveCount(3)
  await openCardMenu(page, other)
  await expect(page.locator('.card.selected')).toHaveCount(1)
  await expect(other).toHaveClass(/selected/)
  await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toBeEnabled()
})

test('board Rename replaces Edit once, and Archive stays distinct from the selectable bone', async ({ page }, info) => {
  await freshBoard(page)
  const inner = crypto.randomUUID()
  const response = await postSync(page.request, { data: { changes: [{ id: inner, patch: { id: inner, kind: 'board', parentId: boardOf(page), title: 'Bone board', icon: 'bone', color: 'lilac', createdAt: Date.now() } }] } })
  expect(response.ok()).toBe(true)
  await seedCards(page, [{ type: 'board', x: 260, y: 300, content: { boardId: inner } }])
  const card = cardByText(page, 'Bone board'), bar = page.getByTestId('selection-bar')
  await card.click()
  await nearby(page, card)
  await expect(bar.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0)
  await expect(bar.getByRole('button', { name: 'Rename', exact: true })).toHaveCount(0)
  const bone = await bar.locator('[data-icon="bone"]').innerHTML()
  await openCardMenu(page, card)
  const menu = page.getByTestId('canvas-context-menu')
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toHaveCount(1)
  await expect(menu.getByRole('menuitem', { name: 'Edit', exact: true })).toHaveCount(0)
  expect(await menu.locator('[data-icon="bury"]').innerHTML()).not.toBe(bone)
  await page.screenshot({ path: info.outputPath('board-context-actions.png') })
  await menu.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await page.getByTestId('board-title-input').fill('Renamed board')
  await page.keyboard.press('Enter')
  await expect(cardByText(page, 'Renamed board')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('board-name')).toHaveText('Renamed board')
})
