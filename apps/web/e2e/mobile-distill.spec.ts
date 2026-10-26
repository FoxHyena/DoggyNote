import { expect, test } from '@playwright/test'
import { cardByText, freshBoard, postSync, waitForSync } from './helpers.ts'
import { Fingers, note, seedCards, selectionBarFits, tapOn } from './touch.ts'

test('Add uses one aligned compact button grid with three leading cards', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('dock-add').tap()
  const sheet = page.getByTestId('add-sheet')
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => undefined))))
  await expect(sheet.locator('.add-primary button')).toHaveText(['Note', 'To-do', 'Board'])
  await expect(sheet.locator('.add-primary-note')).toHaveCount(1)
  await expect(sheet.getByRole('menuitem')).toHaveCount(16)
  await expect(sheet.getByTestId('add-chat')).toBeVisible()
  for (const width of [page.viewportSize()!.width, 320]) {
    await page.setViewportSize({ width, height: page.viewportSize()!.height })
    // Header, three leading cards, then five rows including Chat, Area, Sketch and Draw.
    expect((await sheet.boundingBox())!.height).toBeLessThanOrEqual(388)
    const boxes = []
    for (const button of await sheet.getByRole('menuitem').all()) {
      const box = (await button.boundingBox())!
      boxes.push(box)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
      expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    for (let i = 3; i < boxes.length; i++) expect(boxes[i].x).toBeCloseTo(boxes[i % 3].x, 0)
    expect(boxes[0].height).toBeCloseTo(boxes[3].height, 0)
    expect(await sheet.getByTestId('add-note').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px')
  }
  await sheet.getByTestId('add-link').tap()
  await expect(page.getByTestId('link-input')).toBeFocused()
})

test('note actions use a compact dock and Colour restores focus on dismissal', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [note('A good walk', 0, 0)])
  await tapOn(page, cardByText(page, 'A good walk'))
  const bar = page.getByTestId('selection-bar')
  await selectionBarFits(page)
  await expect(bar.locator('.selection-phone-actions > button')).toHaveText(['Edit', 'Colour', 'Labels', 'Bury', 'More'])
  await expect(bar.locator('.tint-dots')).toHaveCount(0)
  await page.getByTestId('selection-colour').tap()
  const palette = page.getByTestId('selection-style-sheet')
  expect((await palette.boundingBox())!.height).toBeLessThanOrEqual(185)
  expect((await palette.locator('.tint-dots').boundingBox())!.width).toBeLessThanOrEqual(220)
  expect(await palette.evaluate(el => el.querySelector('.tint-dots')!.getBoundingClientRect().top - el.querySelector('.selection-sheet-head')!.getBoundingClientRect().bottom)).toBeCloseTo(12, 0)
  // 32px dots, each with a 44px+ target around it.
  for (const dot of await palette.locator('.color-dot').all()) {
    expect((await dot.boundingBox())!.height).toBeGreaterThanOrEqual(32)
    expect(await dot.evaluate((el) => el.getBoundingClientRect().height - 2 * parseFloat(getComputedStyle(el, '::after').top))).toBeGreaterThanOrEqual(44)
  }
  await page.getByTestId('swatch-sky').tap()
  await expect(page.getByTestId('swatch-sky')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('selection-style-sheet')).toHaveCount(0)
  await expect(page.getByTestId('selection-colour')).toBeFocused()
  await page.getByTestId('edit-card').tap()
  await expect(page.getByTestId('note-editor')).toBeFocused()
})

test('a board leads with Open and uses its actual colour; Rename and icons live in More', async ({ page }) => {
  await freshBoard(page)
  const parent = page.url().split('/').at(-1)!, child = crypto.randomUUID(), card = crypto.randomUUID()
  const created = await postSync(page.request, { data: { changes: [
    { id: child, patch: { id: child, kind: 'board', parentId: parent, title: 'Weekend walks', icon: 'paw', color: 'ball', createdAt: Date.now() } },
    { id: card, patch: { id: card, kind: 'card', type: 'board', boardId: parent, content: { boardId: child }, color: 'none', x: 20, y: 20, w: 180, h: 120, z: 1, createdAt: Date.now() } },
  ] } })
  expect(created.ok()).toBe(true)
  await page.reload()
  await tapOn(page, cardByText(page, 'Weekend walks'))
  await expect(page.getByTestId('selection-bar').locator('.selection-phone-actions > button')).toHaveText(['Open', 'Colour', 'Labels', 'Bury', 'More'])
  await page.getByTestId('selection-colour').tap()
  await expect(page.getByTestId('swatch-ball')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('swatch-none')).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('selection-style-done').tap()
  await page.getByTestId('selection-more').tap()
  await page.getByTestId('selection-icon').tap()
  await expect(page.getByTestId('selection-more-menu')).toHaveCount(0)
  const icons = page.getByTestId('selection-style-sheet')
  expect((await icons.boundingBox())!.height).toBeLessThanOrEqual(185)
  const selected = icons.getByTestId('icon-paw')
  expect(await icons.evaluate(el => el.querySelector('.icon-choice')!.getBoundingClientRect().top - el.querySelector('.selection-sheet-head')!.getBoundingClientRect().bottom)).toBeCloseTo(12, 0)
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  expect(await selected.evaluate(el => getComputedStyle(el).outlineWidth)).toBe('2px')
  await expect(icons.locator('.icon-choice')).toHaveCount(8)
  for (const choice of await icons.locator('.icon-choice').all()) expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.getByTestId('icon-bone').tap()
  await page.getByTestId('selection-style-done').tap()
  await expect(page.getByTestId('selection-more')).toBeFocused()
  await page.getByTestId('selection-more').tap()
  await page.getByTestId('rename-board').tap()
  const title = page.getByTestId('board-title-input')
  await expect(title).toBeFocused()
  await title.fill('Sunday walks')
  await page.keyboard.press('Enter')
  await waitForSync(page)
  await page.getByTestId('open-board').tap()
  await expect(page.getByTestId('board-name')).toHaveText('Sunday walks')
})

