import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { MOD, addNote, at, camera, dragBy, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

const ink = (page: Page) => page.locator('[data-testid="card"][data-type="ink"]')
async function draw(page: Page, points: { x: number; y: number }[]) {
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 5 })
  await page.mouse.up()
}
const done = (page: Page) => page.getByTestId('canvas-ink-tools').getByRole('button', { name: 'Done', exact: true }).click()
const boardId = (page: Page) => decodeURIComponent(page.url().split('/b/')[1])
async function savedInk(page: Page) {
  const all = (await pullAllObjects(page.request)).objects
  return all.filter((o) => o.kind === 'card' && o.type === 'ink' && o.boardId === boardId(page) && !o.deletedAt && !o.purged)
}

test.beforeEach(async ({ page }) => { await freshBoard(page, `Canvas ink ${crypto.randomUUID()}`) })

test('free board marks stay put when references move; selection, resize, trash and restart preserve editable paths', async ({ page }) => {
  const note = await addNote(page, 'Reference: keep the original spacing', .55, .7)
  await page.getByTestId('tool-draw').click()
  await expect(page.getByText('Drawing on the board', { exact: true })).toBeVisible()
  const p = await at(page, .35, .6)
  // A loose boundary and a handwritten/process mark, beside existing content.
  await draw(page, [p, { x: p.x + 200, y: p.y }, { x: p.x + 200, y: p.y + 100 }, { x: p.x, y: p.y + 100 }, p])
  await draw(page, [{ x: p.x + 240, y: p.y + 100 }, { x: p.x + 265, y: p.y + 60 }, { x: p.x + 290, y: p.y + 100 }])
  await done(page)
  await expect(ink(page)).toHaveCount(2)
  const before = await ink(page).first().boundingBox()
  await dragBy(page, note, 100, 50)
  const after = await ink(page).first().boundingBox()
  expect(after!.x).toBeCloseTo(before!.x, 0)
  expect(after!.y).toBeCloseTo(before!.y, 0)
  await page.mouse.click(p.x + 50, p.y)
  await expect(ink(page).first()).toHaveClass(/selected/)
  await draw(page, [{ x: p.x + 50, y: p.y }, { x: p.x + 110, y: p.y + 45 }])
  const moved = await ink(page).first().boundingBox()
  // Board drags round final world positions; a padded mark may start on a half pixel.
  expect(Math.abs(moved!.x - after!.x - 60)).toBeLessThanOrEqual(1)
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(async () => (await ink(page).first().boundingBox())!.x).toBeCloseTo(after!.x, 0)
  await page.keyboard.press(`${MOD}+Shift+z`)
  const handle = page.getByTestId('resize-handle')
  const hb = (await handle.boundingBox())!
  await draw(page, [{ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2 + 80, y: hb.y + hb.height / 2 }])
  const resized = await ink(page).first().boundingBox()
  expect(resized!.width).toBeGreaterThan(moved!.width + 60)
  expect(resized!.width / resized!.height).toBeCloseTo(moved!.width / moved!.height, 2)
  await page.keyboard.press('Delete')
  await expect(ink(page)).toHaveCount(1)
  await page.keyboard.press(`${MOD}+z`)
  await expect(ink(page)).toHaveCount(2)
  await waitForSync(page)
  await page.reload()
  await expect(ink(page)).toHaveCount(2)
  await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(2)
  await expect(page.getByTestId('canvas-ink-tools')).toHaveCount(0)
})

