import { inkBounds } from '@doggynote/core'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { MOD, camera, dragBy, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

test.use({ screenshot: 'only-on-failure', trace: 'retain-on-failure' })

const sketch = (page: Page) => page.locator('[data-type="sketch"]').last()
const editor = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('toolbar', { name: 'Drawing tools' }) })

/** Real pointer input, never a fixture stroke: the editor owns coordinate conversion. */
async function mark(page: Page, from = { x: .2, y: .3 }, to = { x: .75, y: .65 }) {
  const surface = editor(page).getByTestId('ink-surface')
  const box = await surface.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box!.x + box!.width * from.x, box!.y + box!.height * from.y)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * to.x, box!.y + box!.height * to.y, { steps: 14 })
  await page.mouse.up()
}
async function create(page: Page) {
  await page.getByTestId('tool-sketch').click()
  await expect(editor(page)).toBeVisible()
}
async function done(page: Page) {
  await editor(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
}

test('sketch creates, draws, finishes, reopens and recovers from trash with editable strokes', async ({ page }, info) => {
  await freshBoard(page, 'Sketch storyboard task')
  // Keep only UI transition metadata, never typed content, URLs or credentials.
  // This distinguishes a stale title blur from an ancestor loading boundary.
  await page.evaluate(() => {
    const events: unknown[] = []
    Object.assign(window, { sketchTransitions: events })
    const capture = (event: string, target?: EventTarget | null) => {
      const element = target instanceof Element ? target : document.activeElement
      events.push({ event, at: performance.now(), target: element?.tagName, label: element?.getAttribute('aria-label'), editor: !!document.querySelector('[data-testid="stroke-editor"]'), loader: !!document.querySelector('[data-testid="loader"]'), height: (document.querySelector('[data-type="sketch"]') as HTMLElement | null)?.offsetHeight })
      if (events.length > 200) events.shift()
    }
    for (const name of ['focusin', 'focusout', 'click']) document.addEventListener(name, (event) => capture(name, event.target), true)
    let previous = ''
    new MutationObserver(() => {
      const state = `${!!document.querySelector('[data-testid="stroke-editor"]')}:${!!document.querySelector('[data-testid="loader"]')}`
      if (state !== previous) { previous = state; capture('editor/loader change') }
    }).observe(document.body, { childList: true, subtree: true })
  })
  await create(page)
  await mark(page)
  await editor(page).getByRole('button', { name: 'Highlighter', exact: true }).click()
  await mark(page, { x: .2, y: .7 }, { x: .8, y: .7 })
  await done(page)
  await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(2)
  const envelopeHeight = await sketch(page).evaluate((element) => (element as HTMLElement).offsetHeight)
  // No title yet, so the card shows none; it's named inside the editor.
  await expect(sketch(page).getByRole('textbox', { name: 'Sketch title' })).toHaveCount(0)
  await sketch(page).getByTestId('sketch-paper').dblclick()
  await editor(page).getByTestId('sketch-title-field').fill('Opening frame — a long descriptive storyboard title')
  await done(page)
  await sketch(page).getByTestId('sketch-paper').dblclick()
  try { await expect(editor(page)).toBeVisible() }
  finally {
    const transitions = await page.evaluate(() => (window as Window & { sketchTransitions?: unknown[] }).sketchTransitions)
    await info.attach('sketch-title-editor-transitions', { body: JSON.stringify(transitions, null, 2), contentType: 'application/json' })
  }
  await expect.poll(() => sketch(page).evaluate((element) => (element as HTMLElement).offsetHeight)).toBe(envelopeHeight)
  await mark(page, { x: .5, y: .2 }, { x: .5, y: .8 })
  await done(page)
  await waitForSync(page)
  const id = await sketch(page).getAttribute('data-card-id')
  await page.reload()
  const card = page.locator(`[data-card-id="${id}"]`)
  await expect(card.locator('[data-stroke-id]')).toHaveCount(3)
  await expect(card.getByRole('textbox', { name: 'Sketch title' })).toHaveValue('Opening frame — a long descriptive storyboard title')
  await card.getByTestId('sketch-paper').click()
  await page.keyboard.press('Backspace')
  await expect(card).toHaveCount(0)
  await page.getByTestId('tool-trash').click()
  await page.getByTestId('trash-panel').getByRole('button', { name: /restore|dig/i }).first().click()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(3)
  await card.getByTestId('sketch-paper').dblclick()
  await expect(editor(page)).toBeVisible()
  await done(page)
})

test('resizing changes the bounded envelope without modifying drawing coordinates and Undo restores geometry', async ({ page }) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page); await waitForSync(page)
  const card = sketch(page)
  const id = await card.getAttribute('data-card-id')
  const before = (await pullAllObjects(page.request)).objects.filter((o: { kind: string; cardId?: string }) => o.kind === 'stroke' && o.cardId === id)
  const initial = await card.boundingBox()
  await card.getByTestId('sketch-paper').click()
  await dragBy(page, card.getByTestId('resize-handle'), 150, 50)
  await expect.poll(async () => (await card.boundingBox())!.width).toBeGreaterThan(initial!.width + 80)
  await expect(card.locator('.ink-layer')).toHaveAttribute('viewBox', '0 0 320 240')
  await expect(card.locator('.ink-layer')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
  await waitForSync(page)
  const after = (await pullAllObjects(page.request)).objects.filter((o: { kind: string; cardId?: string }) => o.kind === 'stroke' && o.cardId === id)
  expect(after).toEqual(before)
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBe(Math.round(initial!.width))
  await expect.poll(async () => Math.round((await card.boundingBox())!.height)).toBe(Math.round(initial!.height))
})

