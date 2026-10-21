import { expect, test } from '@playwright/test'
import { MOD, addNote, cardByText, cards, clickEmpty, freshBoard } from './helpers.ts'
import { note, seedCards } from './touch.ts'

test.use({ screenshot: 'only-on-failure', trace: 'retain-on-failure' })

test('a click selects a note and shows its icon toolbar; a second click or double-click edits it', async ({ page }) => {
  await freshBoard(page)
  const first = await addNote(page, 'First note', 0.3, 0.4)
  await clickEmpty(page)

  await first.click()
  await expect(first).toHaveClass(/selected/)
  await expect(page.getByTestId('note-editor')).toHaveCount(0)
  const bar = page.getByTestId('selection-bar')
  await expect(bar).toBeVisible()
  // Icons, named for screen readers and tooltips, keep the bar on one row.
  for (const id of ['position-lock', 'duplicate-selection', 'comment-button', 'bury']) {
    await expect(bar.getByTestId(id)).toHaveAttribute('data-tip', /.+/)
    await expect(bar.getByTestId(id)).toHaveText('')
  }
  const box = (await bar.boundingBox())!
  const action = (await bar.getByTestId('bury').boundingBox())!
  expect(box.height).toBeLessThan(action.height * 2)
  // One item can't be aligned, so the align icons stay out of the way.
  await expect(page.getByTestId('align-selection')).toHaveCount(0)

  // A second click on the selected note edits it.
  await first.click()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.press('Escape')
  await clickEmpty(page)

  await first.dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(cards(page)).toHaveCount(1)
})

