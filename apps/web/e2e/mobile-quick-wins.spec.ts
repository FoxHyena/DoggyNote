import { expect, test } from '@playwright/test'
import { cardByText, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'
import { boardOf, note, seedCards, selectionMore, tapOn } from './touch.ts'

// Quick wins on a phone: Move to board… from the selection's More sheet, and
// Distribute in the same sheet. The "?" shortcut sheet stays off phones.

test('Move to board on a phone: More → a bottom sheet of boards, then Go to', async ({ page }) => {
  await freshBoard(page)
  const source = boardOf(page)
  const target = crypto.randomUUID(), title = `Puppy class ${target.slice(0, 6)}`
  expect((await postSync(page.request, { data: { changes: [{ id: target, patch: { id: target, kind: 'board', parentId: 'home', title, icon: 'ball', color: 'ball', createdAt: Date.now() } }] } })).ok()).toBe(true)
  const [first, second] = await seedCards(page, [note('Sit and stay', 0, 0, { w: 160 }), note('Leave it', 0, 120, { w: 160 })])
  const comment = crypto.randomUUID()
  expect((await postSync(page.request, { data: { changes: [{ id: comment, patch: { id: comment, kind: 'comment', boardId: source, cardId: first, text: 'Week one', createdAt: Date.now() } }] } })).ok()).toBe(true)

  await tapOn(page, cardByText(page, 'Sit and stay'))
  await selectionMore(page)
  await page.getByTestId('move-to-board').tap()
  const sheet = page.getByTestId('move-board-popover')
  await expect(sheet).toBeVisible()
  // A bottom sheet the width of the screen, with finger-sized rows.
  const box = (await sheet.boundingBox())!, view = page.viewportSize()!
  expect(box.width).toBeGreaterThanOrEqual(view.width - 2)
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(view.height - 2)
  const option = sheet.locator(`[data-board-id="${target}"]`)
  await expect(option).toBeVisible()
  expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await page.getByTestId('move-board-input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  await option.tap()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId('toast')).toContainText(`Moved 1 card to ${title}`)
  await expect(cardByText(page, 'Sit and stay')).toHaveCount(0)
  await expect(cardByText(page, 'Leave it')).toBeVisible()
  await waitForSync(page)
  const objs = new Map((await pullAllObjects(page.request)).objects.map((o: { id: string }) => [o.id, o as Record<string, unknown>]))
  expect(objs.get(first!)!.boardId).toBe(target)
  expect(objs.get(comment)!.boardId).toBe(target)
  expect(objs.get(second!)!.boardId).toBe(source)

  await page.getByTestId('toast-action').tap()
  await expect(page.getByTestId('board-name')).toHaveText(title)
  await expect(cardByText(page, 'Sit and stay')).toBeVisible()
})

test('Distribute sits in the phone More sheet for three cards; no shortcut sheet on phones', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('A', 0, 0, { w: 80 }), note('B', 100, 0, { w: 80 }), note('C', 300, 0, { w: 60 })])
  const xs = () => Promise.all(['A', 'B', 'C'].map((t) => cardByText(page, t).evaluate((el: HTMLElement) => parseFloat(el.style.left))))
  const start = await xs()
  await tapOn(page, cardByText(page, 'A'), { x: 20, y: 16 })
  await selectionMore(page)
  await page.getByTestId('select-more').tap()
  await tapOn(page, cardByText(page, 'B'), { x: 20, y: 16 })
  await tapOn(page, cardByText(page, 'C'), { x: 20, y: 16 })
  await expect(page.locator('.card.selected')).toHaveCount(3)
  await selectionMore(page)
  const distribute = page.getByTestId('distribute-horizontal')
  await expect(distribute).toBeVisible()
  expect((await distribute.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await distribute.tap()
  await expect.poll(xs).toEqual([start[0], 150, start[2]])
  await page.getByTestId('toast-action').tap()
  await expect.poll(xs).toEqual(start)

  await page.getByTestId('selection-done').tap()
  await page.getByTestId('account').tap()
  await expect(page.locator('.account-popover')).toBeVisible()
  await expect(page.getByTestId('open-shortcuts')).toHaveCount(0)
})