test('completed sketch strokes survive controlled offline editing and reconnect', async ({ page, context }) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page); await waitForSync(page)
  await context.setOffline(true)
  await sketch(page).getByTestId('sketch-paper').dblclick()
  await mark(page, { x: .1, y: .8 }, { x: .9, y: .8 })
  await done(page)
  await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(2)
  await context.setOffline(false)
  await waitForSync(page); await page.reload()
  await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(2)
})

test('sketch moves into a column with stable height and editable marks', async ({ page }) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page)
  const card = sketch(page)
  const id = await card.getAttribute('data-card-id')
  await page.getByTestId('tool-column').click()
  await page.getByTestId('column-title-input').fill('Storyboard frames')
  await page.getByTestId('column-title-input').press('Enter')
  const column = page.locator('[data-type="column"]')
  const from = await card.getByTestId('sketch-paper').boundingBox()
  const to = await column.getByTestId('column-body').boundingBox()
  await page.mouse.move(from!.x + 20, from!.y + 20); await page.mouse.down()
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 15, { steps: 20 }); await page.mouse.up()
  const nested = column.locator(`[data-card-id="${id}"]`)
  await expect(nested).toBeVisible()
  await expect(nested.locator('[data-stroke-id]')).toHaveCount(1)
  const height = await nested.evaluate((el) => (el as HTMLElement).offsetHeight)
  await waitForSync(page)
  await expect.poll(() => nested.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(height)
  await nested.getByTestId('sketch-paper').dblclick()
  await mark(page, { x: .2, y: .8 }, { x: .8, y: .2 }); await done(page); await waitForSync(page)
  await page.reload()
  await expect(column.locator(`[data-card-id="${id}"] [data-stroke-id]`)).toHaveCount(2)
})

