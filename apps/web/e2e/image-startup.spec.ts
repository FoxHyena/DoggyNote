import { expect, test } from '@playwright/test'
import { addNote, cardByText, freshBoard, pullAllObjects, waitForSync } from './helpers.ts'

test('startup still waits for the initial authorized board snapshot', async ({ page }) => {
  await freshBoard(page, 'Read before opening')
  await waitForSync(page)
  let resume!: () => void
  const paused = new Promise<void>((resolve) => { resume = resolve })
  let requested = false
  await page.route('**/api/sync?*', async (route) => {
    requested = true
    await paused
    await route.continue().catch(() => {})
  })
  try {
    await page.reload()
    await expect.poll(() => requested).toBe(true)
    await expect(page.getByTestId('canvas')).toHaveCount(0)
    resume()
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('board-name')).toHaveText('Read before opening')
  } finally {
    resume()
  }
})

test('a failed initial read opens the local board with offline status', async ({ page }) => {
  await freshBoard(page, 'Local fallback')
  await waitForSync(page)
  await page.route('**/api/sync?*', (route) => route.abort('connectionrefused'))
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('board-name')).toHaveText('Local fallback')
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'offline')
})

test('reopening 101 pending photos opens the board while uploads wait, then finishes syncing', async ({ page }) => {
  test.setTimeout(90_000)
  await freshBoard(page, 'A big photo drop')
  await waitForSync(page)
  const board = new URL(page.url()).hash.split('/').pop()
  let resume!: () => void
  const paused = new Promise<void>((resolve) => { resume = resolve })
  let uploads = 0
  await page.route('**/api/assets/*/*', async (route) => {
    if (route.request().method() === 'PUT') {
      uploads++
      await paused
    }
    await route.continue().catch(() => {}) // The pre-reload request can be cancelled.
  })
  try {
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 32; canvas.height = 24
      canvas.getContext('2d')!.fillRect(0, 0, 32, 24)
      return canvas.toDataURL('image/png').split(',')[1]!
    })
    await page.getByTestId('image-input').setInputFiles(Array.from({ length: 101 }, (_, i) => ({ name: `photo-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })))
    // Imports save locally one at a time; wait for the complete drop to be durable.
    await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('doggynote')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const keys = db.transaction('meta').objectStore('meta').getAllKeys()
        keys.onsuccess = () => { resolve(keys.result.filter((key) => String(key).startsWith('upload:')).length); db.close() }
        keys.onerror = () => { reject(keys.error); db.close() }
      }
    })), { timeout: 30_000 }).toBe(101)
    await expect.poll(() => uploads).toBeGreaterThan(0)
    const beforeReload = uploads
    await page.reload()
    await expect.poll(() => uploads).toBeGreaterThan(beforeReload)
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('board-name')).toHaveText('A big photo drop')
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-uploads', '101')
    // Culling mounts a margin outside the viewport, where WebKit keeps lazy
    // images unloaded. At least one visible local preview must decode.
    await expect.poll(() => page.getByTestId('card-image').evaluateAll((images: HTMLImageElement[]) => images.filter((img) => img.complete && img.naturalWidth > 0).length)).toBeGreaterThan(0)
    await page.screenshot({ path: test.info().outputPath('pending-photos.png') })
    await addNote(page, 'Still usable during a big upload', 0.2, 0.7)
    await page.reload()
    await expect(cardByText(page, 'Still usable during a big upload')).toBeVisible()
    resume()
    await waitForSync(page)
    const { objects } = await pullAllObjects(page.request)
    expect(objects.filter((object) => object.boardId === board && object.type === 'image')).toHaveLength(101)
    expect(objects.some((object) => object.boardId === board && object.content?.md === 'Still usable during a big upload')).toBe(true)
  } finally {
    resume()
  }
})