test('highlighter, a swept eraser and coherent undo preserve the other marks', async ({ page }) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .35, .65)
  await draw(page, [p, { x: p.x + 140, y: p.y }])
  await page.getByRole('button', { name: 'Highlighter', exact: true }).click()
  await page.getByRole('button', { name: 'Yellow', exact: true }).click()
  await page.getByRole('button', { name: 'Medium', exact: true }).click()
  await draw(page, [{ x: p.x, y: p.y + 90 }, { x: p.x + 140, y: p.y + 90 }])
  await expect(ink(page).last().locator('path')).toHaveAttribute('stroke-opacity', '0.3')
  await expect(ink(page).last().locator('path')).toHaveAttribute('stroke-width', '18')
  await page.getByRole('button', { name: 'Eraser', exact: true }).click()
  await draw(page, [{ x: p.x + 60, y: p.y - 15 }, { x: p.x + 60, y: p.y + 110 }])
  await expect(ink(page)).toHaveCount(0)
  await page.keyboard.press(`${MOD}+z`)
  await expect(ink(page)).toHaveCount(2)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(ink(page)).toHaveCount(0)
  await page.keyboard.press(`${MOD}+z`)
  await done(page)
  await waitForSync(page)
  expect(await savedInk(page)).toHaveLength(2)
})

test('Buried bones restores editable ink without reviving a previously erased stroke', async ({ page }) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .35, .6)
  await draw(page, [p, { x: p.x + 160, y: p.y + 90 }])
  await done(page)
  await page.mouse.click(p.x + 80, p.y + 45)
  const owner = await ink(page).getAttribute('data-card-id')
  await page.getByTestId('edit-canvas-ink').click()
  const editor = page.getByTestId('stroke-editor')
  const surface = (await editor.getByTestId('ink-surface').boundingBox())!
  await draw(page, [{ x: surface.x + surface.width * .2, y: surface.y + surface.height * .75 }, { x: surface.x + surface.width * .8, y: surface.y + surface.height * .75 }])
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(2)
  await editor.getByRole('button', { name: 'Eraser', exact: true }).click()
  // Touch only the start of the original diagonal, away from the new line.
  await draw(page, [{ x: surface.x + surface.width * .08, y: surface.y + surface.height * .08 }, { x: surface.x + surface.width * .12, y: surface.y + surface.height * .12 }])
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(1)
  const survivor = await editor.locator('[data-stroke-id]').getAttribute('data-stroke-id')
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page)
  const before = (await pullAllObjects(page.request)).objects.filter((o) => o.kind === 'stroke' && o.cardId === owner)
  expect(before).toHaveLength(2)
  expect(before.filter((o) => o.deletedAt)).toHaveLength(1)
  const line = (await ink(page).locator('[data-stroke-id]').boundingBox())!
  await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2)
  await page.getByTestId('bury').click()
  await expect(ink(page)).toHaveCount(0)
  await page.getByTestId('tool-trash').click()
  const item = page.getByTestId('trash-item')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('Canvas drawing')
  await item.getByTestId('restore').click()
  await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await waitForSync(page)
  await page.reload()
  await expect(ink(page)).toHaveAttribute('data-card-id', owner!)
  await expect(ink(page).locator('[data-stroke-id]')).toHaveAttribute('data-stroke-id', survivor!)
  const after = (await pullAllObjects(page.request)).objects.filter((o) => o.kind === 'stroke' && o.cardId === owner)
  expect(after.map((o) => ({ id: o.id, points: o.points, deletedAt: o.deletedAt })).sort((a, b) => a.id.localeCompare(b.id)))
    .toEqual(before.map((o) => ({ id: o.id, points: o.points, deletedAt: o.deletedAt })).sort((a, b) => a.id.localeCompare(b.id)))
  const restored = (await ink(page).locator('[data-stroke-id]').boundingBox())!
  await page.mouse.click(restored.x + restored.width / 2, restored.y + restored.height / 2)
  await page.getByTestId('edit-canvas-ink').click()
  await editor.getByRole('button', { name: 'Pen', exact: true }).click()
  const reopened = (await editor.getByTestId('ink-surface').boundingBox())!
  await draw(page, [{ x: reopened.x + reopened.width * .2, y: reopened.y + reopened.height * .3 }, { x: reopened.x + reopened.width * .8, y: reopened.y + reopened.height * .3 }])
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(2)
  await editor.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(1)
  await editor.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(2)
  // Exhausting Redo disables its clicked button. The next keyboard shortcut
  // must still reach this modal without explicitly focusing a test target.
  await page.keyboard.press(`${MOD}+z`)
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(1)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(2)
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page)
})

