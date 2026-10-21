import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { MOD, dragBy, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

test.use({ screenshot: 'only-on-failure', trace: 'retain-on-failure' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const events: unknown[] = []
    ;(window as unknown as { __inkEvents: unknown[] }).__inkEvents = events
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      document.addEventListener(type, (event) => {
        if (!(event.target as Element)?.closest?.('[data-testid="ink-surface"]')) return
        const e = event as PointerEvent
        const surface = (event.target as Element).closest('[data-testid="ink-surface"]')!
        const image = surface.querySelector('img')
        events.push({ type, at: performance.now(), x: e.clientX, y: e.clientY, pointer: e.pointerId, focused: document.hasFocus(), imageReady: surface.getAttribute('data-image-ready'), imageComplete: image?.complete, bounds: surface.getBoundingClientRect().toJSON() })
      }, true)
    }
    window.addEventListener('blur', () => events.push({ type: 'blur', at: performance.now() }))
    document.addEventListener('visibilitychange', () => events.push({ type: 'visibility', state: document.visibilityState, at: performance.now() }))
    for (const type of ['keydown', 'keyup']) document.addEventListener(type, (event) => {
      const e = event as KeyboardEvent
      events.push({ type, at: performance.now(), key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, target: (e.target as HTMLElement)?.tagName, targetTestId: (e.target as HTMLElement)?.dataset?.testid })
    }, true)
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node instanceof Element && (node.matches('[data-testid="ink-surface"]') || node.querySelector('[data-testid="ink-surface"]'))) events.push({ type: 'surface-removed', at: performance.now() })
      }
    }).observe(document, { childList: true, subtree: true })
  })
})

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return
  const state = await page.evaluate(() => ({ events: (window as unknown as { __inkEvents: unknown[] }).__inkEvents, marks: [...document.querySelectorAll('[data-testid="stroke-editor"] [data-stroke-id]')].map((el) => ({ id: el.getAttribute('data-stroke-id'), path: el.getAttribute('d'), color: el.getAttribute('stroke'), opacity: el.getAttribute('stroke-opacity') })) })).catch(() => null)
  await info.attach('annotation-input-state', { body: JSON.stringify(state, null, 2), contentType: 'application/json' })
})

async function seed(page: Page, dimensions = { width: 800, height: 500 }) {
  await freshBoard(page, `Annotations ${crypto.randomUUID().slice(0, 6)}`)
  const boardId = decodeURIComponent(page.url().split('#/b/')[1])
  const png = Buffer.from(await page.evaluate(async ({ width, height }) => {
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!
    ctx.scale(width / 800, height / 500)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, 500)
    ctx.fillStyle = '#dde3ea'; ctx.fillRect(20, 20, 120, 460)
    ctx.fillStyle = '#245fe5'; ctx.fillRect(180, 70, 170, 70)
    ctx.fillStyle = '#292d35'; ctx.font = '24px sans-serif'; ctx.fillText('Asymmetrical QA reference', 180, 220)
    ctx.fillStyle = '#e8ebee'; ctx.fillRect(460, 290, 280, 150)
    return [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())]
  }, dimensions))
  const assetId = crypto.randomUUID(), id = crypto.randomUUID()
  for (const size of ['thumb', 'small', 'medium', 'full']) expect((await page.request.put(`/api/assets/${assetId}/${size}`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { id, kind: 'card', type: 'image', boardId, x: 60, y: 100, w: 480, h: 300, z: 1, color: 'none', createdAt: Date.now(), imageCaption: 'Warm side lighting; use for the opening scene.', imageSourceUrl: 'https://example.test/original-reference', content: { assetId, width: dimensions.width, height: dimensions.height, caption: 'Synthetic screenshot', sizes: ['thumb', 'small', 'medium', 'full'] } } }] } })).ok()).toBe(true)
  await page.reload()
  const card = page.locator(`[data-card-id="${id}"]`)
  await expect(card.getByTestId('card-image')).toBeVisible()
  await waitForSync(page)
  return { id, boardId, assetId, png, card }
}
async function open(page: Page, id: string) {
  const card = page.locator(`[data-card-id="${id}"]`)
  await card.getByTestId('image-viewport').click()
  await page.getByTestId('annotate-image').click()
  await expect(page.getByTestId('stroke-editor')).toBeVisible()
  await expect.poll(() => page.getByTestId('ink-surface').locator('img').evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true)
}
async function draw(page: Page, ps: [number, number][]) {
  const r = await page.getByTestId('ink-surface').boundingBox()
  if (!r) throw Error('No drawing surface')
  await page.mouse.move(r.x + ps[0][0] * r.width, r.y + ps[0][1] * r.height)
  await page.mouse.down()
  for (const [x, y] of ps.slice(1)) await page.mouse.move(r.x + x * r.width, r.y + y * r.height, { steps: 3 })
  await page.mouse.up()
}
const marks = (page: Page) => page.getByTestId('stroke-editor').locator('[data-stroke-id]')