test('empty sketches remain reopenable and Escape cancels only an active gesture', async ({ page }) => {
  await freshBoard(page)
  await create(page); await done(page)
  await expect(sketch(page)).toHaveCount(1)
  await sketch(page).getByTestId('sketch-paper').dblclick()
  await mark(page)
  const box = await editor(page).getByTestId('ink-surface').boundingBox()
  await page.mouse.move(box!.x + 30, box!.y + 30); await page.mouse.down()
  await page.mouse.move(box!.x + 70, box!.y + 60, { steps: 4 })
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(editor(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)
  await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(1)
  await page.keyboard.press(`${MOD}+z`)
  await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(1)
})

test('local read-only sharing displays marks without drawing controls or mutations', async ({ page, browser }) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page); await waitForSync(page)
  await page.getByTestId('share').click()
  const panel = page.getByTestId('share-panel')
  await panel.getByTestId('create-share').click()
  const url = await panel.getByTestId('share-url').first().inputValue()
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const viewer = await context.newPage(); await viewer.goto(url)
    await expect(viewer.getByTestId('viewer')).toBeVisible()
    await expect(sketch(viewer).locator('[data-stroke-id]')).toHaveCount(1)
    await expect(viewer.getByRole('button', { name: 'Edit sketch' })).toHaveCount(0)
    await expect(viewer.getByRole('textbox', { name: 'Sketch title' })).toHaveCount(0)
    await sketch(viewer).getByTestId('sketch-paper').dblclick()
    await expect(editor(viewer)).toHaveCount(0)
    await viewer.keyboard.press('Enter')
    await expect(editor(viewer)).toHaveCount(0)
  } finally { await context.close() }
})


test('PNG export includes bounded editable marks and omits editor controls', async ({ page }) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page); await waitForSync(page)
  const box = await sketch(page).boundingBox()
  await page.getByTestId('board-more').click()
  await page.getByTestId('export').click()
  await page.getByTestId('export-scale-1').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-go').click()
  const file = await download
  const png = await readFile((await file.path())!)
  const result = await page.evaluate(async (base64) => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let inkPixels = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 1] < 90 && pixels[i + 2] < 110 && pixels[i + 3] > 200) inkPixels++
    return { width: img.width, height: img.height, inkPixels }
  }, png.toString('base64'))
  // Camera is 100% on this fresh board; only the sketch envelope plus 32px padding.
  expect(result.width).toBe(Math.ceil(box!.width + 64))
  expect(result.height).toBe(Math.ceil(box!.height + 64))
  expect(result.inkPixels).toBeGreaterThan(100)
})

test('authorized concurrent sketch additions merge and one-session Undo preserves the other addition', async ({ page, browser }) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page); await waitForSync(page)
  const context = await browser.newContext({ storageState: await page.context().storageState() })
  try {
    const other = await context.newPage(); await other.goto(page.url())
    await expect(sketch(other).locator('[data-stroke-id]')).toHaveCount(1)
    await sketch(page).getByTestId('sketch-paper').dblclick()
    await sketch(other).getByTestId('sketch-paper').dblclick()
    await mark(page, { x: .2, y: .15 }, { x: .8, y: .15 })
    await mark(other, { x: .2, y: .85 }, { x: .8, y: .85 })
    await done(page); await done(other)
    await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(3, { timeout: 15000 })
    await expect(sketch(other).locator('[data-stroke-id]')).toHaveCount(3, { timeout: 15000 })
    await sketch(page).getByTestId('sketch-paper').click()
    await page.keyboard.press(`${MOD}+z`)
    await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(2)
    await expect(sketch(other).locator('[data-stroke-id]')).toHaveCount(2, { timeout: 15000 })
    await waitForSync(page); await page.reload()
    await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(2)
  } finally { await context.close() }
})

test('locked sketch resists layout changes while drawing and title edits remain available', async ({ page }) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page)
  const card = sketch(page)
  await card.getByTestId('sketch-paper').click()
  await page.getByTestId('position-lock').click()
  const before = await card.boundingBox()
  await dragBy(page, card.getByTestId('sketch-paper'), 100, 50)
  expect(await card.boundingBox()).toEqual(before)
  await expect(card.getByTestId('resize-handle')).toHaveCount(0)
  await card.getByTestId('sketch-paper').dblclick()
  await mark(page, { x: .1, y: .8 }, { x: .9, y: .8 })
  await editor(page).getByTestId('sketch-title-field').fill('Locked storyboard reference')
  // Keep the field active: checkpoints must persist before blur/Done/native close.
  await waitForSync(page); await page.reload()
  await expect(card.getByRole('textbox', { name: 'Sketch title' })).toHaveValue('Locked storyboard reference')
  await expect(card.locator('[data-stroke-id]')).toHaveCount(2)
  await card.getByTestId('sketch-paper').click()
  await expect(page.getByTestId('position-lock')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('position-lock').click()
  await dragBy(page, card.getByTestId('sketch-paper'), 100, 50)
  await expect.poll(async () => (await card.boundingBox())!.x).toBeGreaterThan(before!.x + 50)
})

