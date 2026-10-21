import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { AUTH_FILE } from '../playwright.config.ts'
import { MOD, camera, dragBy, freshBoard, waitForSync, postSync, pullAllObjects } from './helpers.ts'

const colors = (page: Page) => page.locator('.card-swatch')
async function createForest(page: Page) {
  await freshBoard(page, `Swatch QA ${crypto.randomUUID().slice(0, 6)}`)
  await page.getByTestId('tool-swatch').click()
  await page.getByTestId('swatch-hex-input').fill('#2F5D50')
  await page.getByTestId('swatch-name-input').fill('Forest')
  await page.getByTestId('swatch-caption-input').fill('Primary packaging')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(colors(page)).toContainText('Forest')
  await expect(page.getByTestId('swatch-paint')).toHaveCSS('background-color', 'rgb(47, 93, 80)')
  await waitForSync(page)
  return (await colors(page).getAttribute('data-card-id'))!
}

test('Forest HEX, draft correction, Undo/Redo, reopen, copy, independent duplicate and search', async ({ page, context, browserName }) => {
  const id = await createForest(page)
  await expect(page.getByTestId('swatch-gold')).toHaveCount(0)
  await page.getByTestId('copy-swatch').click()
  await expect(page.getByTestId('copy-swatch')).toHaveText('Copied!')
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#2F5D50')
  }
  await page.getByTestId('edit-swatch').click()
  await page.getByTestId('swatch-hex-input').fill('#2F')
  await expect(page.getByTestId('swatch-hex-input')).toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Escape')
  await expect(colors(page)).toContainText('Unfinished HEX edit saved')
  await waitForSync(page)
  await page.reload()
  await page.getByTestId('edit-swatch').click()
  await expect(page.getByTestId('swatch-hex-input')).toHaveValue('#2F')
  await page.getByTestId('swatch-hex-input').fill('#12345Z')
  await expect(page.getByTestId('swatch-paint')).toHaveCSS('background-color', 'rgb(47, 93, 80)')
  await page.getByTestId('swatch-hex-input').fill('abc')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('swatch-value')).toHaveText('#AABBCC')
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByTestId('swatch-value')).toHaveText('#2F5D50')
  await page.getByTestId('edit-swatch').click()
  await expect(page.getByTestId('swatch-hex-input')).toHaveValue('#2F')
  await page.keyboard.press('Escape')
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(page.getByTestId('swatch-value')).toHaveText('#AABBCC')
  await page.getByTestId('duplicate-selection').click()
  await expect(colors(page)).toHaveCount(2)
  // The duplicate has its own explicit edit action.
  await colors(page).last().getByTestId('edit-swatch').click()
  await page.getByTestId('swatch-name-input').fill('Independent copy')
  await page.keyboard.press('Escape')
  await expect(page.locator(`[data-card-id="${id}"]`)).toContainText('Forest')
  await expect(colors(page).filter({ hasText: 'Independent copy' })).toBeVisible()
  await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press(`${MOD}+z`)
  await expect(colors(page)).toHaveCount(1)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(colors(page)).toHaveCount(2)
  await page.getByTestId('open-fetch').click()
  await page.getByTestId('fetch-input').fill('#AABBCC')
  const boardName = await page.getByTestId('board-name').textContent()
  await expect(page.getByTestId('fetch-hit').filter({ hasText: `swatch in ${boardName}` })).toHaveCount(2)
  await page.keyboard.press('Escape')
  await waitForSync(page)
  const rows = (await pullAllObjects(page.request)).objects.filter((o: { type: string; boardId: string }) => o.type === 'swatch' && o.boardId === page.url().split('/b/')[1])
  expect(rows).toHaveLength(2)
  expect(rows.every((o: { swatchHex: string }) => o.swatchHex === '#AABBCC')).toBe(true)
})

test('different swatch fields merge across active sessions and offline edits survive reconnect', async ({ page, context, browser }) => {
  test.setTimeout(60_000)
  const id = await createForest(page)
  const second = await browser.newContext({ storageState: AUTH_FILE })
  try {
    const other = await second.newPage()
    await other.goto(page.url())
    await expect(colors(other)).toContainText('Forest')
    await page.getByTestId('edit-swatch').click()
    await other.getByTestId('edit-swatch').click()
    await other.getByTestId('swatch-name-input').fill('Remote forest')
    await other.keyboard.press('Escape')
    await waitForSync(other)
    await page.getByTestId('swatch-caption-input').fill('Local caption')
    await page.keyboard.press('Escape')
    await waitForSync(page)
    await page.reload()
    await expect(colors(page)).toContainText('Remote forest')
    await expect(colors(page)).toContainText('Local caption')
    await context.setOffline(true)
    await page.getByTestId('edit-swatch').click()
    await page.getByTestId('swatch-hex-input').fill('#00FF80')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('swatch-value')).toHaveText('#00FF80')
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', /[1-9]/)
    await context.setOffline(false)
    await page.getByTestId('sync-status').click()
    await waitForSync(page)
    await other.reload()
    await expect(other.locator(`[data-card-id="${id}"]`)).toContainText('#00FF80')
    await expect(colors(other)).toContainText('Remote forest')
    await expect(colors(other)).toContainText('Local caption')
  } finally { await context.setOffline(false); await second.close() }
})