test('circle, arrow, highlight, cancellation, stroke erase/undo, resize/reopen, original and PNG export', async ({ page }) => {
  const { id, png, card } = await seed(page)
  await open(page, id)
  await draw(page, Array.from({ length: 25 }, (_, i) => [0.33 + Math.cos(i * Math.PI / 12) * 0.14, 0.21 + Math.sin(i * Math.PI / 12) * 0.12] as [number, number]))
  await expect(marks(page)).toHaveCount(1)
  await draw(page, [[0.6, 0.5], [0.8, 0.7], [0.73, 0.69], [0.8, 0.7], [0.79, 0.6]])
  await expect(marks(page)).toHaveCount(2)
  await page.getByRole('button', { name: 'Highlighter', exact: true }).click()
  await page.getByRole('button', { name: 'Yellow', exact: true }).click()
  await draw(page, [[0.25, 0.48], [0.65, 0.48]])
  await expect(marks(page)).toHaveCount(3)
  await expect(marks(page).last()).toHaveAttribute('stroke-opacity', '0.3')
  await page.screenshot({ path: test.info().outputPath('populated-annotation-editor.png') })
  const surface = await page.getByTestId('ink-surface').boundingBox()
  await page.mouse.move(surface!.x + 15, surface!.y + 15); await page.mouse.down()
  await page.mouse.move(surface!.x + 55, surface!.y + 55)
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(marks(page)).toHaveCount(3)
  await page.getByRole('button', { name: 'Eraser', exact: true }).click()
  await draw(page, [[0.32, 0.1], [0.35, 0.1]])
  await expect(marks(page)).toHaveCount(2)
  await page.getByTestId('stroke-editor').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(marks(page)).toHaveCount(3)
  await page.getByTestId('stroke-editor').getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(marks(page)).toHaveCount(2)
  await page.keyboard.press(`${MOD}+z`)
  await expect(marks(page)).toHaveCount(3)
  await page.screenshot({ path: test.info().outputPath('erase-undo-restored.png') })
  const original = await page.request.get((await page.getByTestId('download-original').getAttribute('href'))!)
  expect(await original.body()).toEqual(png)
  expect(original.headers()['content-disposition']).toContain('attachment')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  const before = await card.evaluate((el: HTMLElement) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: el.clientWidth }))
  await dragBy(page, card, 50, 30)
  await expect.poll(() => card.evaluate((el: HTMLElement) => parseFloat(el.style.left))).toBeGreaterThan(before.x)
  await expect.poll(() => card.evaluate((el: HTMLElement) => parseFloat(el.style.top))).toBeGreaterThan(before.y)
  await dragBy(page, card.getByTestId('resize-handle'), 100, 50)
  await expect.poll(() => card.evaluate((el: HTMLElement) => el.clientWidth)).toBeGreaterThan(before.width)
  const resizedWidth = await card.evaluate((el: HTMLElement) => el.clientWidth)
  await waitForSync(page); await page.reload()
  await expect.poll(() => card.evaluate((el: HTMLElement) => el.clientWidth)).toBe(resizedWidth)
  await expect(card.locator('[data-stroke-id]')).toHaveCount(3)
  await expect(card.getByTestId('image-caption')).toHaveText('Warm side lighting; use for the opening scene.')
  await expect(card.getByTestId('image-source')).toHaveAttribute('href', 'https://example.test/original-reference')
  await page.screenshot({ path: test.info().outputPath('resized-image-reloaded.png') })
  await open(page, id); await expect(marks(page)).toHaveCount(3)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByTestId('board-more').click(); await page.getByTestId('export').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-go').click()
  const bytes = await readFile((await (await download).path())!)
  const redPixels = await page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }))
    const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let red = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] > 170 && data[i + 1] < 80 && data[i + 2] < 100) red++
    return red
  }, bytes.toString('base64'))
  expect(redPixels).toBeGreaterThan(100)
  await writeFile(test.info().outputPath('annotated-board-export.png'), bytes)
})

