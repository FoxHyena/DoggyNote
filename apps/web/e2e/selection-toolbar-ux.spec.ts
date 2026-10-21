import { expect, test } from '@playwright/test'
import { MOD, addNote, cards, clickEmpty, freshBoard, waitForSync } from './helpers.ts'

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
  for (const id of ['position-lock', 'labels-button', 'duplicate-selection', 'note-copies', 'focus-note', 'comment-button', 'bury']) {
    await expect(bar.getByTestId(id)).toHaveAttribute('data-tip', /.+/)
    await expect(bar.getByTestId(id)).toHaveText('')
  }
  const box = (await bar.boundingBox())!
  const action = (await bar.getByTestId('bury').boundingBox())!
  expect(box.height).toBeLessThan(action.height * 2)
  // One item can't be aligned, so the align icons stay out of the way.
  await expect(page.getByTestId('align-selection')).toHaveCount(0)

  await first.dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.press('Escape')
  await clickEmpty(page)

  await first.dblclick()
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(cards(page)).toHaveCount(1)
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
})

test('double-clicking a sketch opens it instead of dropping a note on it', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-sketch').click()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('toolbar', { name: 'Drawing tools' }) })
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const sketch = page.locator('[data-type="sketch"]')
  await expect(sketch.getByRole('button', { name: 'Edit sketch' })).toHaveCount(0)
  await clickEmpty(page)
  await sketch.dblclick()
  await expect(editor).toBeVisible()
  await expect(cards(page)).toHaveCount(1)
})

