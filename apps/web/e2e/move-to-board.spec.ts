import { expect, test, type Page } from '@playwright/test'
import { cardByText, freshBoard, MOD, openCardMenu, postSync, pullAllObjects, runCardAction, setAccountAppearance, waitForSync } from './helpers.ts'
import { moveFixture } from './move-board-fixture.ts'
import { boardOf, setCamera } from './touch.ts'

const picker = (page: Page) => page.getByTestId('move-board-picker')
async function chooseDestination(page: Page, title = 'Move destination') {
  await page.getByTestId('move-board-search').fill(title)
  await page.getByTestId('move-board-result').filter({ hasText: title }).first().click()
}
async function dragToBoard(page: Page, release = true) {
  const a = (await cardByText(page, 'Move first idea').boundingBox())!, target = (await page.locator('[data-type="board"] .board-tile').boundingBox())!
  await page.mouse.move(a.x + 30, a.y + 20); await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await expect(page.getByTestId('board-drop-target')).toBeVisible()
  if (release) await page.mouse.up()
}

test.beforeEach(async ({ page }) => { await freshBoard(page); await moveFixture(page) })

test('right-click moves the selected group, keeps this board open, persists, and undoes in one step', async ({ page, context }) => {
  const source = boardOf(page)
  await cardByText(page, 'Move first idea').click()
  await cardByText(page, 'Move second idea').click({ modifiers: ['Shift'] })
  await openCardMenu(page, cardByText(page, 'Move first idea'))
  await expect(page.locator('[data-testid="card"].selected')).toHaveCount(2)
  await page.getByTestId('move-to-board').click()
  await expect(picker(page)).toBeVisible()
  await expect(page.getByTestId('move-board-search')).toBeFocused()
  await chooseDestination(page)
  await expect(cardByText(page, 'Move first idea')).toHaveCount(0)
  await expect(cardByText(page, 'Move second idea')).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText('Moved 2 items to Move destination')
  expect(boardOf(page)).toBe(source)
  await waitForSync(page)
  const { objects } = await pullAllObjects(page.request)
  const moved = objects.filter((o: { content?: { md?: string } }) => o.content?.md?.startsWith('Move '))
  const onTarget = moved.filter((o: { boardId: string }) => o.boardId !== source)
  const target = onTarget.find((o: { content?: { md?: string } }) => o.content?.md === 'Move first idea')?.boardId
  expect(target).toBeTruthy()
  const second = await context.newPage()
  await second.goto(`/#/b/${target}`); await waitForSync(second)
  await expect(cardByText(second, 'Move first idea')).toBeVisible()
  await second.close()
  await page.keyboard.press(`${MOD}+z`)
  await expect(cardByText(page, 'Move first idea')).toBeVisible()
  await expect(cardByText(page, 'Move second idea')).toBeVisible()
  await waitForSync(page); await page.reload()
  await expect(cardByText(page, 'Move first idea')).toBeVisible()
})

test('an unselected right-click moves only that item; cancel restores focus; selection More opens the picker', async ({ page }) => {
  const first = cardByText(page, 'Move first idea'), second = cardByText(page, 'Move second idea')
  await first.click(); await runCardAction(page, 'Move to board…', second)
  await expect(second).toHaveClass(/selected/); await expect(first).not.toHaveClass(/selected/)
  await page.keyboard.press('Escape'); await expect(picker(page)).toHaveCount(0); await expect(second).toBeFocused()
  await page.getByTestId('selection-more').click(); await page.getByTestId('move-to-board').click()
  await chooseDestination(page)
  await expect(second).toHaveCount(0); await expect(first).toBeVisible()
})

test('new board naming is cancellable and creation plus moving has one Undo', async ({ page }) => {
  const first = cardByText(page, 'Move first idea')
  await runCardAction(page, 'Move to board…', first)
  await page.getByTestId('move-board-new').click()
  await expect(picker(page).getByRole('button', { name: 'Create and move' })).toBeDisabled()
  await page.getByTestId('move-board-name').fill('Collected ideas')
  await page.keyboard.press('Escape')
  await expect(first).toBeVisible(); await expect(page.getByTestId('board-title').filter({ hasText: 'Collected ideas' })).toHaveCount(0)
  await runCardAction(page, 'Move to board…', first)
  await page.getByTestId('move-board-new').click(); await page.getByTestId('move-board-name').fill('Collected ideas')
  await picker(page).getByRole('button', { name: 'Create and move' }).click()
  await expect(first).toHaveCount(0); await expect(page.getByTestId('board-title').filter({ hasText: 'Collected ideas' })).toBeVisible()
  await page.keyboard.press(`${MOD}+z`)
  await expect(first).toBeVisible(); await expect(page.getByTestId('board-title').filter({ hasText: 'Collected ideas' })).toHaveCount(0)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(first).toHaveCount(0)
})