test('offline edits and concurrent additions survive reconnect and eraser undo', async ({ page, browser }) => {
  const { id } = await seed(page)
  const second = await browser.newContext({ storageState: await page.context().storageState() })
  const other = await second.newPage()
  try {
    await other.goto(page.url()); await open(other, id)
    await open(page, id)
    await page.context().setOffline(true)
    await draw(page, [[0.2, 0.2], [0.4, 0.3]])
    await draw(other, [[0.7, 0.7], [0.8, 0.8]])
    await waitForSync(other)
    await page.context().setOffline(false)
    await waitForSync(page)
    await expect(marks(page)).toHaveCount(2, { timeout: 15000 })
    await expect(marks(other)).toHaveCount(2, { timeout: 15000 })
    await page.getByRole('button', { name: 'Eraser', exact: true }).click()
    await draw(page, [[0.2, 0.2], [0.3, 0.25]])
    await expect(marks(page)).toHaveCount(1)
    await page.getByTestId('stroke-editor').getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(marks(page)).toHaveCount(2)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await waitForSync(page); await page.reload()
    await expect(page.locator(`[data-card-id="${id}"] [data-stroke-id]`)).toHaveCount(2)
  } finally { await page.context().setOffline(false); await second.close() }
})

test('read-only share renders annotations and rejects unauthenticated mutation', async ({ page, browser }) => {
  const { id, boardId } = await seed(page)
  await open(page, id); await draw(page, [[0.2, 0.3], [0.4, 0.3]])
  await page.getByRole('button', { name: 'Done', exact: true }).click(); await waitForSync(page)
  const response = await page.request.post('/api/shares', { data: { boardId } })
  expect(response.ok()).toBe(true)
  const { share } = await response.json()
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } }), viewer = await context.newPage()
  try {
    await viewer.goto(new URL(`/s/${share.token}`, page.url()).href)
    await expect(viewer.locator(`[data-card-id="${id}"] [data-stroke-id]`)).toHaveCount(1)
    await viewer.getByTestId('image-viewport').dblclick()
    await expect(viewer.getByTestId('stroke-editor')).toHaveCount(0)
    await expect(viewer.getByTestId('annotate-image')).toHaveCount(0)
    const denied = await viewer.request.post(new URL('/api/sync', page.url()).href, { headers: { 'x-doggynote-protocol': '2' }, data: { changes: [{ id, patch: { x: 999 } }] } })
    expect([401, 403]).toContain(denied.status())
  } finally { await context.close() }
})

test('remote image trash exits markup and restore does not reopen a stale editing mode', async ({ page }) => {
  const { id, card } = await seed(page)
  await open(page, id)
  await draw(page, [[0.2, 0.2], [0.4, 0.2]])
  await waitForSync(page)
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { deletedAt: Date.now() } }] } })).ok()).toBe(true)
  await expect(page.getByTestId('stroke-editor')).toHaveCount(0, { timeout: 15000 })
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { deletedAt: null } }] } })).ok()).toBe(true)
  await expect(card).toBeVisible({ timeout: 15000 })
  await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
  await expect(page.getByTestId('stroke-editor')).toHaveCount(0)
  await open(page, id)
  await expect(marks(page)).toHaveCount(1)
})

test('local storage failure is visible inside markup and retry keeps the completed stroke', async ({ page }) => {
  const { id, card } = await seed(page)
  await open(page, id)
  // Fault only this context's document storage, after sign-in and image loading.
  await page.evaluate(() => {
    const w = window as unknown as { __inkStorageFailure?: boolean }
    w.__inkStorageFailure = true
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (w.__inkStorageFailure && this.name === 'objects' && (value as { kind?: string })?.kind === 'stroke') throw new DOMException('Synthetic annotation quota failure', 'QuotaExceededError')
      return put.call(this, value, key!)
    }
  })
  await draw(page, [[0.3, 0.3], [0.5, 0.3]])
  const editor = page.getByTestId('stroke-editor')
  await expect(editor.getByRole('alert')).toContainText('could not be saved')
  await expect(marks(page)).toHaveCount(1)
  await page.evaluate(() => { (window as unknown as { __inkStorageFailure: boolean }).__inkStorageFailure = false })
  await editor.getByRole('button', { name: 'Retry saving', exact: true }).click()
  await expect(editor.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page); await page.reload()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
})