test('swatch PNG has exact pixels and read-only shares expose copy without editing', async ({ page, browser }, info) => {
  await createForest(page)
  await page.getByTestId('board-more').click()
  await page.getByTestId('export').click()
  await page.getByTestId('export-scale-1').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-go').click()
  const file = await (await download).path()
  const png = await readFile(file!)
  await writeFile(info.outputPath('forest-export.png'), png)
  await info.attach('swatch-export', { body: png, contentType: 'image/png' })
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    return [...ctx.getImageData(60, 60, 1, 1).data]
  }, png.toString('base64'))
  expect(pixels).toEqual([47, 93, 80, 255])
  await page.keyboard.press('Escape')
  await page.getByTestId('share').click()
  await page.getByTestId('create-share').click()
  const url = await page.getByTestId('share-url').first().inputValue()
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const viewer = await stranger.newPage()
    await viewer.goto(url)
    await expect(colors(viewer)).toContainText('Primary packaging')
    await expect(viewer.getByTestId('edit-swatch')).toHaveCount(0)
    await expect(viewer.getByTestId('copy-swatch')).toBeVisible()
    await colors(viewer).dblclick()
    await expect(viewer.getByTestId('swatch-hex-input')).toHaveCount(0)
    expect((await postSync(viewer.request, { data: { changes: [] } })).status()).toBe(401)
  } finally { await stranger.close() }
})

test('swatch movement, width resize, column membership and recoverable trash', async ({ page }) => {
  const id = await createForest(page)
  await page.getByTestId('image-input').setInputFiles({ name: 'synthetic-dog-reference.png', mimeType: 'image/png', buffer: await readFile(new URL('../../desktop/src-tauri/icons/64x64.png', import.meta.url)) })
  await expect(page.getByTestId('card-image')).toBeVisible()
  const card = colors(page)
  const before = await card.boundingBox()
  await dragBy(page, card.getByTestId('swatch-paint'), 80, 50)
  const after = await card.boundingBox()
  expect(after!.x - before!.x).toBeCloseTo(80, 0)
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(async () => (await card.boundingBox())!.x).toBeCloseTo(before!.x, 0)
  await dragBy(page, page.getByTestId('resize-handle'), -40, 0)
  await expect.poll(async () => (await card.boundingBox())!.width).toBeLessThan(before!.width)
  await page.getByTestId('tool-column').click()
  await page.keyboard.type('Palette')
  await page.keyboard.press('Escape')
  const column = page.locator('.card-column')
  const box = (await column.boundingBox())!
  const paint = (await card.getByTestId('swatch-paint').boundingBox())!
  await page.mouse.move(paint.x + 20, paint.y + 15)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 85, { steps: 12 })
  await page.mouse.up()
  await expect(column.locator('.card-swatch')).toHaveCount(1)
  // Still selected from the drag: a second click would edit, so select it afresh.
  await page.keyboard.press('Escape')
  await column.getByTestId('swatch-paint').click()
  await page.keyboard.press('Delete')
  await expect(colors(page)).toHaveCount(0)
  await page.getByTestId('tool-trash').click()
  await expect(page.getByTestId('trash-item')).toContainText('Forest')
  await page.getByTestId('trash-item').getByTestId('restore').click()
  await expect(page.locator(`[data-card-id="${id}"]`)).toContainText('#2F5D50')
})

