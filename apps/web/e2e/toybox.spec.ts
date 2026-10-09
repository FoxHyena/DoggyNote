import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MOD, addNote, at, cardByText, freshBoard } from './helpers.ts'

// The Toy box is a personal inbox. These tests check privacy at the server:
// what another signed-in person (fido) actually receives, not just what the UI shows.

const uniq = (s: string) => `${s} ${Math.random().toString(36).slice(2, 7)}`

async function fido(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const res = await ctx.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })
  expect(res.ok()).toBe(true)
  return ctx
}

async function rexId(page: Page): Promise<string> {
  return ((await (await page.request.get('/api/me')).json()) as { user: { id: string } }).user.id
}

async function addToToybox(page: Page, text: string) {
  if (!(await page.getByTestId('toybox-panel').isVisible())) await page.getByTestId('toybox-button').click()
  await page.getByTestId('toybox-input').fill(text)
  await page.getByTestId('toybox-input').press('Enter')
  await expect(page.getByTestId('toybox-item').filter({ hasText: text })).toBeVisible()
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
}

async function pngBytes(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(64, 48)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#d9765f'
    ctx.fillRect(0, 0, 64, 48)
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const b of buf) s += String.fromCharCode(b)
    return btoa(s)
  })
  return Buffer.from(b64, 'base64')
}

test('nobody else ever receives your Toy box', async ({ page, browser }) => {
  await page.goto('/')
  const secret = `secret squeaky toy ${Math.random().toString(36).slice(2, 7)}`
  await addToToybox(page, secret)
  const me = await rexId(page)

  const other = await fido(browser)
  const body = await (await other.request.get('/api/sync?since=0')).text()
  expect(body, 'raw sync data must not contain the text').not.toContain(secret)
  const { objects } = JSON.parse(body) as { objects: { id: string; hidden?: boolean; boardId?: string }[] }
  const mine = objects.filter((o) => o.id === `toybox:${me}`)
  expect(mine.length && mine.every((o) => o.hidden && Object.keys(o).length === 2), 'only stubs').toBe(true)
  expect(objects.some((o) => o.boardId === `toybox:${me}`), 'no card bodies').toBe(false)

  // fido can't write into rex's Toy box, edit something in it, or share it.
  const card = (await (await page.request.get('/api/sync?since=0')).json()).objects.find((o: { boardId?: string }) => o.boardId === `toybox:${me}`)
  expect((await other.request.post('/api/sync', { data: { changes: [{ id: card.id, patch: { x: 5 } }] } })).status()).toBe(403)
  expect(
    (await other.request.post('/api/sync', { data: { changes: [{ id: crypto.randomUUID(), patch: { kind: 'card', boardId: `toybox:${me}`, type: 'note', content: { md: 'sneaky' } } }] } })).status(),
  ).toBe(403)
  expect((await other.request.post('/api/shares', { data: { boardId: `toybox:${me}` } })).status()).toBe(400)
})

test('images in a Toy box are private too', async ({ page, browser }) => {
  await page.goto('/')
  const me = await rexId(page)
  const assetId = crypto.randomUUID()
  const png = await pngBytes(page)
  for (const size of ['thumb', 'small', 'medium', 'full']) {
    expect((await page.request.put(`/api/assets/${assetId}/${size}`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  }
  const id = crypto.randomUUID()
  await page.request.post('/api/sync', {
    data: { changes: [{ id, patch: { id, kind: 'card', type: 'image', boardId: `toybox:${me}`, x: 0, y: 0, w: 260, h: 195, z: 1, color: 'none', content: { assetId, width: 64, height: 48 }, createdAt: Date.now() } }] },
  })
  expect((await page.request.get(`/api/assets/${assetId}/thumb`)).status(), 'owner').toBe(200)
  const other = await fido(browser)
  expect((await other.request.get(`/api/assets/${assetId}/thumb`)).status(), 'someone else').toBe(403)
})

test('a card moved into a Toy box vanishes from other devices', async ({ page, browser }) => {
  const goingPrivate = uniq('going private')
  await freshBoard(page)
  const url = page.url()
  await addNote(page, goingPrivate)
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
  const me = await rexId(page)

  const other = await fido(browser)
  const p2 = await other.newPage()
  await p2.goto(url)
  await expect(cardByText(p2, goingPrivate)).toBeVisible()

  const card = (await (await page.request.get('/api/sync?since=0')).json()).objects.find((o: { content?: { md?: string } }) => o.content?.md === goingPrivate)
  expect((await page.request.post('/api/sync', { data: { changes: [{ id: card.id, patch: { boardId: `toybox:${me}` } }] } })).ok()).toBe(true)

  // Keep syncing until a pull that started after the move has landed.
  await expect(async () => {
    await p2.getByTestId('sync-status').click()
    await expect(cardByText(p2, goingPrivate)).toHaveCount(0, { timeout: 1500 })
  }).toPass({ timeout: 15_000 })
  // Gone from the device's storage too, not just hidden.
  await p2.waitForTimeout(400)
  const stored = await p2.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('doggynote')
        r.onsuccess = () => {
          const q = r.result.transaction('objects').objectStore('objects').get(id)
          q.onsuccess = () => res(q.result ?? null)
        }
      }),
    card.id,
  )
  expect(stored).toBeNull()
})

test('drag from the Toy box onto the board or into a column; undo puts it back', async ({ page }) => {
  await freshBoard(page)
  const walk = uniq('walk at six')
  await addToToybox(page, walk)
  const item = page.getByTestId('toybox-item').filter({ hasText: walk })
  const ib = (await item.boundingBox())!
  const drop = await at(page, 0.35, 0.5)
  await page.mouse.move(ib.x + 40, ib.y + ib.height / 2)
  await page.mouse.down()
  await page.mouse.move(drop.x, drop.y, { steps: 12 })
  await page.mouse.up()
  await expect(cardByText(page, walk)).toBeVisible()
  await expect(item).toHaveCount(0)

  await page.keyboard.press(`${MOD}+z`)
  await expect(cardByText(page, walk)).toHaveCount(0)
  await expect(item).toBeVisible()

  // Into a column.
  await page.getByTestId('toybox-button').click() // close so the column isn't covered
  await page.getByTestId('tool-column').click()
  await page.keyboard.type('Plans')
  await page.keyboard.press('Enter')
  await page.getByTestId('toybox-button').click()
  const body = cardByText(page, 'Plans').getByTestId('column-body')
  const bb = (await body.boundingBox())!
  const ib2 = (await item.boundingBox())!
  await page.mouse.move(ib2.x + 40, ib2.y + ib2.height / 2)
  await page.mouse.down()
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(body.getByTestId('card')).toHaveText([walk])
})

test('quick capture saves into the Toy box', async ({ page }) => {
  const bone = uniq('captured bone')
  await page.goto('/#/capture')
  await page.getByTestId('capture-input').fill(bone)
  await page.getByTestId('capture-input').press('Enter')
  await expect(page.getByTestId('capture-status')).toContainText('Saved')
  // A hash change alone wouldn't reload the page out of capture mode.
  await page.goto('/#/b/home')
  await page.reload()
  await page.getByTestId('toybox-button').click()
  await expect(page.getByTestId('toybox-item').filter({ hasText: bone })).toBeVisible({ timeout: 15_000 })
})

test('quick capture notices you signed in after it opened', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  await page.goto('/#/capture')
  await expect(page.getByTestId('capture')).toContainText('Sign in')
  // Signing in elsewhere (the main window) and showing the capture window again.
  expect((await ctx.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('capture-input')).toBeVisible()
  await ctx.close()
})
