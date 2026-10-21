import { resolve } from 'node:path'
import { FIXTURES } from './ports.ts'
import { expect, test } from '@playwright/test'
import { MOD, clickEmpty, freshBoard, waitForSync, postSync, pullAllObjects, dragBy } from './helpers.ts'

import { addImage } from './image-metadata.helpers.ts'

const caption = 'Warm side lighting; use for the opening scene'
const source = `${FIXTURES}/og.html`

test('caption, source, safe links, keyboard, undo and reload preserve original asset', async ({ page, context }) => {
  await freshBoard(page, 'Loop 3 isolated image research')
  await addImage(page)
  await page.getByTestId('image-metadata-done').click()
  await waitForSync(page)
  const imageId = await page.locator('.card-image').getAttribute('data-card-id')
  const original = (await pullAllObjects(page.request)).objects.find((o: any) => o.id === imageId).content
  const bytesBefore = await (await page.request.get(`/api/assets/${original.assetId}/full`)).body()
  // No caption yet: double-click the image to type one right under it.
  await page.getByTestId('image-viewport').dblclick()
  await page.getByTestId('image-caption-input').fill(caption)
  await page.getByTestId('image-source-input').fill(source)
  await page.getByTestId('image-metadata-done').click()
  await expect(page.getByTestId('image-caption')).toHaveText(caption)
  await expect(page.getByTestId('image-source')).toHaveAttribute('rel', 'noopener noreferrer')
  await waitForSync(page)
  const popup = context.waitForEvent('page')
  await page.getByTestId('image-source').click()
  const opened = await popup
  await expect(opened).toHaveURL(source)
  await opened.close()
  await clickEmpty(page)
  await page.keyboard.press(`${MOD}+z`)
  await expect(page.getByTestId('image-metadata')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(page.getByTestId('image-caption')).toHaveText(caption)
  await waitForSync(page)
  await page.reload()
  await expect(page.getByTestId('image-caption')).toHaveText(caption)
  await expect(page.getByTestId('image-source')).toHaveAttribute('href', source)
  const reopened = (await pullAllObjects(page.request)).objects.find((o: any) => o.id === imageId)
  expect(reopened.content).toEqual(original)
  expect(await (await page.request.get(`/api/assets/${original.assetId}/full`)).body()).toEqual(bytesBefore)
  await page.getByTestId('card-image').click()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('image-caption-input')).toBeFocused()
  await page.getByTestId('image-source-input').fill('file:///Users/private/photo.png')
  await expect(page.getByTestId('image-source-input')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toContainText("Invalid links aren't saved")
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('image-source')).toHaveAttribute('href', source)
})

test('long multiline caption expands; PNG includes full metadata and no controls', async ({ page }, testInfo) => {
  await freshBoard(page)
  await addImage(page)
  const long = Array.from({ length: 12 }, (_, i) => `Scene ${i + 1}: a long lighting reference with a useful observation.`).join('\n')
  await page.getByTestId('image-caption-input').fill(long)
  await page.getByTestId('image-source-input').fill('https://example.com/original-reference')
  await page.getByTestId('image-metadata-done').click()
  await expect(page.getByRole('button', { name: 'Read full caption' })).toBeVisible()
  const compact = (await page.locator('.card-image').boundingBox())!.height
  const imageId = await page.locator('.card-image').getAttribute('data-card-id')
  // The first pull can precede the new card's initial push. Let polling wait for
  // that object as well as its measured compact height instead of throwing.
  const remoteHeight = async () => (await pullAllObjects(page.request)).objects.find((o: any) => o.id === imageId)?.h
  await expect.poll(remoteHeight).toBe(Math.round(compact))
  await page.getByRole('button', { name: 'Read full caption' }).click()
  const full = (await page.locator('.card-image').boundingBox())!.height
  expect(full).toBeGreaterThan(compact + 100)
  await page.waitForTimeout(600) // allow shared-height debounce to run, if incorrectly queued
  expect(await remoteHeight()).toBe(Math.round(compact))
  await page.getByRole('button', { name: 'Show less' }).click()
  await page.getByTestId('board-more').click()
  await page.getByTestId('export').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-go').click()
  const file = await download
  const output = process.env.IMAGE_QA_ROUND ? resolve(`../../docs/qa/image-metadata/${process.env.IMAGE_QA_ROUND}-${testInfo.project.name}-caption-export.png`) : testInfo.outputPath('caption-export.png')
  await file.saveAs(output)
  const png = await import('node:fs/promises').then((fs) => fs.readFile(output))
  // Export bounds must include the expanded caption, plus 32px padding per edge.
  expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(Math.floor(full + 60))
  await testInfo.attach('Full caption PNG', { body: png, contentType: 'image/png' })
  await expect(page.getByTestId('image-metadata')).toHaveAttribute('data-expanded', 'false')
  await expect.poll(remoteHeight).toBe(Math.round(compact))
})