test('many destinations stay bounded, local newest boards lead, search reveals all matches and supports keys', async ({ page }) => {
  const source = boardOf(page), prefix = `Search ${crypto.randomUUID().slice(0, 6)}`
  const changes = Array.from({ length: 35 }, (_, i) => { const id = crypto.randomUUID(); return { id, patch: { id, kind: 'board', parentId: source, title: `${prefix} ${String(i).padStart(2, '0')}`, icon: 'paw', color: 'gold', createdAt: Date.now() + i } } })
  const newest = changes.at(-1)!.id, older = changes[0].id
  changes.push(...[newest, older].map((id, i) => { const tile = crypto.randomUUID(); return { id: tile, patch: { id: tile, kind: 'card', type: 'board', boardId: source, x: 900 + i * 160, y: 200, w: 120, h: 120, z: 10 + i, color: 'none', content: { boardId: id }, createdAt: Date.now() } } }) as unknown as typeof changes)
  const res = await postSync(page.request, { data: { changes } }); expect(res.ok(), await res.text()).toBe(true)
  await page.reload(); await waitForSync(page)
  await runCardAction(page, 'Move to board…', cardByText(page, 'Move first idea'))
  await expect(page.getByTestId('move-board-result')).toHaveCount(8)
  await expect(page.getByTestId('move-board-result').first()).toContainText(`${prefix} 34`)
  await page.getByTestId('move-board-search').fill(prefix)
  await expect(page.getByTestId('move-board-result')).toHaveCount(30)
  await picker(page).getByRole('button', { name: 'Show more' }).click()
  await expect(page.getByTestId('move-board-result')).toHaveCount(35)
  await page.getByTestId('move-board-search').fill(`${prefix} 00`)
  await page.keyboard.press('ArrowDown'); await expect(page.getByTestId('move-board-result')).toBeFocused()
  await page.keyboard.press('Enter'); await expect(cardByText(page, 'Move first idea')).toHaveCount(0)
})

test('dragging a group highlights the tile without navigating, then collapses and restores original geometry on Undo', async ({ page }) => {
  const source = boardOf(page), first = cardByText(page, 'Move first idea')
  const before = (await first.boundingBox())!
  await first.click(); await cardByText(page, 'Move second idea').click({ modifiers: ['Shift'] })
  await dragToBoard(page, false)
  await expect(page.getByTestId('board-drop-target')).toContainText('Add 2 items to this board')
  expect(boardOf(page)).toBe(source)
  await page.mouse.up()
  await expect(first).toHaveCount(0); await expect(page.getByTestId('board-drop-target')).toHaveCount(0)
  await expect(page.locator('.board-move-ghost')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+z`); await expect(first).toBeVisible()
  const after = (await first.boundingBox())!
  expect(Math.abs(after.x - before.x)).toBeLessThan(2); expect(Math.abs(after.y - before.y)).toBeLessThan(2)
})

test('moving away, Escape and pointer cancellation clear the target without transferring', async ({ page }) => {
  const first = cardByText(page, 'Move first idea'), before = (await first.boundingBox())!
  await first.click(); await dragToBoard(page, false)
  await page.mouse.move(before.x + 70, before.y + 20, { steps: 6 })
  await expect(page.getByTestId('board-drop-target')).toHaveCount(0)
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(first).toBeVisible()
  expect(Math.abs((await first.boundingBox())!.x - before.x)).toBeLessThan(2)
  await dragToBoard(page, false)
  await page.getByTestId('canvas').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true })
  await page.mouse.up()
  await expect(page.getByTestId('board-drop-target')).toHaveCount(0); await expect(first).toBeVisible()
})

test('low zoom and reduced motion still accept a geometric board drop', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setCamera(page, { x: -100, y: -100, zoom: 0.3 })
  const canvas = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(canvas.x + 70, canvas.y + 85); await page.mouse.down()
  await page.mouse.move(canvas.x + 228, canvas.y + 90, { steps: 10 })
  await expect(page.getByTestId('board-drop-target')).toBeVisible()
  await page.mouse.up()
  await expect(page.getByTestId('toast')).toContainText('Moved 1 item')
  await expect(page.locator('.board-move-ghost')).toHaveCount(0)
})

for (const theme of ['Light', 'Dark'] as const) test(`picker and drag target visual review ${theme}`, async ({ page }, info) => {
  await setAccountAppearance(page, theme)
  await runCardAction(page, 'Move to board…', cardByText(page, 'Move first idea'))
  await expect(picker(page)).toBeVisible()
  await page.screenshot({ path: `../../docs/qa/move-to-board/${info.project.name}-${theme.toLowerCase()}-picker.png` })
  await page.keyboard.press('Escape')
  await dragToBoard(page, false)
  await page.screenshot({ path: `../../docs/qa/move-to-board/${info.project.name}-${theme.toLowerCase()}-target.png` })
  await page.keyboard.press('Escape'); await page.mouse.up()
})

test('the collapse uses inert copies for 220ms and can be inspected at slow speed without changing source layout', async ({ page }, info) => {
  await page.evaluate(() => {
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options)
      if (this.classList.contains('board-move-ghost')) animation.playbackRate = 0.2
      return animation
    }
  })
  await cardByText(page, 'Move first idea').click()
  await dragToBoard(page)
  const ghosts = page.locator('.board-move-ghost')
  await expect(ghosts).toHaveCount(1)
  await expect(ghosts).toHaveAttribute('aria-hidden', 'true')
  const timing = await ghosts.evaluate(el => {
    const animation = el.getAnimations()[0]
    animation.pause(); animation.currentTime = 110
    return { duration: animation.effect!.getTiming().duration, inert: (el as HTMLElement).inert }
  })
  expect(timing).toEqual({ duration: 220, inert: true })
  await page.screenshot({ path: `../../docs/qa/move-to-board/${info.project.name}-collapse-midpoint.png` })
  await ghosts.evaluateAll(els => els.forEach(el => el.getAnimations().forEach(a => a.finish())))
  await expect(ghosts).toHaveCount(0)
})
