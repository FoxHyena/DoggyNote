import { expect, test, type Browser, type Page } from '@playwright/test'
import { addNote, at, cardByText, dragBy, freshBoard } from './helpers.ts'

async function createShare(page: Page, includeChildren = true): Promise<string> {
  await page.getByTestId('share').click()
  const panel = page.getByTestId('share-panel')
  if (!includeChildren) await panel.getByTestId('include-children').uncheck()
  await panel.getByTestId('create-share').click()
  const url = await panel.getByTestId('share-url').first().inputValue()
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/)
  return url
}

/** A stranger: no cookies, no storage. */
async function stranger(browser: Browser, url: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const p = await ctx.newPage()
  await p.goto(url)
  return p
}

test('a share link opens logged-out, read-only, with inner boards reachable', async ({ page, browser }) => {
  const title = await freshBoard(page)
  await addNote(page, 'public bone', 0.4, 0.4)
  await page.getByTestId('tool-board').click()
  await page.keyboard.type('Inner sanctum')
  await page.keyboard.press('Enter')
  await cardByText(page, 'Inner sanctum').locator('.board-tile').click()
  await addNote(page, 'secret-ish treat')
  await page.getByTestId('crumb').last().click()
  const url = await createShare(page, true)

  const v = await stranger(browser, url)
  await expect(v.getByTestId('viewer')).toBeVisible()
  await expect(v.getByTestId('board-name')).toHaveText(title)
  await expect(cardByText(v, 'public bone')).toBeVisible()
  // No editing affordances.
  await expect(v.locator('.toolbar')).toHaveCount(0)
  await expect(v.getByTestId('undo')).toHaveCount(0)
  await expect(v.getByTestId('connect-handle')).toHaveCount(0)
  const p = await at(v, 0.8, 0.8)
  await v.mouse.dblclick(p.x, p.y)
  await expect(v.getByTestId('note-editor')).toHaveCount(0)
  await cardByText(v, 'public bone').click()
  await v.keyboard.press('Backspace')
  await expect(cardByText(v, 'public bone')).toBeVisible()
  // Inner board is part of the link.
  await cardByText(v, 'Inner sanctum').locator('.board-tile').click()
  await expect(v.getByTestId('board-name')).toHaveText('Inner sanctum')
  await expect(cardByText(v, 'secret-ish treat')).toBeVisible()
  // Breadcrumbs stop at the shared root (no peeking at the Doghouse).
  await expect(v.getByTestId('crumb')).toHaveText([title])
  // The viewer can't write through the API either.
  expect((await v.request.post('/api/sync', { data: { changes: [] } })).status()).toBe(401)
  // Panning still works for viewers.
  const before = await v.getByTestId('world').evaluate((e) => (e as HTMLElement).style.transform)
  const q = await at(v, 0.5, 0.5)
  await v.mouse.move(q.x, q.y)
  await v.mouse.down()
  await v.mouse.move(q.x + 80, q.y + 30, { steps: 4 })
  await v.mouse.up()
  expect(await v.getByTestId('world').evaluate((e) => (e as HTMLElement).style.transform)).not.toBe(before)
})

test('a "this board only" link does not open inner boards', async ({ page, browser }) => {
  await freshBoard(page)
  await page.getByTestId('tool-board').click()
  await page.keyboard.type('Private den')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  const url = await createShare(page, false)
  const v = await stranger(browser, url)
  await cardByText(v, 'Private den').locator('.board-tile').click()
  await expect(v.getByText("This board isn't part of the link.")).toBeVisible()
})

test('turning a link off makes it 404 immediately', async ({ page, browser }) => {
  await freshBoard(page)
  await addNote(page, 'temporary')
  const url = await createShare(page)
  const v = await stranger(browser, url)
  await expect(cardByText(v, 'temporary')).toBeVisible()

  await page.getByTestId('share-panel').getByTestId('revoke-share').click()
  await expect(page.getByTestId('share-link')).toHaveCount(0)
  await v.reload()
  await expect(v.getByTestId('share-gone')).toContainText('gone walkies')
  const token = url.split('/s/')[1]
  expect((await v.request.get(`/api/share/${token}`)).status()).toBe(404)
})

test('later edits show up for viewers on reload; trashed cards do not', async ({ page, browser }) => {
  await freshBoard(page)
  const n = await addNote(page, 'will be buried')
  const url = await createShare(page)
  await page.getByTestId('share').click() // close the panel
  await dragBy(page, n, 12, 0)
  await page.keyboard.press('Delete')
  await expect(cardByText(page, 'will be buried')).toHaveCount(0)
  await addNote(page, 'fresh news', 0.7, 0.7)
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
  const v = await stranger(browser, url)
  await expect(cardByText(v, 'fresh news')).toBeVisible()
  await expect(cardByText(v, 'will be buried')).toHaveCount(0)
})

test.describe('image access', () => {
  /** Upload a small image to the current board and return its asset id (via a synced pull). */
  async function addImage(page: Page): Promise<string> {
    const png = await page.evaluate(async () => {
      const c = new OffscreenCanvas(120, 90)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#7fa7d1'
      ctx.fillRect(0, 0, 120, 90)
      const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
      let s = ''
      for (const b of buf) s += String.fromCharCode(b)
      return btoa(s)
    })
    await page.getByTestId('image-input').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await expect(page.getByTestId('card-image')).toHaveCount(1)
    await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
    const board = decodeURIComponent(page.url().split('#/b/')[1])
    const { objects } = (await (await page.request.get('/api/sync?since=0')).json()) as { objects: { boardId?: string; type?: string; content?: { assetId?: string } }[] }
    return objects.find((o) => o.boardId === board && o.type === 'image')!.content!.assetId!
  }

  test('strangers need a share link, and only for images on shared boards', async ({ page, browser }) => {
    await freshBoard(page)
    const shown = await addImage(page)
    const url = await createShare(page)
    const token = url.split('/s/')[1]
    await page.getByTestId('share').click() // close the panel

    // An image on a different, unshared board.
    await freshBoard(page)
    const hidden = await addImage(page)

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const get = (path: string) => anon.request.get(path)
    expect((await get(`/api/assets/${shown}/thumb`)).status(), 'no credential').toBe(401)
    const ok = await get(`/api/assets/${shown}/thumb?share=${token}`)
    expect(ok.status(), 'shared image').toBe(200)
    expect(ok.headers()['cache-control']).toContain('private')
    expect((await get(`/api/assets/${hidden}/thumb?share=${token}`)).status(), 'image outside the share').toBe(403)
    expect((await get(`/api/assets/${shown}/thumb?share=nope`)).status(), 'bogus share').toBe(401)
    expect((await get(`/api/assets/${shown}/thumb?t=forged.123.abc`)).status(), 'forged token').toBe(401)

    // The viewer page actually shows it.
    const v = await stranger(browser, url)
    await expect.poll(() => v.getByTestId('card-image').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)

    // Turning the link off cuts image access too.
    expect((await page.request.delete(`/api/shares/${token}`)).ok()).toBe(true)
    expect((await get(`/api/assets/${shown}/thumb?share=${token}`)).status(), 'revoked share').toBe(401)
  })

  test('signed-in editors load images with their session', async ({ page }) => {
    await freshBoard(page)
    const id = await addImage(page)
    expect((await page.request.get(`/api/assets/${id}/medium`)).status()).toBe(200)
  })
})