test('offline active caption survives reload and independent sessions merge source and caption', async ({ page, browser, context }) => {
  await freshBoard(page)
  await addImage(page)
  await page.getByTestId('image-metadata-done').click()
  await waitForSync(page)
  const otherContext = await browser.newContext({ storageState: await context.storageState() })
  const other = await otherContext.newPage()
  await other.goto(page.url())
  await expect(other.getByTestId('card-image')).toBeVisible()
  await page.getByTestId('card-image').click()
  await page.getByTestId('edit-image-metadata').click()
  await page.getByTestId('image-caption-input').fill(caption)
  await other.getByTestId('card-image').click()
  await other.getByTestId('edit-image-metadata').click()
  await other.getByTestId('image-source-input').fill(source)
  await other.getByTestId('image-metadata-done').click()
  await waitForSync(other)
  const beforeResize = (await other.getByTestId('image-viewport').boundingBox())!.width
  await dragBy(other, other.getByTestId('resize-handle'), 80, 20)
  const resizedWidth = (await other.getByTestId('image-viewport').boundingBox())!.width
  expect(resizedWidth).toBeGreaterThan(beforeResize + 40)
  await waitForSync(other)
  await expect(page.getByTestId('image-caption-input')).toHaveValue(caption)
  await page.getByTestId('image-metadata-done').click()
  await waitForSync(page)
  await page.reload(); await other.reload()
  for (const p of [page, other]) {
    await expect(p.getByTestId('image-caption')).toHaveText(caption)
    await expect(p.getByTestId('image-source')).toHaveAttribute('href', source)
    expect((await p.getByTestId('image-viewport').boundingBox())!.width).toBeCloseTo(resizedWidth, 0)
  }
  await otherContext.close()
  // Keep the browser shell available; isolate a backend outage across reload.
  // Native restart uses bundled shell assets and is verified separately.
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'))
  await page.getByRole('button', { name: 'Edit image caption and source' }).click()
  await page.getByTestId('image-caption-input').fill('Offline active caption survives restart')
  await page.waitForTimeout(600) // durable IDB checkpoint, while editor remains active
  await page.reload()
  await expect(page.getByTestId('image-caption')).toHaveText('Offline active caption survives restart')
  await page.unroute('**/api/**')
  await waitForSync(page)
  await page.reload()
  await expect(page.getByTestId('image-caption')).toHaveText('Offline active caption survives restart')
})

test('read-only share renders metadata and refuses source writes server-side', async ({ page, browser }) => {
  await freshBoard(page)
  await addImage(page)
  await page.getByTestId('image-caption-input').fill(caption)
  await page.getByTestId('image-source-input').fill(source)
  await page.getByTestId('image-metadata-done').click()
  await waitForSync(page)
  const id = await page.locator('.card-image').getAttribute('data-card-id')
  await page.getByTestId('board-more').click()
  await page.getByTestId('share').click()
  await page.getByTestId('create-share').click()
  const url = await page.getByTestId('share-url').first().inputValue()
  const viewerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const viewer = await viewerContext.newPage()
  await viewer.goto(url)
  await expect(viewer.getByTestId('image-caption')).toHaveText(caption)
  await expect(viewer.getByTestId('image-source')).toHaveAttribute('href', source)
  await expect(viewer.getByRole('button', { name: 'Edit image caption and source' })).toHaveCount(0)
  const denied = await postSync(viewer.request, { data: { changes: [{ id, patch: { imageSourceUrl: 'https://example.com/stolen' } }] } })
  expect([401, 403]).toContain(denied.status())
  await viewerContext.close()
})

test('image clipboard attribution is preserved only for a reliable web address', async ({ page }) => {
  await freshBoard(page)
  const unexpectedRequests: string[] = []
  await page.route('https://example.com/**', (route) => { unexpectedRequests.push(route.request().url()); return route.abort() })
  async function paste(html: string) {
    await page.evaluate(async (html) => {
      const canvas = new OffscreenCanvas(20, 20)
      canvas.getContext('2d')!.fillRect(0, 0, 20, 20)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], 'local-filename.png', { type: 'image/png' }))
      transfer.setData('text/html', html)
      document.querySelector('[data-testid="canvas"]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, html)
  }
  // Synthetic clipboard payload supplements the actual-input import/edit tests above.
  await paste('<a href="https://example.com/original-page"><img src="https://example.com/image.png"></a>')
  await expect(page.getByTestId('image-source')).toHaveAttribute('href', 'https://example.com/original-page')
  await clickEmpty(page)
  await paste('<img src="file:///Users/private/photo.png">')
  await expect(page.getByTestId('card-image')).toHaveCount(2)
  await expect(page.getByTestId('image-source')).toHaveCount(1)
  await waitForSync(page)
  const boardId = decodeURIComponent(page.url().split('#/b/')[1])
  const images = (await pullAllObjects(page.request)).objects.filter((o: any) => o.type === 'image' && o.boardId === boardId)
  expect(images.some((o: any) => JSON.stringify(o).includes('/Users/'))).toBe(false)
  expect(images.find((o: any) => o.imageSourceUrl)?.w).toBe(160)
  expect(unexpectedRequests).toEqual([])
})