test('Escape cancels only the draft, Space pans, and geometry survives zoom and offline reopen', async ({ page, context }) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .35, .65)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 80, p.y + 40, { steps: 5 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(ink(page)).toHaveCount(0)
  await expect(page.getByTestId('canvas-ink-tools')).toBeVisible()
  const cam = await camera(page)
  await page.keyboard.down('Space')
  await draw(page, [p, { x: p.x + 70, y: p.y + 40 }])
  await page.keyboard.up('Space')
  await expect.poll(async () => (await camera(page)).tx).toBeCloseTo(cam.tx + 70, 0)
  await expect(ink(page)).toHaveCount(0)
  const highlighter = page.getByTestId('canvas-ink-tools').getByRole('button', { name: 'Highlighter', exact: true })
  await highlighter.click()
  await highlighter.focus()
  await page.keyboard.down('Space')
  await draw(page, [p, { x: p.x + 60, y: p.y + 30 }])
  await page.keyboard.up('Space')
  await expect.poll(async () => (await camera(page)).tx).toBeCloseTo(cam.tx + 130, 0)
  await expect(ink(page)).toHaveCount(0)
  await expect(page.getByTestId('canvas-ink-tools')).toBeVisible()
  await page.getByTestId('canvas-ink-tools').getByRole('button', { name: 'Pen', exact: true }).click()
  await context.setOffline(true)
  try {
    await page.keyboard.press(`${MOD}+-`)
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(.8, 2)
    await draw(page, [p, { x: p.x + 120, y: p.y + 80 }])
    await done(page)
    await expect(ink(page)).toHaveCount(1)
    await expect.poll(async () => page.getByTestId('sync-status').getAttribute('data-pending')).not.toBe('0')
  } finally { await context.setOffline(false) }
  await waitForSync(page)
  const [stored] = await savedInk(page)
  expect(stored.w).toBeCloseTo(120 / .8 + 5, 0)
  await page.reload()
  await expect(ink(page)).toHaveCount(1)
  expect((await savedInk(page))[0].id).toBe(stored.id)
})

test('export includes actual ink with tight padded bounds and excludes editor chrome', async ({ page }, testInfo) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .35, .65)
  await draw(page, [p, { x: p.x + 160, y: p.y }])
  await done(page)
  await page.mouse.click(p.x + 50, p.y)
  await expect(ink(page)).toHaveClass(/selected/)
  await page.getByTestId('board-more').click()
  await page.getByTestId('export').click()
  await page.getByTestId('export-scope-selection').click()
  await page.getByTestId('export-scale-1').click()
  await page.getByTestId('export-background-transparent').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-go').click()
  const bytes = await readFile((await (await download).path())!)
  const artifact = testInfo.outputPath('canvas-ink-selection.png')
  await writeFile(artifact, bytes)
  await testInfo.attach('canvas-ink-selection.png', { path: artifact, contentType: 'image/png' })
  const result = await page.evaluate(async (base64) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data
    let painted = 0, red = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 20) {
      painted++
      if (pixels[i] > 140 && pixels[i + 1] < 80 && pixels[i + 2] < 100) red++
    }
    return { width: image.width, height: image.height, painted, red, corner: ctx.getImageData(0, 0, 1, 1).data[3] }
  }, bytes.toString('base64'))
  expect(result.width).toBeGreaterThanOrEqual(229)
  expect(result.width).toBeLessThan(232)
  expect(result.height).toBeLessThan(72)
  expect(result.painted).toBeGreaterThan(300)
  expect(result.red / result.painted).toBeGreaterThan(.95)
  expect(result.corner).toBe(0)
})