test('Space drag pans after choosing a toolbar tool and preserves image-relative cursor mapping', async ({ page }) => {
  const { id } = await seed(page)
  await open(page, id)
  const editor = page.getByTestId('stroke-editor'), viewport = page.getByTestId('ink-viewport')
  await editor.getByRole('button', { name: 'Zoom in drawing', exact: true }).click()
  await editor.getByRole('button', { name: 'Pen', exact: true }).click()
  const r = await viewport.boundingBox()
  const before = await viewport.evaluate((el) => el.scrollLeft)
  await page.keyboard.down('Space')
  await page.mouse.move(r!.x + r!.width * 0.7, r!.y + r!.height * 0.5)
  await page.mouse.down(); await page.mouse.move(r!.x + r!.width * 0.3, r!.y + r!.height * 0.5, { steps: 8 }); await page.mouse.up()
  await page.keyboard.up('Space')
  await expect(marks(page)).toHaveCount(0)
  expect(await viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before)
  await editor.getByRole('button', { name: 'Fit', exact: true }).click()
  await draw(page, [[0.25, 0.5], [0.6, 0.5]])
  await expect(marks(page)).toHaveCount(1)
  const path = (await marks(page).getAttribute('d'))!.match(/^M (\S+) (\S+)/)!
  const fitted = (await page.getByTestId('ink-surface').boundingBox())!
  // WebKit dispatches integer CSS pointer coordinates. The recorded input at
  // combined64752f3 differs from its requested position by <1 CSS pixel;
  // retain the logical target, but bound cursor error in rendered pixels.
  expect(Math.abs(Number(path[1]) - 200) * fitted.width / 800).toBeLessThan(1)
  expect(Math.abs(Number(path[2]) - 250) * fitted.height / 500).toBeLessThan(1)
})

test('a tiny original opens at a useful fitted size and keeps original-pixel mark geometry', async ({ page }) => {
  const { id } = await seed(page, { width: 16, height: 10 })
  await open(page, id)
  await expect.poll(async () => (await page.getByTestId('ink-surface').boundingBox())!.width).toBeGreaterThan(300)
  await draw(page, [[0.25, 0.5], [0.6, 0.5]])
  await expect(marks(page)).toHaveCount(1)
  const path = (await marks(page).getAttribute('d'))!.match(/^M (\S+) (\S+)/)!
  expect(Number(path[1])).toBeCloseTo(4, 1)
  expect(Number(path[2])).toBeCloseTo(5, 1)
})

test('one erase gesture removes several strokes and one Undo restores their identities', async ({ page }) => {
  const { id, card } = await seed(page)
  await open(page, id)
  for (const y of [0.25, 0.5, 0.75]) await draw(page, [[0.25, y], [0.75, y]])
  await expect(marks(page)).toHaveCount(3)
  const identities = await marks(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-stroke-id')))
  const editor = page.getByTestId('stroke-editor')
  await editor.getByRole('button', { name: 'Eraser', exact: true }).click()
  await draw(page, [[0.5, 0.15], [0.5, 0.85]])
  await expect(marks(page)).toHaveCount(0)
  await editor.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(marks(page)).toHaveCount(3)
  expect(await marks(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-stroke-id')))).toEqual(identities)
  await editor.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(marks(page)).toHaveCount(0)
  await editor.getByRole('button', { name: 'Undo', exact: true }).click()
  await editor.getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page); await page.reload()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(3)
  expect(await card.locator('[data-stroke-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-stroke-id')))).toEqual(identities)
})

test('position-locked image accepts annotation edits while its placement stays unchanged', async ({ page }) => {
  const { id, card } = await seed(page)
  await card.getByTestId('image-viewport').click()
  await page.getByTestId('position-lock').click()
  await expect(page.getByTestId('position-lock')).toHaveAccessibleName('Unlock position')
  await expect(card.getByTestId('resize-handle')).toHaveCount(0)
  await waitForSync(page)
  const before = (await pullAllObjects(page.request)).objects.find((o: { id: string }) => o.id === id)
  expect(before.positionLocked).toBe(true)
  await open(page, id)
  await draw(page, [[0.2, 0.35], [0.7, 0.35]])
  await expect(marks(page)).toHaveCount(1)
  await page.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page); await page.reload()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
  const after = (await pullAllObjects(page.request)).objects.find((o: { id: string }) => o.id === id)
  expect({ x: after.x, y: after.y, w: after.w, positionLocked: after.positionLocked }).toEqual({ x: before.x, y: before.y, w: before.w, positionLocked: true })
  await open(page, id)
  await expect(marks(page)).toHaveCount(1)
})