test('phone sharing has one permission control with a touch target', async ({ page }) => {
  const { homeBoardId } = await (await page.request.get('/api/access')).json()
  const id = crypto.randomUUID()
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { id, kind: 'board', parentId: homeBoardId, title: 'Private sharing', icon: 'paw', color: 'gold', createdAt: Date.now() } }] } })).ok()).toBe(true)
  await page.goto(`/#/b/${id}`)
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.getByTestId('share').tap()
  const panel = page.getByTestId('share-panel')
  await expect(panel.getByRole('status')).toHaveCount(0)
  await expect(panel.locator('select')).toHaveCount(1)
  const permission = panel.getByLabel('Invitation permission')
  expect((await permission.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(panel.locator('.share-members, .share-list')).toHaveCount(0)
  await expect(panel).not.toContainText('Private until')
  await expect(panel).not.toContainText('Leave this off')
  const field = (await permission.boundingBox())!, container = (await panel.boundingBox())!
  expect(field.x - container.x).toBeGreaterThanOrEqual(16)
  expect(container.x + container.width - field.x - field.width).toBeGreaterThanOrEqual(16)
  for (const width of [page.viewportSize()!.width, 320]) {
    await page.setViewportSize({ width, height: page.viewportSize()!.height })
    const geometry = await permission.evaluate(el => {
      const control = el.getBoundingClientRect(), caret = el.nextElementSibling!.getBoundingClientRect()
      const label = el.closest('label')!.firstElementChild!.getBoundingClientRect()
      const css = getComputedStyle(el)
      return { width: control.width, gap: control.left - label.right,
        centreDifference: Math.abs((control.top + control.bottom - label.top - label.bottom) / 2),
        insetDifference: Math.abs(control.right - caret.right - parseFloat(css.paddingLeft) - parseFloat(css.borderLeftWidth)) }
    })
    expect(geometry.width).toBeLessThanOrEqual(128)
    expect(geometry.gap).toBeGreaterThanOrEqual(12)
    expect(geometry.centreDifference).toBeLessThanOrEqual(1)
    expect(geometry.insetDifference).toBeLessThanOrEqual(1)
  }
  await permission.selectOption('edit')
  await expect(page.getByTestId('share-allow-signup')).toBeVisible()
  expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(520)
  await expect(panel.getByText('Sign-in required. Accept within 7 days; access continues until removed.')).toBeVisible()
  await page.getByTestId('create-share').tap()
  await expect(page.getByTestId('share-link')).toContainText('Can edit')
})


test('links use the same primary Edit action and More dismisses back to its trigger', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [{ type: 'link', x: 0, y: 0, w: 260, content: { url: 'https://example.com/walks', title: 'Walking routes', status: 'ok' } }])
  await tapOn(page, page.locator('[data-type="link"] .link-host'))
  await page.getByTestId('selection-more').tap()
  await page.getByRole('menuitem', { name: 'Close card actions' }).tap()
  await expect(page.getByTestId('selection-more')).toBeFocused()
  await page.getByTestId('edit-card').tap()
  await expect(page.getByTestId('link-input')).toBeFocused()
})


for (const kind of ['colour', 'icon', 'more'] as const) {
  test(`${kind} sheet retains grip cancellation, dismissal and selection focus after integration`, async ({ page }) => {
    await freshBoard(page)
    await page.getByTestId('dock-add').tap()
    await page.getByTestId('add-board').tap()
    const title = page.getByTestId('board-title-input')
    await title.fill('Sheet gestures')
    await title.press('Enter')
    const trigger = page.getByTestId(kind === 'colour' ? 'selection-colour' : 'selection-more')
    await trigger.tap()
    if (kind === 'icon') await page.getByTestId('selection-icon').tap()
    const sheet = page.getByTestId(kind === 'more' ? 'selection-more-menu' : 'selection-style-sheet')
    await expect(sheet).toBeVisible()
    await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => undefined))))
    const top = (await sheet.boundingBox())!.y
    const point = async () => {
      const box = (await sheet.getByTestId('sheet-grip').boundingBox())!
      return { x: box.x + box.width / 2, y: box.y + 12 }
    }
    const finger = new Fingers(page)
    let at = await point()
    await finger.press(0, at)
    await finger.move(0, { ...at, y: at.y + 100 })
    await finger.cancel()
    await expect.poll(async () => (await sheet.boundingBox())!.y).toBeCloseTo(top, 0)
    await expect(sheet).toBeVisible()
    at = await point()
    await finger.press(0, at)
    await finger.move(0, { ...at, y: at.y + 120 })
    await page.waitForTimeout(150)
    await finger.release(0)
    await expect(sheet).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page.locator('.card.selected')).toHaveCount(1)
    await selectionBarFits(page)
  })
}