test('anonymous viewers see ink but cannot draw, erase or move it', async ({ page, browser }) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .35, .65)
  await draw(page, [p, { x: p.x + 100, y: p.y + 50 }])
  await done(page)
  await waitForSync(page)
  await page.getByTestId('share').click()
  await page.getByTestId('share-panel').getByTestId('create-share').click()
  const url = await page.getByTestId('share-panel').getByTestId('share-url').first().inputValue()
  const viewer = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const v = await viewer.newPage()
    await v.goto(url)
    await expect(ink(v)).toHaveCount(1)
    await expect(ink(v).locator('[data-stroke-id]')).toHaveCount(1)
    await expect(v.getByTestId('tool-draw')).toHaveCount(0)
    const before = await savedInk(page)
    const obj = before[0]
    const denied = await v.request.post('/api/sync', { data: { changes: [{ id: obj.id, patch: { x: 400 } }] }, headers: { 'x-doggynote-protocol': '2' } })
    expect([401, 403]).toContain(denied.status())
    await v.keyboard.press('Delete')
    await expect(ink(v)).toHaveCount(1)
    expect((await savedInk(page))[0].x).toBe(obj.x)
  } finally { await viewer.close() }
})

test('overlapping marks can be picked individually; locked marks stay editable', async ({ page }) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .35, .65)
  const points = [p, { x: p.x + 120, y: p.y + 90 }]
  await draw(page, points)
  await draw(page, points)
  await done(page)
  await page.mouse.click(p.x + 60, p.y + 45)
  const top = await page.locator('.card-ink.selected').getAttribute('data-card-id')
  await page.getByTestId('next-overlapping-ink').click()
  const other = await page.locator('.card-ink.selected').getAttribute('data-card-id')
  expect(other).not.toBe(top)
  await page.getByTestId('position-lock').click()
  const before = await page.locator('.card-ink.selected').boundingBox()
  await draw(page, [{ x: p.x + 60, y: p.y + 45 }, { x: p.x + 140, y: p.y + 100 }])
  const after = await page.locator('.card-ink.selected').boundingBox()
  expect(after!.x).toBe(before!.x)
  expect(after!.y).toBe(before!.y)
  await expect(page.getByTestId('resize-handle')).toHaveCount(0)
  await page.getByTestId('edit-canvas-ink').click()
  const editor = page.getByTestId('stroke-editor')
  await expect(editor).toHaveAttribute('aria-label', 'Edit canvas drawing')
  const surface = await page.getByTestId('ink-surface').boundingBox()
  await draw(page, [{ x: surface!.x + surface!.width * .2, y: surface!.y + surface!.height * .7 }, { x: surface!.x + surface!.width * .8, y: surface!.y + surface!.height * .7 }])
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.locator(`.card-ink[data-card-id="${other}"] [data-stroke-id]`)).toHaveCount(2)
  await waitForSync(page)
  await page.reload()
  await expect(page.locator(`.card-ink[data-card-id="${other}"] [data-stroke-id]`)).toHaveCount(2)
  expect((await savedInk(page)).find((c) => c.id === other).positionLocked).toBe(true)
})

test('duplicate and personal template preserve independent editable ink', async ({ page }) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .35, .65)
  await draw(page, [p, { x: p.x + 120, y: p.y + 90 }])
  await done(page)
  await page.mouse.click(p.x + 60, p.y + 45)
  const original = await page.locator('.card-ink.selected').getAttribute('data-card-id')
  await page.getByTestId('duplicate-selection').click()
  await expect(ink(page)).toHaveCount(2)
  const copied = await page.locator('.card-ink.selected').getAttribute('data-card-id')
  expect(copied).not.toBe(original)
  await page.getByTestId('edit-canvas-ink').click()
  const surface = (await page.getByTestId('ink-surface').boundingBox())!
  await draw(page, [{ x: surface.x + surface.width * .2, y: surface.y + surface.height * .7 }, { x: surface.x + surface.width * .8, y: surface.y + surface.height * .7 }])
  await page.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.locator(`[data-card-id="${original}"] [data-stroke-id]`)).toHaveCount(1)
  await expect(page.locator(`[data-card-id="${copied}"] [data-stroke-id]`)).toHaveCount(2)
  await waitForSync(page)
  const templateName = `Ink layout ${crypto.randomUUID()}`
  await page.getByTestId('board-more').click()
  await page.getByTestId('save-template').click()
  await page.getByTestId('template-name').fill(templateName)
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
  await waitForSync(page)
  await page.getByTestId('board-more').click()
  await page.getByTestId('open-templates').click()
  await page.getByTestId('personal-template').filter({ hasText: templateName }).click()
  await page.getByTestId('template-name').fill('Independent editable ink layout')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Independent editable ink layout')
  await expect(ink(page)).toHaveCount(2)
  await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(3)
  await waitForSync(page)
  const copiedOwners = await savedInk(page)
  expect(copiedOwners.some((c) => [original, copied].includes(c.id))).toBe(false)
})