test('double-clicking a to-do or a column never drops a new note on it', async ({ page }) => {
  await freshBoard(page)
  await seedCards(page, [
    { type: 'todo', x: 0, y: 0, w: 260, content: { title: 'Chores', items: [{ id: 'a', text: 'Walkies', done: false }] } },
    { type: 'column', x: 400, y: 0, w: 280, content: { title: 'Ideas' } },
  ])
  await expect(cards(page)).toHaveCount(2)
  const list = page.locator('[data-type=todo]')
  await list.locator('.todo-text', { hasText: 'Walkies' }).dblclick()
  await expect(page.getByTestId('todo-item-input').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await clickEmpty(page)
  await page.locator('[data-type=column] .column-body').dblclick()
  await expect(page.locator('[data-type=column]')).toHaveClass(/selected/)
  await expect(cards(page)).toHaveCount(2)
})

test('align icons appear only for two or more items and align them', async ({ page }) => {
  await freshBoard(page)
  const a = await addNote(page, 'Left', 0.25, 0.3)
  const b = await addNote(page, 'Right', 0.6, 0.6)
  await clickEmpty(page)
  await a.click()
  await expect(page.getByTestId('align-selection')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+a`)
  const group = page.getByTestId('align-selection')
  await expect(group).toBeVisible()
  await expect(group.getByRole('button')).toHaveCount(6)
  await expect(page.getByRole('button', { name: 'Align top' })).toBeVisible()
  await page.getByTestId('align-top').click()
  await expect.poll(async () => Math.round((await a.boundingBox())!.y) - Math.round((await b.boundingBox())!.y)).toBe(0)
  // One Undo puts both back.
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(async () => Math.round((await a.boundingBox())!.y) - Math.round((await b.boundingBox())!.y)).not.toBe(0)
})

test('the note editor spaces blank lines like the rendered note', async ({ page }) => {
  await freshBoard(page)
  const card = await addNote(page, 'Woop', 0.4, 0.4)
  await card.click()
  await card.click()
  const editor = page.getByTestId('note-editor')
  await expect(editor).toBeVisible()
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.type('\n\nAwooo\n\n- one\n- two')
  await page.keyboard.press('ArrowUp')
  const lines = editor.locator('.cm-line')
  const full = (await lines.nth(0).boundingBox())!.height
  const gap = (await editor.locator('.cm-md-gap').first().boundingBox())!.height
  expect(gap).toBeLessThan(full / 2)
  await page.keyboard.press('Escape')
  // Rendered and editing heights stay close: no doubled gaps while typing.
  const rendered = (await card.boundingBox())!.height
  await card.click()
  await card.click()
  await expect(editor).toBeVisible()
  await page.keyboard.press(`${MOD}+End`)
  expect(Math.abs((await card.boundingBox())!.height - rendered)).toBeLessThan(full * 1.5)
})

test('hovering an icon button shows its tooltip; icon buttons leave no gaps for the pointer', async ({ page }) => {
  await freshBoard(page)
  const note = await addNote(page, 'Tooltip note', 0.4, 0.5)
  await clickEmpty(page)
  await note.click()
  await page.getByTestId('duplicate-selection').hover()
  await expect(page.getByRole('tooltip')).toContainText('Duplicate')
  await page.getByTestId('bury').hover()
  await expect(page.getByRole('tooltip')).toContainText('Bury')
  const dup = (await page.getByTestId('duplicate-selection').boundingBox())!
  const next = (await page.getByTestId('duplicate-selection').locator('xpath=following-sibling::button[1]').boundingBox())!
  expect(next.x - (dup.x + dup.width)).toBeLessThan(1)
  await page.mouse.down()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.mouse.up()
})

test('tooltips appear right over the hovered button', async ({ page }) => {
  await freshBoard(page)
  const note = await addNote(page, 'Tooltip place', 0.4, 0.5)
  await clickEmpty(page)
  await note.click()
  const button = page.getByTestId('comment-button')
  await button.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  await page.waitForTimeout(200)
  const b = (await button.boundingBox())!, t = (await tip.boundingBox())!
  expect(Math.abs((t.x + t.width / 2) - (b.x + b.width / 2))).toBeLessThan(2)
  expect(t.y + t.height).toBeLessThanOrEqual(b.y)
})

test('the bar sits above the selection, below it without room, and at the bottom when a tall selection runs off', async ({ page }) => {
  await freshBoard(page)
  const md = (lines: number) => Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join('\n\n')
  await seedCards(page, [note('Short one', 0, 300), note('Up top', 300, 0), note(md(60), 600, 0)])
  const bar = page.getByTestId('selection-bar')
  const canvas = (await page.getByTestId('canvas').boundingBox())!

  await clickEmpty(page)
  await cardByText(page, 'Short one').click()
  const short = (await cardByText(page, 'Short one').boundingBox())!
  await expect.poll(async () => (await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBeLessThanOrEqual(short.y)

  await clickEmpty(page)
  await cardByText(page, 'Up top').click()
  const top = (await cardByText(page, 'Up top').boundingBox())!
  // Seeded at the top edge: no room above, so the bar goes below.
  expect(top.y - canvas.y).toBeLessThan(60)
  await expect.poll(async () => (await bar.boundingBox())!.y).toBeGreaterThanOrEqual(top.y + top.height)

  await clickEmpty(page)
  const tall = cardByText(page, 'Line 60')
  await tall.click({ position: { x: 30, y: 20 } })
  const tallBox = (await tall.boundingBox())!
  expect(tallBox.y + tallBox.height).toBeGreaterThan(canvas.y + canvas.height)
  await expect.poll(async () => {
    const b = (await bar.boundingBox())!
    return canvas.y + canvas.height - (b.y + b.height)
  }).toBeLessThan(80)
})

test('a column header centres its title and count, and collapse slides', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-column').click()
  await page.keyboard.type('Centred')
  await page.keyboard.press('Escape')
  const column = page.locator('.card-column')
  const head = (await column.locator('.column-head').boundingBox())!
  const title = (await column.getByTestId('column-title').boundingBox())!
  expect(Math.abs((title.x + title.width / 2) - (head.x + head.width / 2))).toBeLessThan(2)
  const expanded = (await column.boundingBox())!.height
  await column.getByTestId('column-toggle').click()
  // The body slides shut before the column shortens.
  expect(await column.getByTestId('column-body').evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0)
  await expect.poll(async () => (await column.boundingBox())!.height).toBeLessThan(expanded)
})