test('duplicating a sketch creates an independently editable alternative and one Undo removes its whole copy', async ({ page }) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page); await waitForSync(page)
  const source = sketch(page)
  const id = await source.getAttribute('data-card-id')
  await source.getByTestId('sketch-paper').click()
  await page.getByTestId('duplicate-selection').click()
  await expect(page.locator('[data-type="sketch"]')).toHaveCount(2)
  const copy = page.locator(`[data-type="sketch"]:not([data-card-id="${id}"])`)
  const original = page.locator(`[data-card-id="${id}"]`)
  const originalStroke = await original.locator('[data-stroke-id]').getAttribute('data-stroke-id')
  await expect(copy.locator('[data-stroke-id]')).toHaveCount(1)
  expect(await copy.locator('[data-stroke-id]').getAttribute('data-stroke-id')).not.toBe(originalStroke)
  await page.keyboard.press(`${MOD}+z`)
  await expect(copy).toHaveCount(0)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(copy.locator('[data-stroke-id]')).toHaveCount(1)
  await copy.getByTestId('sketch-paper').dblclick()
  await mark(page, { x: .2, y: .8 }, { x: .8, y: .8 }); await done(page); await waitForSync(page)
  await expect(copy.locator('[data-stroke-id]')).toHaveCount(2)
  await expect(original.locator('[data-stroke-id]')).toHaveCount(1)
  await page.reload()
  await expect(copy.locator('[data-stroke-id]')).toHaveCount(2)
  await expect(original.locator('[data-stroke-id]')).toHaveCount(1)
})

test('Undo preserves an independent sketch copy after another session adds a mark', async ({ page, browser }) => {
  await freshBoard(page, 'Collaborative sketch alternative')
  await create(page); await mark(page); await done(page); await waitForSync(page)
  const originalId = (await sketch(page).getAttribute('data-card-id'))!
  await sketch(page).getByTestId('sketch-paper').click()
  await page.getByTestId('duplicate-selection').click()
  const copyId = (await sketch(page).getAttribute('data-card-id'))!
  expect(copyId).not.toBe(originalId)
  await waitForSync(page)
  const context = await browser.newContext({ storageState: await page.context().storageState() })
  try {
    const other = await context.newPage(); await other.goto(page.url())
    const peerCopy = other.locator(`[data-card-id="${copyId}"]`)
    await expect(peerCopy.locator('[data-stroke-id]')).toHaveCount(1)
    await peerCopy.getByTestId('sketch-paper').dblclick()
    await mark(other, { x: .2, y: .85 }, { x: .8, y: .85 })
    await done(other); await waitForSync(other)
    const copy = page.locator(`[data-card-id="${copyId}"]`)
    await expect(copy.locator('[data-stroke-id]')).toHaveCount(2, { timeout: 15000 })
    await copy.getByTestId('sketch-paper').click()
    await page.keyboard.press(`${MOD}+z`)
    await expect(page.getByText('Cannot undo because this item changed or is no longer editable.', { exact: true })).toBeVisible()
    await expect(copy.locator('[data-stroke-id]')).toHaveCount(2)
    await expect(page.locator(`[data-card-id="${originalId}"] [data-stroke-id]`)).toHaveCount(1)
    await waitForSync(page); await page.reload()
    await expect(copy.locator('[data-stroke-id]')).toHaveCount(2)
  } finally { await context.close() }
})

