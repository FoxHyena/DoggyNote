import { expect, test } from '@playwright/test'
import { DEFAULT_SKETCH, inkBounds } from '@doggynote/core'
import { freshBoard, MOD, postSync, pullAllObjects, runCardAction, waitForSync } from './helpers.ts'
import { moveFixture } from './move-board-fixture.ts'
import { importFixturePack, seedStickers, stickerBoard } from './sticker-helpers.ts'
import { boardOf, setCamera } from './touch.ts'

const resultByTitle = (page: Parameters<typeof runCardAction>[0], title: string) => page.getByTestId('move-board-result').filter({ has: page.locator('.move-board-text > span', { hasText: new RegExp(`^${title}$`) }) }).first()

test('moving a column preserves comments, strokes, labels, internal connections and identities across sync and Undo', async ({ page }) => {
  const rejected: unknown[] = []
  page.on('response', async response => { if (response.url().endsWith('/api/sync') && response.status() === 403) rejected.push({ body: await response.json(), request: response.request().postDataJSON() }) })
  await freshBoard(page)
  const f = await moveFixture(page), col = crypto.randomUUID(), sketch = crypto.randomUUID(), comment = crypto.randomUUID(), stroke = crypto.randomUUID(), internal = crypto.randomUUID(), external = crypto.randomUUID(), outside = crypto.randomUUID()
  const now = Date.now(), points = [{ x: 4, y: 4 }, { x: 150, y: 40 }]
  const base = { kind: 'card', boardId: f.source, x: 100, y: 80, w: 280, h: 120, z: 1, color: 'none', createdAt: now }
  const response = await postSync(page.request, { data: { changes: [
    { id: col, patch: { ...base, id: col, type: 'column', content: { title: 'Collected column' } } },
    { id: f.a, patch: { columnId: col, order: 1, labelaaaaaaaaaaaa: true } },
    { id: f.b, patch: { columnId: col, order: 2 } },
    { id: sketch, patch: { ...base, id: sketch, type: 'sketch', columnId: col, order: 3, content: DEFAULT_SKETCH } },
    { id: outside, patch: { ...base, id: outside, type: 'todo', x: 400, y: 440, content: { title: 'Stays outside', items: [] } } },
    { id: f.source, patch: { labelNameaaaaaaaaaaaa: 'Keep this label', labelColoraaaaaaaaaaaa: 'gold' } },
    { id: comment, patch: { id: comment, kind: 'comment', boardId: f.source, cardId: f.a, text: 'Keep this thought', createdAt: now } },
    { id: stroke, patch: { id: stroke, kind: 'stroke', boardId: f.source, cardId: sketch, tool: 'pen', color: '#D7263D', width: 4, opacity: 1, order: 1, points, bounds: inkBounds(points, 4), createdAt: now } },
    { id: internal, patch: { id: internal, kind: 'connection', boardId: f.source, from: f.a, to: f.b, arrow: 'end', createdAt: now } },
    { id: external, patch: { id: external, kind: 'connection', boardId: f.source, from: f.a, to: outside, arrow: 'end', createdAt: now } },
  ] } })
  expect(response.ok(), await response.text()).toBe(true)
  await page.reload(); await waitForSync(page)
  await runCardAction(page, 'Move to board…', page.locator(`[data-card-id="${col}"]`))
  await page.getByTestId('move-board-search').fill('Move destination')
  await resultByTitle(page, 'Move destination').click()
  await expect(page.locator(`[data-card-id="${col}"]`)).toHaveCount(0); await waitForSync(page)
  const { objects } = await pullAllObjects(page.request), get = (id: string) => objects.find(o => o.id === id)
  for (const id of [col, f.a, f.b, sketch, comment, stroke, internal]) expect(get(id)?.boardId).toBe(f.target)
  expect(get(f.a)?.columnId).toBe(col); expect(get(comment)?.text).toBe('Keep this thought')
  expect(get(external)?.purged).toBe(true)
  expect(Object.values(get(f.target))).toContain('Keep this label')
  await page.keyboard.press(`${MOD}+z`); await waitForSync(page)
  const restored = (await pullAllObjects(page.request)).objects
  for (const id of [col, f.a, f.b, sketch, comment, stroke, internal]) expect(restored.find(o => o.id === id)?.boardId).toBe(f.source)
  expect(rejected).toEqual([])
  expect(restored.find(o => o.id === external)?.purged).not.toBe(true)
})

test('a moved board tile changes its parent and excludes itself and descendants from destination search', async ({ page }) => {
  await freshBoard(page)
  const f = await moveFixture(page), sibling = crypto.randomUUID()
  expect((await postSync(page.request, { data: { changes: [{ id: sibling, patch: { id: sibling, kind: 'board', parentId: f.source, title: 'Sibling destination', icon: 'bone', color: 'sky', createdAt: Date.now() } }] } })).ok()).toBe(true)
  await page.reload(); await waitForSync(page)
  await runCardAction(page, 'Move to board…', page.locator(`[data-card-id="${f.tile}"]`))
  const search = page.getByTestId('move-board-search')
  await search.fill('Inside destination')
  await expect(page.getByTestId('move-board-result').filter({ hasText: await page.getByTestId('board-name').innerText() })).toHaveCount(0)
  await search.fill('Sibling destination'); await resultByTitle(page, 'Sibling destination').click()
  await expect(page.locator(`[data-card-id="${f.tile}"]`)).toHaveCount(0); await waitForSync(page)
  const objects = (await pullAllObjects(page.request)).objects
  expect(objects.find(o => o.id === f.target)?.parentId).toBe(sibling)
  expect(objects.find(o => o.id === f.nested)?.parentId).toBe(f.target)
  await page.keyboard.press(`${MOD}+z`); await waitForSync(page)
  expect((await pullAllObjects(page.request)).objects.find(o => o.id === f.target)?.parentId).toBe(f.source)
})

test('a standalone sticker and a mixed selected group move through the same commands and drop gestures', async ({ page }) => {
  await stickerBoard(page, page.request)
  const f = await moveFixture(page)
  await importFixturePack(page); await page.getByRole('button', { name: 'Close stickers', exact: true }).click()
  const [stickerId] = await seedStickers(page, f.source, [{ x: 350, y: 150 }])
  await setCamera(page, { x: -24, y: -24, zoom: 1 })
  const sticker = page.locator(`[data-sticker-id="${stickerId}"]`)
  const hit = (await sticker.boundingBox())!
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2, { button: 'right' }); await page.getByTestId('move-to-board').click()
  await page.keyboard.press('Escape'); await expect(sticker.locator('.sticker-accessible-pick')).toBeFocused()
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2, { button: 'right' }); await page.getByTestId('move-to-board').click()
  await page.getByTestId('move-board-search').fill('Move destination'); await resultByTitle(page, 'Move destination').click()
  await expect(sticker).toHaveCount(0); await page.keyboard.press(`${MOD}+z`); await expect(sticker).toBeVisible()
  await page.locator(`[data-card-id="${f.a}"]`).click(); await page.keyboard.down('Shift'); await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2); await page.keyboard.up('Shift')
  const from = (await sticker.boundingBox())!, target = (await page.locator(`[data-card-id="${f.tile}"] .board-tile`).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
  await expect(page.getByTestId('board-drop-target')).toContainText('Add 2 items')
  await page.mouse.up(); await expect(sticker).toHaveCount(0); await expect(page.locator(`[data-card-id="${f.a}"]`)).toHaveCount(0)
  await page.keyboard.press(`${MOD}+z`); await expect(sticker).toBeVisible(); expect(boardOf(page)).toBe(f.source)
})
