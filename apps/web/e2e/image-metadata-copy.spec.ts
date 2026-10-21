// Scoped handoff for the actual Loop 6 + Loop 3 implementation. Install unchanged
// at apps/web/e2e/image-metadata-copy.spec.ts in the combined branch before running.
// This authoring copy is outside testDir: the standalone Loop 3 branch does not
// implement duplication/templates. No stub or skipped runtime proof is used.
import { expect, test, type Page, type Locator } from '@playwright/test'
import { addImage } from './image-metadata.helpers.ts'
import { freshBoard, pullAllObjects, waitForSync } from './helpers.ts'

const caption = 'Warm side lighting; use for the opening scene.'
const source = 'https://example.com/original-reference'
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`)

async function enteredImage(page: Page) {
  await addImage(page)
  await page.getByTestId('image-caption-input').fill(caption)
  await page.getByTestId('image-source-input').fill(source)
  await page.getByTestId('image-metadata-done').click()
  await waitForSync(page)
  const id = (await page.locator('.card-image').getAttribute('data-card-id'))!
  await expect.poll(async () => (await pullAllObjects(page.request)).objects.some((o: any) => o.id === id)).toBe(true)
  const original = (await pullAllObjects(page.request)).objects.find((o: any) => o.id === id)
  const bytes = await (await page.request.get(`/api/assets/${original.content.assetId}/full`)).body()
  return { id, original, bytes }
}

async function metadata(image: Locator, text = caption, url = source) {
  await expect(image.getByTestId('image-caption')).toHaveText(text)
  await expect(image.getByTestId('image-source')).toHaveAttribute('href', url)
}

async function revise(page: Page, image: Locator, text: string, url: string) {
  await image.getByRole('button', { name: 'Edit image caption and source', exact: true }).click()
  await page.getByTestId('image-caption-input').fill(text)
  await page.getByTestId('image-source-input').fill(url)
  await page.getByTestId('image-metadata-done').click()
  await metadata(image, text, url)
  await waitForSync(page)
}

async function templates(page: Page, action: string) {
  await page.getByTestId('board-more').click()
  await page.getByTestId(action).click()
  await expect(page.getByTestId('templates-dialog')).toBeVisible()
}

test('real entered image metadata survives selection duplication and independent edits', async ({ page }) => {
  await freshBoard(page, 'Image attribution selection copy')
  const { id, original, bytes } = await enteredImage(page)
  await page.getByTestId('duplicate-selection').click()
  await expect(page.locator('.card-image')).toHaveCount(2)
  const copy = page.locator('.card-image.selected')
  const copyId = (await copy.getAttribute('data-card-id'))!
  expect(copyId).not.toBe(id)
  await metadata(copy)
  await metadata(card(page, id))
  await revise(page, copy, 'Copy-only lighting observation', 'https://example.com/copy-reference')
  await metadata(card(page, id))
  await page.reload()
  await metadata(card(page, id))
  await metadata(card(page, copyId), 'Copy-only lighting observation', 'https://example.com/copy-reference')
  const objects = (await pullAllObjects(page.request)).objects
  expect(objects.find((o: any) => o.id === id)).toMatchObject({ imageCaption: caption, imageSourceUrl: source, content: original.content })
  expect(objects.find((o: any) => o.id === copyId).content).toEqual(original.content)
  expect(await (await page.request.get(`/api/assets/${original.content.assetId}/full`)).body()).toEqual(bytes)
})

test('real entered attribution survives board copy and saved layout reuse independently', async ({ page }) => {
  await freshBoard(page, 'Image attribution reusable layout')
  const originalUrl = page.url()
  const { id, original, bytes } = await enteredImage(page)
  const name = `Lighting references ${crypto.randomUUID()}`
  await templates(page, 'save-template')
  await page.getByTestId('template-name').fill(name)
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('templates-dialog')).toHaveCount(0)
  await waitForSync(page)
  await page.reload()

  await templates(page, 'duplicate-board')
  await page.getByTestId('template-name').fill('Independent lighting board')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Independent lighting board')
  const copiedImage = page.locator('.card-image')
  await metadata(copiedImage)
  expect(await copiedImage.getAttribute('data-card-id')).not.toBe(id)
  await revise(page, copiedImage, 'Board-copy observation', 'https://example.com/board-copy')
  await page.reload()
  await metadata(page.locator('.card-image'), 'Board-copy observation', 'https://example.com/board-copy')

  await page.goto(originalUrl)
  await metadata(card(page, id))
  await templates(page, 'open-templates')
  await page.getByTestId('personal-template').filter({ hasText: name }).click()
  await page.getByTestId('template-name').fill('Reused lighting layout')
  await page.getByTestId('create-from-template').click()
  await expect(page.getByTestId('board-name')).toHaveText('Reused lighting layout')
  const reused = page.locator('.card-image')
  await metadata(reused)
  const reusedId = (await reused.getAttribute('data-card-id'))!
  expect(reusedId).not.toBe(id)
  await revise(page, reused, 'Reused-layout observation', 'https://example.com/reused-layout')
  await page.reload()
  await metadata(card(page, reusedId), 'Reused-layout observation', 'https://example.com/reused-layout')

  const objects = (await pullAllObjects(page.request)).objects
  const snapshot = objects.find((o: any) => o.kind === 'board' && o.templateName === name)
  expect(snapshot).toBeTruthy()
  expect(objects.find((o: any) => o.kind === 'card' && o.type === 'image' && o.boardId === snapshot.id)).toMatchObject({ imageCaption: caption, imageSourceUrl: source, content: original.content })
  expect(objects.find((o: any) => o.id === id)).toMatchObject({ imageCaption: caption, imageSourceUrl: source, content: original.content })
  expect(objects.find((o: any) => o.id === reusedId).content).toEqual(original.content)
  expect(await (await page.request.get(`/api/assets/${original.content.assetId}/full`)).body()).toEqual(bytes)
  await page.goto(originalUrl)
  await metadata(card(page, id))
})