test('Draw and Sketch tools have different icons', async ({ page }) => {
  await freshBoard(page)
  const icon = (id: string) => page.getByTestId(id).locator('svg').innerHTML()
  expect(await icon('tool-draw')).not.toBe(await icon('tool-sketch'))
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

test('a sketch is named inside its editor; the card shows the title only once set', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-sketch').click()
  const editor = page.getByTestId('stroke-editor')
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  const sketch = page.locator('[data-type="sketch"]')
  await expect(sketch.locator('.sketch-caption')).toHaveCount(0)
  await sketch.getByTestId('sketch-paper').dblclick()
  await editor.getByRole('textbox', { name: 'Sketch title' }).fill('Storyboard opener')
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(sketch.getByRole('textbox', { name: 'Sketch title' })).toHaveValue('Storyboard opener')
  await waitForSync(page)
  await page.reload()
  await expect(sketch.getByRole('textbox', { name: 'Sketch title' })).toHaveValue('Storyboard opener')
})

test('drawing tools and stroke widths are icon buttons', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-draw').click()
  const tools = page.getByRole('toolbar', { name: 'Drawing tools' })
  for (const name of ['Pen', 'Highlighter', 'Eraser', 'Fine', 'Medium', 'Bold']) await expect(tools.getByRole('button', { name, exact: true })).toHaveText('')
  await expect(tools.getByRole('combobox')).toHaveCount(0)
  await tools.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(tools.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true')
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

test('note copies and labels open as dropdowns under their buttons', async ({ page }) => {
  await freshBoard(page)
  const note = await addNote(page, 'Copy me', 0.4, 0.5)
  await clickEmpty(page)
  await note.click()
  await page.getByTestId('note-copies').click()
  const menu = page.getByRole('dialog', { name: 'Note copies' })
  await expect(menu).toBeVisible()
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0)
  const anchor = (await page.getByTestId('note-copies').boundingBox())!
  const box = (await menu.boundingBox())!
  expect(Math.abs(box.y - (anchor.y + anchor.height)) < 12 || Math.abs(box.y + box.height - anchor.y) < 12).toBe(true)
  await page.getByTestId('create-independent-copy').click()
  await expect(menu).toHaveCount(0)
  await expect(cards(page)).toHaveCount(2)

  await clickEmpty(page)
  await note.click()
  await page.getByTestId('labels-button').click()
  const labels = page.getByRole('dialog', { name: 'Labels' })
  await expect(labels.locator('select')).toHaveCount(0)
  await labels.getByLabel('Label name', { exact: true }).fill('Warm light')
  await labels.getByRole('group', { name: 'New label colour' }).getByRole('button', { name: 'Gold' }).click()
  await labels.getByLabel('Label name', { exact: true }).press('Enter')
  await expect(note.locator('.label-chip')).toHaveText('Warm light')
  // Typing an existing label filters to it; Enter toggles it off.
  await labels.getByLabel('Label name', { exact: true }).fill('warm')
  await expect(labels.getByLabel('Apply Warm light', { exact: true })).toBeVisible()
  await labels.getByLabel('Label name', { exact: true }).fill('Warm light')
  await labels.getByLabel('Label name', { exact: true }).press('Enter')
  await expect(note.locator('.label-chip')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(labels).toHaveCount(0)
})

test('the sketch editor keeps its actions in the header, closes on an outside click and goes full screen', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-sketch').click()
  const editor = page.getByTestId('stroke-editor')
  await expect(editor).toBeVisible()
  const header = editor.locator('.ink-heading')
  for (const name of ['Undo', 'Redo', 'Fit', 'Full screen', 'Done']) await expect(header.getByRole('button', { name, exact: true })).toHaveText('')
  await expect(editor.getByRole('button', { name: /Hide|Show/ })).toHaveCount(0)
  const small = (await editor.boundingBox())!
  await header.getByRole('button', { name: 'Full screen', exact: true }).click()
  const viewport = page.viewportSize()!
  await expect.poll(async () => Math.round((await editor.boundingBox())!.width)).toBe(viewport.width)
  expect(small.width).toBeLessThan(viewport.width)
  await header.getByRole('button', { name: 'Exit full screen', exact: true }).click()
  // Paper colour: a preset, then reload keeps it.
  await editor.getByRole('button', { name: 'Light grey paper', exact: true }).click()
  await expect(editor.getByTestId('ink-surface')).toHaveCSS('background-color', 'rgb(237, 237, 234)')
  await page.mouse.click(4, viewport.height / 2)
  await expect(editor).toHaveCount(0)
  const paper = page.locator('[data-type="sketch"]').getByTestId('sketch-paper')
  await expect(paper).toHaveCSS('background-color', 'rgb(237, 237, 234)')
  await waitForSync(page)
  await page.reload()
  await expect(paper).toHaveCSS('background-color', 'rgb(237, 237, 234)')
})

test('a colour card opens the system colour picker from its preview', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-swatch').click()
  const picker = page.getByTestId('swatch-color-picker')
  await expect(picker).toHaveAttribute('type', 'color')
  await picker.fill('#336699')
  await expect(page.getByTestId('swatch-hex-input')).toHaveValue('#336699')
})

test('a label is renamed inline in its row; Escape cancels just the rename', async ({ page }) => {
  await freshBoard(page)
  const note = await addNote(page, 'Rename label', 0.4, 0.5)
  await clickEmpty(page)
  await note.click()
  await page.getByTestId('labels-button').click()
  const menu = page.getByRole('dialog', { name: 'Labels' })
  await menu.getByLabel('Label name', { exact: true }).fill('Draft')
  await menu.getByLabel('Label name', { exact: true }).press('Enter')
  await menu.getByLabel('Rename Draft', { exact: true }).click()
  const field = menu.getByLabel('New name for Draft', { exact: true })
  await expect(field).toBeFocused()
  await field.press('Escape')
  await expect(menu).toBeVisible()
  await expect(field).toHaveCount(0)
  await menu.getByLabel('Rename Draft', { exact: true }).click()
  await field.fill('Final')
  await field.press('Enter')
  await expect(note.locator('.label-chip')).toHaveText('Final')
  await expect(menu.getByRole('button', { name: 'Save name' })).toHaveCount(0)
})

test('a colour card edits in a panel beside it, not a full-screen dialog', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-swatch').click()
  const panel = page.getByRole('dialog', { name: 'Edit color' })
  await expect(panel).toBeVisible()
  await expect(page.locator('.color-editor-backdrop, .dialog-backdrop')).toHaveCount(0)
  await page.getByTestId('swatch-hex-input').fill('#123456')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  const card = page.locator('[data-type="swatch"]')
  await expect(card.getByTestId('swatch-value')).toHaveText('#123456')
  await clickEmpty(page)
  await card.dblclick()
  await expect(panel).toBeVisible()
})