test('agent swatch proposals preview exact paint, approve, and reverse without flattening', async ({ page }) => {
  await freshBoard(page)
  const boardId = page.url().split('/b/')[1]
  const response = await page.request.post('/api/agent-connections', { data: { name: 'Swatch proposal QA', mode: 'propose', boardIds: [boardId] } })
  expect(response.status()).toBe(201)
  const { token, id: connectionId } = await response.json()
  try {
    const object = { id: crypto.randomUUID(), kind: 'card', type: 'swatch', boardId, x: 0, y: 0, w: 220, h: 220, z: 1, color: 'none', content: {}, swatchHex: '#2F5D50', swatchName: 'Proposed forest', swatchCaption: 'Primary packaging', swatchHexDraft: null, createdAt: Date.now() }
    const staged = await page.request.post('/api/agent/proposals', { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `swatch-${crypto.randomUUID()}`, label: 'Add a forest color', operations: [{ action: 'create', object }] } })
    expect(staged.status(), await staged.text()).toBe(201)
    await page.getByTestId('board-more').click()
    await page.getByTestId('agent-proposals').click()
    await page.getByTestId('agent-review').getByRole('button', { name: /Add a forest color/ }).click()
    // Previewed on the real board: the exact paint, marked as new, nothing saved yet.
    await page.getByTestId('preview-on-board').click()
    const proposed = page.locator('[data-preview="added"]', { hasText: 'Proposed forest' })
    await expect(proposed).toBeVisible()
    await expect(proposed.getByTestId('swatch-paint')).toHaveCSS('background-color', 'rgb(47, 93, 80)')
    await page.keyboard.press('Escape')
    await expect(colors(page)).toHaveCount(0)
    await page.getByTestId('board-more').click()
    await page.getByTestId('agent-proposals').click()
    await page.getByTestId('agent-review').getByRole('button', { name: /Add a forest color/ }).click()
    await page.getByTestId('approve-agent-proposal').click()
    await expect(colors(page)).toContainText('Proposed forest')
    await page.getByTestId('reverse-agent-proposal').click()
    await expect(colors(page)).toHaveCount(0)
  } finally { await page.request.delete(`/api/agent-connections/${connectionId}`) }
})

test('a signed-in view-only recipient cannot change a private swatch through UI or API', async ({ page, browser }) => {
  const id = await createForest(page)
  const privateBoard = crypto.randomUUID()
  expect((await postSync(page.request, { data: { changes: [
    { id: privateBoard, patch: { id: privateBoard, kind: 'board', parentId: null, title: 'Private palette QA', icon: 'paw', color: 'none', createdAt: Date.now() } },
    { id, patch: { boardId: privateBoard } },
  ] } })).ok()).toBe(true)
  const recipient = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'x-doggynote-protocol': '2' } })
  try {
    expect((await recipient.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
    expect((await postSync(recipient.request, { data: { changes: [{ id, patch: { swatchHex: '#FFFFFF' } }] } })).status()).toBe(403)
    const grant = await page.request.post(`/api/boards/${privateBoard}/members`, { data: { username: 'fido', permission: 'view', includeChildren: false } })
    expect(grant.status()).toBe(201)
    const viewer = await recipient.newPage()
    await viewer.goto(`/#/b/${privateBoard}`)
    await expect(colors(viewer)).toContainText('Forest')
    await expect(viewer.getByTestId('edit-swatch')).toHaveCount(0)
    await viewer.getByTestId('swatch-paint').click()
    await viewer.keyboard.press('Enter')
    await expect(viewer.getByTestId('swatch-hex-input')).toHaveCount(0)
    expect((await postSync(recipient.request, { data: { changes: [{ id, patch: { swatchName: 'Forbidden' } }] } })).status()).toBe(403)
    await viewer.reload()
    await expect(viewer.getByTestId('swatch-value')).toHaveText('#2F5D50')
    await expect(colors(viewer)).toContainText('Forest')
  } finally { await recipient.close() }
})


test('the color editor stays bounded at compact sizes and restores keyboard focus', async ({ page }) => {
  await createForest(page)
  for (const width of [360, 600, 720, 1440]) {
    await page.setViewportSize({ width, height: 480 })
    // At very narrow widths the card can be off-screen; keyboard selection is
    // already retained and Enter opens the same editor regardless of camera.
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Edit color' })
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('swatch-hex-input')).toBeFocused()
    const done = dialog.getByRole('button', { name: 'Done', exact: true })
    const bounds = (await dialog.boundingBox())!
    const button = (await done.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(480)
    expect(button.y + button.height).toBeLessThanOrEqual(480)
    await page.getByTestId('swatch-hex-input').fill('#2')
    await page.keyboard.press('Shift+Tab')
    await expect(done).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('edit-swatch')).toBeFocused()
  }
})

