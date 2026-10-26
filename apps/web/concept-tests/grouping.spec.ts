import { test, expect } from '@playwright/test'
import path from 'node:path'

const capture = (name: string) => path.resolve(`.impeccable/review/grouping-${name}.png`)

test.beforeEach(async ({ page }) => { await page.goto('/concepts.html') })

test('edits and column membership carry between all concepts and survive reload', async ({ page }) => {
  const title = page.getByRole('textbox', { name: 'Note title: Somewhere by the coast', exact: true })
  await title.fill('A cabin in the woods')
  await title.press('Tab')
  await page.getByRole('button', { name: 'Board sections', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Note title: A cabin in the woods', exact: true })).toHaveValue('A cabin in the woods')
  await page.getByRole('combobox', { name: 'Group for Ideas in Weekend away', exact: true }).selectOption('home')
  await page.getByRole('button', { name: 'Focus tabs', exact: true }).click()
  await page.getByRole('navigation', { name: 'Project groups' }).getByRole('button', { name: /Home projects/ }).click()
  await expect(page.getByRole('textbox', { name: 'Note title: A cabin in the woods', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Canvas areas', exact: true }).click()
  await page.getByRole('textbox', { name: 'Loose context note' }).fill('Remember the picnic blanket.')
  await page.getByRole('textbox', { name: 'Loose context note' }).press('Tab')
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Loose context note' })).toHaveValue('Remember the picnic blanket.')
  await expect(page.locator('[data-group="home"] [data-note="coast"]')).toBeAttached()
  await page.getByRole('button', { name: 'Reset sample board' }).click()
  await expect(page.locator('[data-group="weekend"] [data-note="coast"]')).toBeAttached()
})

test('area and column dragging retain their pointer target; tidy restores column positions', async ({ page }) => {
  const group = page.locator('[data-group="weekend"]')
  const header = group.getByRole('button', { name: 'Drag Weekend away area' })
  const box = (await header.boundingBox())!
  await page.mouse.move(box.x + 12, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + 102, box.y + 72, { steps: 10 })
  await page.mouse.up()
  await expect(group).toHaveCSS('left', '126px')
  await expect(group).toHaveCSS('top', '100px')
  const column = group.locator('.gp-column').first()
  const cb = (await column.getByRole('button', { name: 'Drag Ideas column in Weekend away' }).boundingBox())!
  await page.mouse.move(cb.x + 12, cb.y + 12)
  await page.mouse.down()
  await page.mouse.move(cb.x + 32, cb.y + 42, { steps: 8 })
  await page.mouse.up()
  await expect(column).toHaveCSS('left', '20px')
  await expect(column).toHaveCSS('top', '42px')
  await group.getByRole('button', { name: 'Tidy', exact: true }).click()
  await expect(column).toHaveCSS('left', '0px')
  await expect(column).toHaveCSS('top', '0px')
})

test('collapse, add, rename, and empty groups remain usable', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse Weekend away', exact: true }).click()
  await expect(page.locator('[data-group="weekend"] .gp-columns')).toHaveCount(0)
  await page.getByLabel('Add to Weekend away', { exact: true }).click()
  await page.locator('[data-group="weekend"] .gp-add-options').getByRole('button', { name: 'Column', exact: true }).click()
  const column = page.getByRole('textbox', { name: 'Column name: New stage in Weekend away', exact: true })
  await column.fill('Someday')
  await column.press('Tab')
  await expect(page.getByText('A little room for what’s next.', { exact: true })).toBeVisible()
  const last = page.locator('[data-group="weekend"] .gp-column').last()
  await last.getByRole('button', { name: 'Add note', exact: true }).click()
  await expect(last.getByRole('textbox', { name: 'Note title: New note', exact: true })).toBeVisible()
  for (const label of ['Ideas', 'Planning', 'Ready', 'Someday']) {
    await page.getByRole('combobox', { name: `Group for ${label} in Weekend away`, exact: true }).selectOption('home')
  }
  await expect(page.getByText('No columns here yet.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add a column', exact: true }).click()
  await expect(page.locator('[data-group="weekend"] .gp-column')).toHaveCount(1)
})

test('three concept compositions in both themes', async ({ page }, info) => {
  await page.setViewportSize({ width: 1512, height: 1000 })
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click()
    for (const [id, title] of [['areas', 'Canvas areas'], ['sections', 'Board sections'], ['tabs', 'Focus tabs']]) {
      await page.getByRole('button', { name: title, exact: true }).click()
      await expect(page.locator(`.gp-${id}`)).toBeVisible()
      await page.screenshot({ path: capture(`${info.project.name}-${id}-${theme}-desktop`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  }
  expect(await page.evaluate(() => localStorage.getItem('doggynote.theme'))).toBeNull()
})

test('phone retains readable columns, scrolls within the board, and exposes controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const [id, title] of [['areas', 'Canvas areas'], ['sections', 'Board sections'], ['tabs', 'Focus tabs']]) {
    await page.getByRole('button', { name: title, exact: true }).click()
    await page.screenshot({ path: capture(`${info.project.name}-${id}-phone`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  }
  await page.getByRole('navigation', { name: 'Project groups' }).getByRole('button', { name: /Home projects/ }).click()
  await expect(page.getByRole('textbox', { name: 'Note title: A proper reading corner', exact: true })).toBeVisible()
})

test('planning arrows follow moved columns and areas and collapse to area boundaries', async ({ page }, info) => {
  await expect(page.locator('.gp-area-connections > path')).toHaveCount(4)
  const arrow = page.locator('[data-arrow="trip-flow-1"]')
  await expect(arrow).toHaveAttribute('d', /^M/)
  const before = await arrow.getAttribute('d')
  const handle = page.getByRole('button', { name: 'Drag Ideas column in Weekend away' })
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 12, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + 32, box.y + 52, { steps: 8 })
  await page.mouse.up()
  await expect(arrow).not.toHaveAttribute('d', before!)
  await page.getByRole('button', { name: 'Add arrow', exact: true }).click()
  await expect(page.locator('.gp-area-connections > path')).toHaveCount(5)
  await page.screenshot({ path: capture(`${info.project.name}-arrows-connected`), fullPage: true })
  await page.getByRole('button', { name: 'Collapse Weekend away', exact: true }).click()
  await expect(page.locator('[data-arrow="trip-flow-1"]')).toHaveCount(0)
  await expect(page.locator('.gp-area-connections > path')).toHaveCount(3)
  await page.screenshot({ path: capture(`${info.project.name}-arrows-collapsed`), fullPage: true })
  await page.getByRole('button', { name: 'Hide arrows', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Project planning arrows' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show arrows', exact: true }).click()
  await expect(page.locator('.gp-area-connections > path')).toHaveCount(3)
})

test('arrows between supporting items and stages persist and can be removed', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Arrow from', exact: true }).selectOption('item:context')
  await page.getByRole('combobox', { name: 'Arrow to', exact: true }).selectOption('column:trip-plan')
  await page.getByRole('button', { name: 'Add arrow', exact: true }).click()
  await expect(page.locator('.gp-area-connections > path')).toHaveCount(5)
  await page.getByRole('button', { name: 'Add arrow', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('That arrow already exists.')
  await page.reload()
  await expect(page.locator('.gp-area-connections > path')).toHaveCount(5)
  await page.getByText('5 saved arrows', { exact: true }).click()
  await page.getByRole('button', { name: 'Remove arrow from A note to ourselves to Planning', exact: true }).click()
  await expect(page.locator('.gp-area-connections > path')).toHaveCount(4)
  await page.reload()
  await expect(page.locator('.gp-area-connections > path')).toHaveCount(4)
})

test('free items move with their area, collapse together, and can move to another area', async ({ page }) => {
  const area = page.locator('[data-group="weekend"]')
  const item = area.locator('[data-item="context"]')
  await item.scrollIntoViewIfNeeded()
  const original = (await item.boundingBox())!
  const handle = page.getByRole('button', { name: 'Drag Weekend away area' })
  await handle.scrollIntoViewIfNeeded()
  const itemBeforeDrag = (await item.boundingBox())!
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 12, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + 72, box.y + 42, { steps: 8 })
  await page.mouse.up()
  const moved = (await item.boundingBox())!
  expect(moved.x - itemBeforeDrag.x).toBeCloseTo(60)
  expect(moved.y - itemBeforeDrag.y).toBeCloseTo(30)
  expect(original.width).toBeGreaterThan(200)
  await page.getByRole('button', { name: 'Collapse Weekend away', exact: true }).click()
  await expect(item).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand Weekend away', exact: true }).click()
  await page.getByRole('combobox', { name: 'Area for A note to ourselves', exact: true }).selectOption('home')
  await expect(page.locator('[data-group="home"] [data-item="context"]')).toBeAttached()
  await page.reload()
  await expect(page.locator('[data-group="home"] [data-item="context"]')).toBeAttached()
})

test('areas accept notes, interactive checklists, safe references, and local images', async ({ page }, info) => {
  const area = page.locator('[data-group="weekend"]')
  const add = async (name: string) => {
    await page.getByLabel('Add to Weekend away', { exact: true }).click()
    await area.locator('.gp-add-options').getByRole('button', { name, exact: true }).click()
  }
  await add('Note')
  const note = area.locator('.gp-area-item').last()
  await expect(note.getByRole('textbox', { name: 'Area item title: New area note', exact: true })).toBeVisible()
  await note.getByRole('textbox', { name: 'Area item text: New area note', exact: true }).fill('A useful detail to keep beside the project.')
  await note.getByRole('textbox', { name: 'Area item text: New area note', exact: true }).press('Tab')
  await add('Checklist')
  await page.getByRole('checkbox', { name: 'Complete First task', exact: true }).check()
  await expect(page.getByRole('checkbox', { name: 'Complete First task', exact: true })).toBeChecked()
  await add('Link')
  const link = area.locator('.gp-area-item').last()
  await link.getByRole('textbox', { name: 'Reference URL: New reference', exact: true }).fill('javascript:alert(1)')
  await link.getByRole('textbox', { name: 'Reference URL: New reference', exact: true }).press('Tab')
  await expect(link.getByRole('link', { name: 'Open reference' })).toHaveCount(0)
  await link.getByRole('textbox', { name: 'Reference URL: New reference', exact: true }).fill('https://example.com/project')
  await link.getByRole('textbox', { name: 'Reference URL: New reference', exact: true }).press('Tab')
  await expect(link.getByRole('link', { name: 'Open reference' })).toHaveAttribute('href', 'https://example.com/project')
  await page.getByLabel('Image for Weekend away', { exact: true }).setInputFiles(path.resolve('../desktop/src-tauri/icons/128x128.png'))
  await expect(area.getByRole('img', { name: 'Image reference', exact: true })).toBeVisible()
  await page.screenshot({ path: capture(`${info.project.name}-mixed-items-added`), fullPage: true })
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Complete First task', exact: true })).toBeChecked()
  await expect(area.getByRole('img', { name: 'Image reference', exact: true })).toBeAttached()
})

test('a freely placed note can move independently and its arrow follows', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Arrow from', exact: true }).selectOption('item:context')
  await page.getByRole('combobox', { name: 'Arrow to', exact: true }).selectOption('column:trip-plan')
  await page.getByRole('button', { name: 'Add arrow', exact: true }).click()
  const arrow = page.locator('.gp-area-connections > path').last()
  await expect(arrow).toHaveAttribute('d', /^M/)
  const oldPath = await arrow.getAttribute('d')
  const handle = page.getByRole('button', { name: 'Drag A note to ourselves item' })
  await handle.scrollIntoViewIfNeeded()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 12, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + 68, box.y + 32, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('[data-item="context"]')).toHaveCSS('left', '72px')
  await expect(page.locator('[data-item="context"]')).toHaveCSS('top', '440px')
  await expect(arrow).not.toHaveAttribute('d', oldPath!)
  await page.reload()
  await expect(page.locator('[data-item="context"]')).toHaveCSS('left', '72px')
})

test('upgrading an earlier playground save preserves user content', async ({ page }) => {
  const title = page.getByRole('textbox', { name: 'Note title: Somewhere by the coast', exact: true })
  await title.fill('A saved project idea')
  await title.press('Tab')
  await page.evaluate(() => {
    const key = 'doggynote.grouping-concepts.v1'
    const groups = JSON.parse(localStorage.getItem(key)!)
    for (const group of groups) delete group.items
    localStorage.setItem(key, JSON.stringify(groups))
    localStorage.setItem(`${key}.context`, 'A context note from the earlier prototype.')
  })
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Note title: A saved project idea', exact: true })).toHaveValue('A saved project idea')
  await expect(page.getByRole('textbox', { name: 'Loose context note' })).toHaveValue('A context note from the earlier prototype.')
  await expect(page.locator('[data-group="weekend"] .gp-area-item')).toHaveCount(3)
})