test('independent sessions preserve offline additions and a stroke added during an erase gesture', async ({ page, browser, context }) => {
  const peerContext = await browser.newContext({ storageState: await context.storageState() })
  try {
    const peer = await peerContext.newPage()
    await peer.goto(page.url())
    await expect(peer.getByTestId('canvas')).toBeVisible()
    const p = await at(page, .35, .65), q = await at(peer, .35, .65)
    await page.getByTestId('tool-draw').click()
    await peer.getByTestId('tool-draw').click()
    await context.setOffline(true)
    await draw(page, [p, { x: p.x + 120, y: p.y + 60 }])
    await draw(peer, [q, { x: q.x + 120, y: q.y + 60 }])
    await done(peer)
    await waitForSync(peer)
    await context.setOffline(false)
    await waitForSync(page)
    await expect(ink(page)).toHaveCount(2, { timeout: 15000 })
    await expect(ink(peer)).toHaveCount(2, { timeout: 15000 })
    await page.getByRole('button', { name: 'Eraser', exact: true }).click()
    // Start erasing the existing pair, then append to one SAME owner elsewhere.
    await page.mouse.move(p.x + 60, p.y + 30)
    await page.mouse.down()
    await peer.mouse.click(q.x + 60, q.y + 30)
    await peer.getByTestId('edit-canvas-ink').click()
    const surface = (await peer.getByTestId('ink-surface').boundingBox())!
    await draw(peer, [{ x: surface.x + surface.width * .2, y: surface.y + surface.height * .7 }, { x: surface.x + surface.width * .8, y: surface.y + surface.height * .7 }])
    await peer.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
    await waitForSync(peer)
    await page.mouse.up()
    await done(page)
    await waitForSync(page)
    await expect(ink(page)).toHaveCount(1, { timeout: 15000 })
    await expect(ink(peer)).toHaveCount(1, { timeout: 15000 })
    await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(1)
    await page.keyboard.press(`${MOD}+z`)
    await expect(ink(page)).toHaveCount(2)
    await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(3)
  } finally {
    await context.setOffline(false)
    await peerContext.close()
  }
})