test('three storyboard frames remain editable through a saved personal layout', async ({ page }) => {
  await freshBoard(page, 'Loop10 storyboard source')
  const sourceUrl = page.url()
  for (let i = 1; i <= 3; i++) {
    await create(page)
    await mark(page, { x: .2, y: .2 }, { x: .7, y: .2 + .15 * i })
    await editor(page).getByTestId('sketch-title-field').fill(`Frame ${i}`)
    await done(page)
  }
  await waitForSync(page)
  const layout = `Storyboard layout ${Date.now()}`
  await page.getByTestId('board-more').click(); await page.getByTestId('save-template').click()
  await page.getByTestId('template-name').fill(layout)
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0); await waitForSync(page)
  await page.getByTestId('board-more').click(); await page.getByTestId('open-templates').click()
  await page.getByTestId('personal-template').filter({ hasText: layout }).click()
  await page.getByTestId('template-name').fill('Independent storyboard draft')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Independent storyboard draft')
  await expect(page.locator('[data-type="sketch"]')).toHaveCount(3)
  await expect(page.locator('[data-type="sketch"] [data-stroke-id]')).toHaveCount(3)
  await page.locator('[data-type="sketch"]').first().getByTestId('sketch-paper').dblclick()
  await mark(page, { x: .2, y: .8 }, { x: .8, y: .8 }); await done(page); await waitForSync(page)
  await expect(page.locator('[data-type="sketch"] [data-stroke-id]')).toHaveCount(4)
  await page.goto(sourceUrl); await page.reload()
  await expect(page.locator('[data-type="sketch"] [data-stroke-id]')).toHaveCount(3)
})

test('sketch eraser removes a stroke, Undo restores it and highlighter opacity remains editable', async ({ page }) => {
  await freshBoard(page)
  await create(page); await mark(page)
  await editor(page).getByRole('button', { name: 'Highlighter', exact: true }).click()
  await mark(page, { x: .2, y: .8 }, { x: .8, y: .8 }); await done(page)
  const card = sketch(page)
  await expect(card.locator('[stroke-opacity="0.3"]')).toHaveCount(1)
  await card.getByTestId('sketch-paper').dblclick()
  await editor(page).getByRole('button', { name: 'Eraser', exact: true }).click()
  await mark(page, { x: .4, y: .43 }, { x: .5, y: .49 })
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(1)
  await editor(page).getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(2)
  await editor(page).getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(1)
  await done(page); await waitForSync(page); await page.reload()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
  await expect(card.locator('[stroke-opacity="0.3"]')).toHaveCount(1)
})

test('a selected sketch inside a column exports alone without changing the live layout', async ({ page }, testInfo) => {
  await freshBoard(page)
  await create(page); await mark(page); await done(page)
  const id = await sketch(page).getAttribute('data-card-id')
  await page.getByTestId('tool-column').click()
  await page.getByTestId('column-title-input').fill('Storyboard export context')
  await page.getByTestId('column-title-input').press('Enter')
  const column = page.locator('[data-type="column"]')
  const from = await sketch(page).getByTestId('sketch-paper').boundingBox()
  const to = await column.getByTestId('column-body').boundingBox()
  await page.mouse.move(from!.x + 20, from!.y + 20); await page.mouse.down()
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 15, { steps: 20 }); await page.mouse.up()
  const nested = column.locator(`[data-card-id="${id}"]`)
  await expect(nested).toBeVisible(); await waitForSync(page)
  const geometry = () => nested.evaluate((el: HTMLElement) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }))
  const before = await geometry()
  await nested.getByTestId('sketch-paper').click()
  await page.getByTestId('board-more').click(); await page.getByTestId('export').click()
  await page.getByTestId('export-scale-1').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-go').click()
  const file = await download
  await file.saveAs(testInfo.outputPath('nested-sketch.png'))
  const png = await readFile((await file.path())!)
  const result = await page.evaluate(async (base64) => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data
    let ink = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 1] < 90 && pixels[i + 2] < 110 && pixels[i + 3] > 200) ink++
    return { w: img.width, h: img.height, ink }
  }, png.toString('base64'))
  expect(result).toMatchObject({ w: before.w + 64, h: before.h + 64 })
  expect(result.ink).toBeGreaterThan(100)
  expect(await geometry()).toEqual(before)
  const saved = (await pullAllObjects(page.request)).objects.find((o: { id: string }) => o.id === id)
  expect(saved.columnId).toBe(await column.getAttribute('data-card-id'))
})