for (const [shape, width, height] of [['small', 20, 20], ['wide', 1200, 100], ['tall', 100, 1200]] as const) {
  test(`${shape} image keeps readable editing and original geometry with optional metadata`, async ({ page }) => {
    await freshBoard(page)
    await addImage(page, width, height)
    const editor = page.getByRole('group', { name: 'Image caption and source', exact: true })
    await expect(editor).toBeVisible()
    await expect(page.locator('.dialog-backdrop')).toHaveCount(0)
    await page.getByTestId('image-caption-input').fill(`${shape} image: preserve original pixels and multiline context.\nOpening scene.`)
    await page.getByTestId('image-source-input').fill('https://example.com/reference')
    await page.getByTestId('image-source-input').fill('')
    await page.getByTestId('image-metadata-done').click()
    await expect(page.getByTestId('image-source')).toHaveCount(0)
    const viewport = await page.getByTestId('image-viewport').boundingBox()
    expect(viewport!.width / viewport!.height).toBeCloseTo(width / height, 1)
    await waitForSync(page)
    await page.reload()
    await expect(page.getByTestId('image-caption')).toContainText(`${shape} image: preserve original pixels`)
    await expect(page.getByTestId('image-source')).toHaveCount(0)
  })
}

test('column layout stays stable during metadata editing and disclosure height stays local', async ({ page }, info) => {
  await freshBoard(page)
  await addImage(page)
  await page.getByTestId('image-caption-input').fill(Array.from({ length: 10 }, (_, i) => `Lighting reference ${i + 1}: preserve this context.`).join('\n'))
  await page.getByTestId('image-source-input').fill(source)
  await page.getByTestId('image-metadata-done').click()
  await waitForSync(page)
  const imageId = await page.locator('.card-image').getAttribute('data-card-id')
  const image = (await pullAllObjects(page.request)).objects.find((o: any) => o.id === imageId)
  const columnId = crypto.randomUUID(), noteId = crypto.randomUUID()
  const base = { kind: 'card', boardId: image.boardId, x: image.x, y: image.y, w: 300, h: 80, z: 1, color: 'none', createdAt: Date.now() }
  const written = await postSync(page.request, { data: { changes: [
    { id: columnId, patch: { ...base, id: columnId, type: 'column', content: { title: 'Opening scene references' } } },
    { id: imageId, patch: { columnId, order: 1 } },
    { id: noteId, patch: { ...base, id: noteId, type: 'note', columnId, order: 2, content: { md: 'The following note keeps its place while editing.' } } },
  ] } })
  expect(written.ok(), await written.text()).toBe(true)
  await page.reload()
  const column = page.locator(`[data-card-id="${columnId}"]`)
  const following = page.locator(`[data-card-id="${noteId}"]`)
  await expect(following).toBeVisible()
  const compactTop = await following.evaluate((el: HTMLElement) => el.offsetTop)
  const compactHeight = await column.evaluate((el: HTMLElement) => el.offsetHeight)
  const remoteHeight = async () => (await pullAllObjects(page.request)).objects.find((o: any) => o.id === columnId).h
  await expect.poll(remoteHeight).toBe(compactHeight)
  await page.getByRole('button', { name: 'Edit image caption and source' }).click()
  await expect(page.getByTestId('image-caption-input')).toBeFocused()
  // Editing in place shows the whole caption, like a note; neighbours only move down.
  expect(await following.evaluate((el: HTMLElement) => el.offsetTop)).toBeGreaterThanOrEqual(compactTop)
  if (process.env.IMAGE_QA_ROUND) await page.screenshot({ path: resolve(`../../docs/qa/image-metadata/${process.env.IMAGE_QA_ROUND}-${info.project.name}-column-editor.png`) })
  await page.getByTestId('image-metadata-done').click()
  await expect.poll(() => following.evaluate((el: HTMLElement) => el.offsetTop)).toBe(compactTop)
  await expect.poll(remoteHeight, { timeout: 10_000 }).toBe(compactHeight)
  await page.getByRole('button', { name: 'Read full caption' }).click()
  await expect.poll(() => following.evaluate((el: HTMLElement) => el.offsetTop)).toBeGreaterThan(compactTop + 50)
  await page.waitForTimeout(600)
  expect(await remoteHeight()).toBe(compactHeight)
  await page.getByRole('button', { name: 'Show less' }).click()
  await expect.poll(() => following.evaluate((el: HTMLElement) => el.offsetTop)).toBe(compactTop)
})