test('leaving the window and zooming cancel drafts; low-zoom ink remains aligned and selectable in overview', async ({ page }, info) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .4, .65)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 60, p.y + 30, { steps: 4 })
  await page.mouse.move(-12, p.y)
  await page.mouse.up()
  await expect(ink(page)).toHaveCount(0)
  await expect(page.locator('.canvas-ink-preview')).toHaveCount(0)

  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 60, p.y + 30, { steps: 4 })
  await page.mouse.wheel(0, 80)
  await page.mouse.up()
  await expect(ink(page)).toHaveCount(0)

  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 60, p.y + 30, { steps: 4 })
  await page.keyboard.press(`${MOD}+-`)
  await page.mouse.up()
  await expect(ink(page)).toHaveCount(0)
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(.8, 4)
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press(`${MOD}+-`)
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(.8 ** (i + 2), 4)
  }
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(.8 ** 5, 4)
  await expect(page.getByTestId('canvas')).toHaveClass(/\blod\b/)
  await draw(page, [p, { x: p.x + 140, y: p.y + 45 }])
  await done(page)
  await waitForSync(page)
  const [owner] = await savedInk(page)
  expect(owner.w).toBeCloseTo(140 / (.8 ** 5) + 5, 0)
  expect(owner.h).toBeCloseTo(45 / (.8 ** 5) + 5, 0)
  // Overview has no per-card DOM: pick the visible path through world hit testing.
  await expect(ink(page)).toHaveCount(0)
  // The tight envelope's inset is subpixel here. A click two screen pixels
  // before the visible endpoint still belongs to the five-pixel path target.
  await page.mouse.click(p.x - 2, p.y)
  await expect(page.getByTestId('edit-canvas-ink')).toBeVisible()
  await page.mouse.click(p.x + 70, p.y + 22.5)
  await expect(page.getByTestId('edit-canvas-ink')).toBeVisible()
  await page.getByTestId('edit-canvas-ink').click()
  await expect(page.getByTestId('stroke-editor').locator('[data-stroke-id]')).toHaveCount(1)
  await page.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
  await page.keyboard.press(`${MOD}+0`)
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1, 4)
  await expect(ink(page)).toHaveCount(1)
  const shot = info.outputPath('low-zoom-mark-at-100-percent.png')
  await page.screenshot({ path: shot, scale: 'css' })
  await info.attach('low-zoom-mark-at-100-percent.png', { path: shot, contentType: 'image/png' })
  await page.reload()
  expect((await savedInk(page))[0].id).toBe(owner.id)
})

test('overview updates cached ink after remote colour, geometry, erasure and restore', async ({ page }) => {
  test.setTimeout(60_000)
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .4, .6)
  await draw(page, [p, { x: p.x + 140, y: p.y + 45 }])
  await done(page); await waitForSync(page)
  const [owner] = await savedInk(page)
  const mark = (await pullAllObjects(page.request)).objects.find(o => o.kind === 'stroke' && o.cardId === owner.id)!
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(`${MOD}+-`)
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(.8 ** (i + 1), 4)
  }
  const layer = page.getByTestId('lod-layer')
  await expect(layer).toBeVisible()
  const colourAt = async (local: { x: number; y: number }) => {
    const c = await camera(page), v = (await page.getByTestId('canvas').boundingBox())!
    return layer.evaluate((element, point) => {
      const canvas = element as HTMLCanvasElement, rect = canvas.getBoundingClientRect()
      const data = canvas.getContext('2d')!.getImageData(Math.round(point.x - rect.left) - 1, Math.round(point.y - rect.top) - 1, 3, 3).data
      let red = false, green = false, visible = false
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 16) continue
        visible = true
        red ||= data[i] > data[i + 1] * 1.5
        green ||= data[i + 1] > data[i] * 1.5 && data[i + 1] > data[i + 2] * 1.1
      }
      return { red, green, visible }
    }, { x: v.x + c.tx + (owner.x + local.x) * c.zoom, y: v.y + c.ty + (owner.y + local.y) * c.zoom })
  }
  const midpoint = { x: (mark.points[0].x + mark.points.at(-1).x) / 2, y: (mark.points[0].y + mark.points.at(-1).y) / 2 }
  await expect.poll(async () => (await colourAt(midpoint)).red).toBe(true)
  const remote = async (patch: Record<string, unknown>) => {
    const response = await postSync(page.request, { data: { changes: [{ id: mark.id, patch }] } })
    expect(response.ok(), await response.text()).toBe(true)
    const pulled = page.waitForResponse(r => new URL(r.url()).pathname === '/api/sync' && r.request().method() === 'GET' && r.ok())
    await page.getByTestId('sync-status').click()
    await pulled; await waitForSync(page)
    await page.keyboard.press('Escape')
  }
  await remote({ color: '#21835B' })
  await expect.poll(async () => (await colourAt(midpoint)).green).toBe(true)
  const points = [{ x: owner.content.width * .2, y: owner.content.height * .2 }, { x: owner.content.width * .8, y: owner.content.height * .2 }]
  const { inkBounds } = await import('@doggynote/core')
  await remote({ points, bounds: inkBounds(points, mark.width) })
  const moved = { x: owner.content.width / 2, y: points[0].y }
  await expect.poll(async () => (await colourAt(midpoint)).visible).toBe(false)
  await expect.poll(async () => (await colourAt(moved)).green).toBe(true)
  await remote({ deletedAt: Date.now() })
  await expect.poll(async () => (await colourAt(moved)).visible).toBe(false)
  await remote({ deletedAt: null })
  await expect.poll(async () => (await colourAt(moved)).green).toBe(true)
})