test('a dense sketch stays editable and keeps its marks in the canvas overview', async ({ page }, testInfo) => {
  await freshBoard(page, 'Dense sketch recovery')
  await create(page); await done(page); await waitForSync(page)
  const cardId = (await sketch(page).getAttribute('data-card-id'))!
  const boardId = decodeURIComponent(page.url().split('#/b/')[1]!)
  // Seed an existing long-session document; the edit, Undo and zoom below use real input.
  const marks = Array.from({ length: 200 }, (_, row) => {
    const points = Array.from({ length: 64 }, (_, i) => ({ x: 20 + i * 280 / 63, y: 20 + row + Math.sin(i / 4) * 2 }))
    return { id: crypto.randomUUID(), kind: 'stroke', cardId, boardId, createdAt: Date.now(), tool: 'pen', color: '#D7263D', width: 1.5, opacity: 1, points, order: row, bounds: inkBounds(points, 1.5) }
  })
  const response = await postSync(page.request, { data: { changes: marks.map((patch) => ({ id: patch.id, patch })) } })
  expect(response.ok(), await response.text()).toBe(true)
  await page.reload()
  const card = page.locator(`[data-card-id="${cardId}"]`)
  await expect(card.locator('[data-stroke-id]')).toHaveCount(200)
  await expect(editor(page)).toHaveCount(0)
  await card.getByTestId('sketch-paper').dblclick()
  await expect(editor(page)).toHaveCount(1)
  await mark(page, { x: .2, y: .9 }, { x: .8, y: .9 })
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(201)
  await editor(page).getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(200)
  await done(page); await waitForSync(page)
  await page.keyboard.press(`${MOD}+0`)
  await expect.poll(async () => Math.abs((await camera(page)).zoom - 1)).toBeLessThan(.001)
  for (let i = 0; i < 6; i++) {
    const target = (await camera(page)).zoom * .8
    await page.keyboard.press(`${MOD}+-`)
    await expect.poll(async () => Math.abs((await camera(page)).zoom - target)).toBeLessThan(.001)
  }
  await expect(page.getByTestId('canvas')).toHaveClass(/\blod\b/)
  await expect(page.getByTestId('card')).toHaveCount(0)
  await expect.poll(() => page.getByTestId('lod-layer').evaluate((el: HTMLCanvasElement) => {
    const pixels = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data
    let red = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 1] < 90 && pixels[i + 2] < 110 && pixels[i + 3] > 200) red++
    return red
  })).toBeGreaterThan(100)
  await page.screenshot({ path: testInfo.outputPath('dense-sketch-overview.png') })
  await page.keyboard.press(`${MOD}+0`)
  await expect(card.locator('[data-stroke-id]')).toHaveCount(200)
})

test('Space drag after choosing a tool pans the sketch and Fit preserves logical cursor mapping', async ({ page }) => {
  await freshBoard(page)
  await create(page)
  const viewport = editor(page).getByTestId('ink-viewport')
  await editor(page).getByRole('button', { name: 'Zoom in drawing', exact: true }).click()
  await editor(page).getByRole('button', { name: 'Pen', exact: true }).click()
  const box = await viewport.boundingBox()
  const before = await viewport.evaluate((el) => el.scrollLeft)
  await page.keyboard.down('Space')
  await page.mouse.move(box!.x + box!.width * .7, box!.y + box!.height * .5)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .5, { steps: 10 })
  await page.mouse.up(); await page.keyboard.up('Space')
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(0)
  expect(await viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before)
  await editor(page).getByRole('button', { name: 'Fit', exact: true }).click()
  await mark(page, { x: .25, y: .5 }, { x: .6, y: .5 })
  await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(1)
  const path = (await editor(page).locator('[data-stroke-id]').getAttribute('d'))!.match(/^M (\S+) (\S+)/)!
  expect(Math.abs(Number(path[1]) - 80)).toBeLessThan(1)
  expect(Math.abs(Number(path[2]) - 120)).toBeLessThan(1)
  await done(page); await waitForSync(page); await page.reload()
  await expect(sketch(page).locator('[data-stroke-id]')).toHaveCount(1)
})