test('a thousand swatches use overview and culling without idle editors', async ({ page }) => {
  await freshBoard(page)
  const boardId = page.url().split('/b/')[1]
  const objects = Array.from({ length: 1000 }, (_, i) => ({ id: crypto.randomUUID(), kind: 'card', type: 'swatch', boardId, x: (i % 40) * 260, y: Math.floor(i / 40) * 270, w: 220, h: 220, z: i, color: 'none', content: {}, swatchHex: ['#FFFFFF', '#000000', '#FF00FF', '#2F5D50'][i % 4], swatchName: `Color ${i}`, swatchCaption: 'Synthetic performance fixture', swatchHexDraft: null, createdAt: Date.now() }))
  for (let i = 0; i < objects.length; i += 200) {
    const response = await postSync(page.request, { data: { changes: objects.slice(i, i + 200).map((object) => ({ id: object.id, patch: object })) } })
    expect(response.ok(), await response.text()).toBe(true)
  }
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await waitForSync(page)
  // Reload restores the device's saved camera. Explicitly fit the newly seeded
  // board rather than assuming that reload discards that user preference.
  await page.keyboard.press(`${MOD}+1`)
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  await expect(colors(page)).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Edit color' })).toHaveCount(0)
  await page.keyboard.press(`${MOD}+0`)
  await expect.poll(async () => (await camera(page)).zoom).toBe(1)
  await expect.poll(() => colors(page).count()).toBeGreaterThan(0)
  await expect.poll(() => colors(page).count()).toBeLessThan(200)
  await expect(page.locator('.color-card-editor')).toHaveCount(0)
})

test('clipboard failure leaves no hidden input and keeps a usable copy control', async ({ page, browserName }) => {
  await createForest(page)
  // Fault injection is limited to this isolated page; the primary copy test
  // checks the actual clipboard without replacing browser APIs.
  await page.evaluate(() => {
    document.execCommand = () => { throw new DOMException('Clipboard blocked', 'NotAllowedError') }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  })
  const copy = page.getByTestId('copy-swatch')
  // Use WebKit/macOS's Option-Tab navigation policy for clickable controls;
  // verify buffer cleanup restores the actual keyboard-invoking control.
  await expect(page.getByTestId('edit-swatch')).toBeFocused()
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Shift+Tab' : 'Shift+Tab')
  await expect(copy).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(copy).toHaveText('Select HEX to copy')
  await expect(copy).toBeFocused()
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.getByTestId('swatch-value')).toHaveText('#2F5D50')
  await page.getByTestId('edit-swatch').click()
  await expect(page.getByTestId('swatch-hex-input')).toBeFocused()
})

test('malformed incoming swatch fields render safely and can be corrected', async ({ page, browser }) => {
  const id = await createForest(page)
  const recovery = await browser.newContext({ storageState: AUTH_FILE })
  let corrupted = false
  try {
    // Simulate a malformed historical/remote record at the sync boundary. The
    // real server rejects these types on write; this checks client recovery.
    await recovery.route('**/api/sync?*', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      for (const object of body.objects ?? []) if (object.id === id) {
        Object.assign(object, {
          swatchHex: 'url(https://invalid.example/color)',
          swatchName: { unexpected: 'name' },
          swatchCaption: ['unexpected caption'],
          swatchHexDraft: { unexpected: 'draft' },
        })
        corrupted = true
      }
      await route.fulfill({ response, json: body })
    })
    const other = await recovery.newPage()
    await other.goto(page.url())
    await expect(other.getByTestId('swatch-name')).toHaveText('Untitled color')
    expect(corrupted).toBe(true)
    await expect(other.getByTestId('swatch-value')).toHaveText('#2F5D50')
    await expect(other.getByTestId('swatch-paint')).toHaveCSS('background-color', 'rgb(47, 93, 80)')
    await expect(colors(other)).not.toContainText('[object Object]')
    await expect(colors(other)).not.toContainText('unexpected caption')
    await recovery.unroute('**/api/sync?*')
    await other.getByTestId('edit-swatch').click()
    await expect(other.getByTestId('swatch-hex-input')).toHaveValue('#2F5D50')
    await expect(other.getByTestId('swatch-name-input')).toHaveValue('')
    await expect(other.getByTestId('swatch-caption-input')).toHaveValue('')
    await other.getByTestId('swatch-hex-input').fill('#010203')
    await other.getByTestId('swatch-name-input').fill('Recovered color')
    await other.getByTestId('swatch-caption-input').fill('Corrected through the editor')
    await other.keyboard.press('Escape')
    await waitForSync(other)
    await page.reload()
    await expect(page.getByTestId('swatch-value')).toHaveText('#010203')
    await expect(colors(page)).toContainText('Recovered color')
    await expect(colors(page)).toContainText('Corrected through the editor')
  } finally { await recovery.close() }
})