test('board ink stays independent while image annotations and sketch strokes follow their moved and resized owners', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const png = Buffer.from(await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(800, 500), ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f5f2e9'; ctx.fillRect(0, 0, 800, 500)
    ctx.fillStyle = '#245fe5'; ctx.fillRect(80, 70, 160, 130)
    ctx.fillStyle = '#21835b'; ctx.fillRect(430, 270, 250, 160)
    ctx.fillStyle = '#292d35'; ctx.font = '32px sans-serif'; ctx.fillText('Two routes to try', 260, 110)
    return [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())]
  }))
  await page.getByTestId('image-input').setInputFiles({ name: 'trail-reference.png', mimeType: 'image/png', buffer: png })
  const image = page.locator('[data-testid="card"][data-type="image"]')
  await expect(image.getByTestId('card-image')).toBeVisible()
  await dragBy(page, image, -330, -150)
  await image.getByTestId('image-viewport').click()
  await page.getByTestId('annotate-image').click()
  const editor = page.getByTestId('stroke-editor'), surface = page.getByTestId('ink-surface')
  await expect(surface).toHaveAttribute('data-image-ready', 'true')
  // Wait for the editor's first fit before drawing; never retry a lost gesture.
  let previous = '', stable = 0
  await expect.poll(async () => {
    const next = JSON.stringify(await surface.boundingBox())
    stable = next === previous ? stable + 1 : 0; previous = next
    return stable
  }, { intervals: [100, 100, 100] }).toBeGreaterThanOrEqual(2)
  const ib = (await surface.boundingBox())!
  await draw(page, [{ x: ib.x + ib.width * .2, y: ib.y + ib.height * .25 }, { x: ib.x + ib.width * .75, y: ib.y + ib.height * .65 }])
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(1)
  await editor.getByRole('button', { name: 'Done', exact: true }).click()

  await page.getByTestId('tool-sketch').click()
  await expect(editor).toBeVisible()
  const sb = (await surface.boundingBox())!
  await draw(page, [{ x: sb.x + sb.width * .2, y: sb.y + sb.height * .3 }, { x: sb.x + sb.width * .8, y: sb.y + sb.height * .6 }])
  await expect(editor.locator('[data-stroke-id]')).toHaveCount(1)
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  const sketch = page.locator('[data-testid="card"][data-type="sketch"]')
  await dragBy(page, sketch, 180, 120)
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .2, .77)
  await draw(page, [p, { x: p.x + 150, y: p.y + 30 }])
  await done(page)
  await expect(ink(page)).toHaveCount(1)
  const freeBefore = (await ink(page).boundingBox())!
  await waitForSync(page)
  const before = (await pullAllObjects(page.request)).objects
  const ownerIds = [await image.getAttribute('data-card-id'), await sketch.getAttribute('data-card-id')]
  const ownedStrokes = before.filter((o) => o.kind === 'stroke' && ownerIds.includes(o.cardId))
  expect(ownedStrokes).toHaveLength(2)

  for (const [owner, dx, dy, dw] of [[image, 110, 65, 70], [sketch, -90, 90, 90]] as const) {
    const pathBefore = (await owner.locator('[data-stroke-id]').boundingBox())!
    await dragBy(page, owner, dx, dy)
    const pathAfter = (await owner.locator('[data-stroke-id]').boundingBox())!
    expect(Math.abs(pathAfter.x - pathBefore.x - dx)).toBeLessThanOrEqual(1)
    expect(Math.abs(pathAfter.y - pathBefore.y - dy)).toBeLessThanOrEqual(1)
    const handle = owner.getByTestId('resize-handle')
    const target = await handle.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const at = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return { hitResize: !!at?.closest('[data-resize]'), hitTag: at?.tagName, hitClass: at?.getAttribute('class'), rect: rect.toJSON() }
    })
    expect(target.hitResize, JSON.stringify(target)).toBe(true)
    await dragBy(page, handle, dw, 35)
    await expect.poll(async () => (await owner.locator('[data-stroke-id]').boundingBox())!.width).toBeGreaterThan(pathAfter.width)
  }
  const freeAfter = (await ink(page).boundingBox())!
  expect(freeAfter.x).toBeCloseTo(freeBefore.x, 4)
  expect(freeAfter.y).toBeCloseTo(freeBefore.y, 4)
  await page.keyboard.press(`${MOD}+-`)
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(.8, 4)
  await page.keyboard.down('Space')
  const pan = await at(page, .9, .8)
  await draw(page, [pan, { x: pan.x + 35, y: pan.y + 25 }])
  await page.keyboard.up('Space')
  await waitForSync(page)
  const after = (await pullAllObjects(page.request)).objects
  expect(after.filter((o) => o.kind === 'stroke' && ownerIds.includes(o.cardId))).toEqual(ownedStrokes)
  await page.reload()
  await expect(image.locator('[data-stroke-id]')).toHaveCount(1)
  await expect(sketch.locator('[data-stroke-id]')).toHaveCount(1)
  await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(1)
  const shot = info.outputPath('three-drawing-surfaces-after-owner-moves.png')
  await page.screenshot({ path: shot, scale: 'css' })
  await info.attach('three-drawing-surfaces-after-owner-moves.png', { path: shot, contentType: 'image/png' })
})