test('a proposed sketch previews without live mutation, applies as editable marks and reverses as one graph', async ({ page }, info) => {
  await freshBoard(page, 'Proposed sketch review')
  await waitForSync(page)
  const boardId = decodeURIComponent(page.url().split('#/b/')[1]!)
  const connectionResponse = await page.request.post('/api/agent-connections', { data: { name: 'Sketch review fixture', mode: 'propose', boardIds: [boardId] } })
  expect(connectionResponse.status()).toBe(201)
  const connection = await connectionResponse.json()
  try {
    const cardId = crypto.randomUUID(), strokeId = crypto.randomUUID(), now = Date.now()
    const points = [{ x: 20, y: 30 }, { x: 160, y: 180 }, { x: 300, y: 30 }]
    const proposed = [
      { id: cardId, kind: 'card', type: 'sketch', boardId, x: 50, y: 100, w: 500, h: 180, z: 1, color: 'none', createdAt: now, content: { title: 'Reviewable wide frame', width: 320, height: 240, background: 'paper' } },
      { id: strokeId, kind: 'stroke', boardId, cardId, createdAt: now, tool: 'pen', color: '#D7263D', width: 6, opacity: 1, points, order: 1, bounds: inkBounds(points, 6) },
    ]
    const staged = await page.request.post('/api/agent/proposals', { headers: { authorization: `Bearer ${connection.token}` }, data: { idempotencyKey: `sketch-${crypto.randomUUID()}`, label: 'Review the wide sketch', operations: proposed.map((object) => ({ action: 'create', object })) } })
    expect(staged.status(), await staged.text()).toBe(201)
    const openProposal = async () => {
      await page.getByTestId('board-more').click(); await page.getByTestId('agent-proposals').click()
      await page.getByTestId('agent-review').getByRole('button', { name: /Review the wide sketch/ }).click()
    }
    await openProposal()
    // Previewed on the real board, marked as new; nothing is saved until approval.
    await page.getByTestId('preview-on-board').click()
    const preview = page.locator(`[data-card-id="${cardId}"][data-preview="added"]`)
    await expect(preview.locator('[data-stroke-id]')).toHaveCount(1)
    await expect(preview.locator('.ink-layer')).toHaveAttribute('viewBox', '0 0 320 240')
    await page.getByTestId('proposal-show-before').click()
    await expect(preview).toHaveCount(0)
    await page.getByTestId('proposal-show-after').click()
    await expect(preview.locator('[data-stroke-id]')).toHaveCount(1)
    await page.screenshot({ path: info.outputPath('proposed-sketch.png') })
    await page.keyboard.press('Escape')
    await expect(page.locator(`[data-card-id="${cardId}"]`)).toHaveCount(0)
    await openProposal()
    await page.getByTestId('approve-agent-proposal').click()
    await expect(page.getByTestId('reverse-agent-proposal')).toBeVisible()
    await page.getByTestId('agent-review').getByRole('button', { name: 'Close', exact: true }).click()
    const card = page.locator(`[data-card-id="${cardId}"]`)
    await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
    await card.getByTestId('sketch-paper').dblclick()
    await expect(editor(page).locator('[data-stroke-id]')).toHaveCount(1)
    await done(page); await waitForSync(page)
    await openProposal()
    await page.getByTestId('reverse-agent-proposal').click()
    await expect(page.getByTestId('agent-review')).toContainText('reversed')
    await page.getByTestId('agent-review').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(card).toHaveCount(0)
    const saved = await pullAllObjects(page.request)
    for (const id of [cardId, strokeId]) expect(saved.objects.find((o: { id: string }) => o.id === id).deletedAt).toBeTruthy()
  } finally {
    expect((await page.request.delete(`/api/agent-connections/${connection.id}`)).ok()).toBe(true)
  }
})