test('pending original lookup keeps keyboard actions in its dialog and Escape returns to the board', async ({ page }) => {
  const { card, assetId } = await seed(page)
  // Delay only this image's device-cache lookup, not unrelated sync or assets.
  await page.evaluate((assetId) => {
    const w = window as unknown as { __resumeInkLookup?: () => void }
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function(key) {
      const request = get.call(this, key)
      if (this.name === 'assets' && key === `${assetId}/full`) {
        request.addEventListener('success', (event) => {
          event.stopImmediatePropagation()
          w.__resumeInkLookup = () => {
            IDBObjectStore.prototype.get = get
            request.onsuccess?.call(request, event)
          }
        }, { once: true })
      }
      return request
    }
  }, assetId)
  await card.getByTestId('image-viewport').click()
  await page.getByTestId('annotate-image').click()
  const loading = page.getByRole('dialog', { name: 'Load image annotations', exact: true })
  await expect(loading.getByRole('status')).toHaveText('Loading image…')
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __resumeInkLookup?: () => void }).__resumeInkLookup)).toBe('function')
  await expect(loading.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(loading.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(loading).toHaveCount(0)
  await expect(page.getByTestId('annotate-image')).toBeFocused()
  await expect(card).toBeVisible()
  await page.evaluate(() => (window as unknown as { __resumeInkLookup: () => void }).__resumeInkLookup())
  await expect(page.getByTestId('stroke-editor')).toHaveCount(0)
})

test('a remote caption update during drawing keeps the active stroke and final attribution', async ({ page }) => {
  const { id, card } = await seed(page)
  await open(page, id)
  const r = (await page.getByTestId('ink-surface').boundingBox())!
  await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * 0.4, r.y + r.height * 0.5, { steps: 5 })
  await expect(marks(page)).toHaveCount(1)
  const identity = await marks(page).getAttribute('data-stroke-id')
  const caption = 'A collaborator clarified the lighting while this mark was being drawn.'
  expect((await postSync(page.request, { data: { changes: [{ id, patch: { imageCaption: caption } }] } })).ok()).toBe(true)
  await expect(card.getByTestId('image-caption')).toHaveText(caption, { timeout: 15000 })
  await expect(marks(page)).toHaveCount(1)
  await expect(marks(page)).toHaveAttribute('data-stroke-id', identity!)
  await page.mouse.move(r.x + r.width * 0.7, r.y + r.height * 0.5, { steps: 5 })
  await page.mouse.up()
  await expect(marks(page)).toHaveCount(1)
  await expect(marks(page)).toHaveAttribute('data-stroke-id', identity!)
  await page.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page); await page.reload()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
  await expect(card.getByTestId('image-caption')).toHaveText(caption)
  await expect(card.getByTestId('image-source')).toHaveAttribute('href', 'https://example.test/original-reference')
})

test('Bury Undo Redo stays usable but cannot hide a later collaborator annotation', async ({ page, browser }) => {
  const { id, card } = await seed(page)
  await open(page, id)
  await draw(page, [[0.2, 0.3], [0.5, 0.3]])
  await page.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
  await waitForSync(page)
  await page.getByRole('button', { name: 'Bury', exact: true }).click()
  await expect(card).toHaveCount(0)
  await page.getByTestId('undo').click()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
  await page.getByTestId('redo').click()
  await expect(card).toHaveCount(0)
  await page.getByTestId('undo').click()
  await expect(card.locator('[data-stroke-id]')).toHaveCount(1)
  await waitForSync(page)
  const peer = await browser.newContext({ storageState: await page.context().storageState() })
  try {
    const other = await peer.newPage()
    await other.goto(page.url()); await open(other, id)
    await draw(other, [[0.6, 0.7], [0.8, 0.7]])
    await expect(marks(other)).toHaveCount(2)
    await other.getByTestId('stroke-editor').getByRole('button', { name: 'Done', exact: true }).click()
    await waitForSync(other)
    await expect(card.locator('[data-stroke-id]')).toHaveCount(2, { timeout: 15000 })
    await page.getByTestId('redo').click()
    await expect(page.getByText('Cannot redo because this item changed or is no longer editable.', { exact: true })).toBeVisible()
    await expect(card.locator('[data-stroke-id]')).toHaveCount(2)
    await waitForSync(page)
    const objects = (await pullAllObjects(page.request)).objects
    expect(objects.find((o: { id: string }) => o.id === id).deletedAt).toBeNull()
    expect(objects.filter((o: { kind: string; cardId?: string; deletedAt?: number | null; purged?: boolean }) => o.kind === 'stroke' && o.cardId === id && !o.deletedAt && !o.purged)).toHaveLength(2)
  } finally { await peer.close() }
})