test('Undo creation and Redo burial preserve later real strokes from another session', async ({ page, browser, context }) => {
  await page.getByTestId('tool-draw').click()
  const p = await at(page, .35, .65)
  await draw(page, [p, { x: p.x + 140, y: p.y + 80 }])
  await waitForSync(page)
  const peerContext = await browser.newContext({ storageState: await context.storageState() })
  try {
    const peer = await peerContext.newPage()
    await peer.goto(page.url())
    await expect(ink(peer)).toHaveCount(1)
    const append = async (height: number, expected: number) => {
      const path = (await ink(peer).locator('[data-stroke-id]').first().boundingBox())!
      await peer.mouse.click(path.x + path.width * .4, path.y + path.height * .4)
      await peer.getByTestId('edit-canvas-ink').click()
      const surface = (await peer.getByTestId('ink-surface').boundingBox())!
      await draw(peer, [{ x: surface.x + surface.width * .2, y: surface.y + surface.height * height }, { x: surface.x + surface.width * .8, y: surface.y + surface.height * height }])
      await expect(peer.getByTestId('stroke-editor').locator('[data-stroke-id]')).toHaveCount(expected)
      await peer.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
      await waitForSync(peer)
      await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(expected, { timeout: 15000 })
    }
    await append(.8, 2)
    await page.keyboard.press(`${MOD}+z`)
    await expect(page.getByText('Cannot undo because this item changed or is no longer editable.', { exact: true })).toBeVisible()
    await expect(ink(page)).toHaveCount(1)
    await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(2)
    await done(page)
    await page.mouse.click(p.x + 70, p.y + 40)
    await page.keyboard.press('Delete')
    await expect(ink(page)).toHaveCount(0)
    await page.keyboard.press(`${MOD}+z`)
    await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(2)
    await waitForSync(page)
    await append(.2, 3)
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(page.getByText('Cannot redo because this item changed or is no longer editable.', { exact: true })).toBeVisible()
    await expect(ink(page)).toHaveCount(1)
    await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(3)
    await waitForSync(page)
    await page.reload()
    await expect(ink(page).locator('[data-stroke-id]')).toHaveCount(3)
  } finally { await peerContext.close() }
})
