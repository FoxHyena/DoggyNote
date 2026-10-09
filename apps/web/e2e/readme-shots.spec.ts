import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { MOD, cardByText, freshBoard } from './helpers.ts'

// README screenshots of a seeded demo board (made-up content, no real data).
// Skipped unless SHOTS=1:
//   SHOTS=1 pnpm exec playwright test readme-shots --project=chromium

test.skip(!process.env.SHOTS, 'only when regenerating README screenshots')
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const OUT = '../../docs/screenshots'
const id = () => crypto.randomUUID()

/** Draws a simple picture in the page and returns PNG bytes. */
async function picture(page: Page, kind: 'sunset' | 'frisbee'): Promise<Buffer> {
  const bytes = await page.evaluate(async (k) => {
    const c = new OffscreenCanvas(900, 600)
    const g = c.getContext('2d')!
    if (k === 'sunset') {
      const sky = g.createLinearGradient(0, 0, 0, 380)
      sky.addColorStop(0, '#f4a259')
      sky.addColorStop(1, '#f7d08a')
      g.fillStyle = sky
      g.fillRect(0, 0, 900, 380)
      g.fillStyle = '#fff3c4'
      g.beginPath()
      g.arc(450, 360, 110, Math.PI, 0)
      g.fill()
      g.fillStyle = '#3d7ea6'
      g.fillRect(0, 360, 900, 240)
      g.fillStyle = '#5c9cc4'
      for (let i = 0; i < 6; i++) g.fillRect(80 + i * 130, 400 + (i % 3) * 50, 90, 8)
    } else {
      g.fillStyle = '#e9dcc4'
      g.fillRect(0, 0, 900, 600)
      g.fillStyle = '#d8c7a8'
      for (let i = 0; i < 40; i++) g.fillRect((i * 97) % 900, (i * 61) % 600, 6, 6)
      g.fillStyle = '#e4572e'
      g.beginPath()
      g.ellipse(450, 300, 190, 120, -0.25, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#b63e1d'
      g.lineWidth = 14
      g.beginPath()
      g.ellipse(450, 300, 120, 72, -0.25, 0, Math.PI * 2)
      g.stroke()
    }
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
  }, kind)
  return Buffer.from(bytes)
}

async function uploadImage(page: Page, png: Buffer) {
  const assetId = id()
  for (const size of ['thumb', 'small', 'medium', 'full']) {
    expect((await page.request.put(`/api/assets/${assetId}/${size}`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  }
  return assetId
}

test('README screenshots', async ({ page, browser }) => {
  await mkdir(OUT, { recursive: true })
  await page.addInitScript(() => localStorage.setItem('doggynote.theme', sessionStorage.getItem('shot-theme') ?? 'dark'))
  await freshBoard(page, "Biscuit's beach weekend")
  const board = decodeURIComponent(page.url().split('#/b/')[1])
  const me = ((await (await page.request.get('/api/me')).json()) as { user: { id: string } }).user.id

  const sunset = await uploadImage(page, await picture(page, 'sunset'))
  const frisbee = await uploadImage(page, await picture(page, 'frisbee'))
  const pdf = id()
  const pdfBytes = Buffer.from('%PDF-1.4\n% demo\n')
  await page.request.put(`/api/files/${pdf}?name=${encodeURIComponent('Trail map.pdf')}`, { data: pdfBytes, headers: { 'content-type': 'application/pdf' } })

  const now = Date.now()
  const card = (o: Record<string, unknown>) => ({ kind: 'card', boardId: board, z: 1, color: 'none', columnId: null, createdAt: now, h: 80, ...o })
  const ids = { title: id(), column: id(), todo: id(), ask: id(), rules: id(), vet: id(), vetBoard: id() }
  const tb = `toybox:${me}`
  const objs = [
    card({ id: ids.title, type: 'note', x: 0, y: 0, w: 340, color: 'gold', content: { md: "# Biscuit's beach weekend 🏖️\nSaturday and Sunday at **Ocean Beach**. Leave by *9 am* to beat the fog." } }),
    card({ id: id(), type: 'image', x: 380, y: 0, w: 300, h: 200, content: { assetId: sunset, width: 900, height: 600, sizes: ['thumb', 'small', 'medium', 'full'] } }),
    card({ id: ids.column, type: 'column', x: 0, y: 230, w: 300, content: { title: 'Packing list' } }),
    card({
      id: ids.todo,
      type: 'todo',
      x: 0,
      y: 0,
      w: 260,
      columnId: ids.column,
      order: 1,
      content: {
        title: 'Bag',
        items: [
          { id: id(), text: 'Towel (the old one)', done: true },
          { id: id(), text: 'Water bowl', done: true },
          { id: id(), text: 'Long leash', done: false },
          { id: id(), text: 'Sunscreen, for us', done: false },
          { id: id(), text: 'Treats. Many treats.', done: true },
        ],
      },
    }),
    card({ id: ids.ask, type: 'note', x: 0, y: 0, w: 260, columnId: ids.column, order: 2, color: 'collar', content: { md: 'Ask Sam about the **big umbrella**' } }),
    card({ id: ids.rules, type: 'note', x: 380, y: 250, w: 300, color: 'sky', content: { md: '## Beach rules\n- Off-leash only north of Stairwell 21\n- Rinse paws before the car\n- No eating kelp' } }),
    card({ id: id(), type: 'link', x: 720, y: 0, w: 280, h: 230, content: { url: 'http://localhost:5180/og.html', status: 'ok', title: 'Good Boy Supplies & Treats', description: 'Everything a very good dog needs.', siteName: 'Doggo Shop', image: 'http://localhost:5180/dog.svg' } }),
    card({ id: id(), type: 'image', x: 720, y: 270, w: 280, h: 187, content: { assetId: frisbee, width: 900, height: 600, sizes: ['thumb', 'small', 'medium', 'full'] } }),
    card({ id: id(), type: 'file', x: 380, y: 500, w: 300, content: { assetId: pdf, name: 'Trail map.pdf', size: 248_000, mime: 'application/pdf', status: 'ok' } }),
    { id: ids.vetBoard, kind: 'board', parentId: board, title: 'Vet records', icon: 'heart', color: 'ball', createdAt: now },
    card({ id: ids.vet, type: 'board', x: 720, y: 500, w: 120, h: 120, content: { boardId: ids.vetBoard } }),
    { id: id(), kind: 'connection', boardId: board, from: ids.title, to: ids.column, arrow: 'end', createdAt: now },
    { id: id(), kind: 'connection', boardId: board, from: ids.rules, to: ids.ask, arrow: 'end', createdAt: now },
    // The Toy box
    { id: tb, kind: 'board', parentId: null, title: 'Toy box', icon: 'ball', color: 'gold', createdAt: now },
    card({ id: id(), boardId: tb, type: 'note', x: 0, y: 0, w: 260, content: { md: 'Buy the orange ball again' }, createdAt: now - 3000 }),
    card({ id: id(), boardId: tb, type: 'note', x: 0, y: 0, w: 260, content: { md: "Ideas for Biscuit's birthday" }, createdAt: now - 2000 }),
    card({ id: id(), boardId: tb, type: 'link', x: 0, y: 0, w: 260, content: { url: 'http://localhost:5180/og.html', status: 'ok', title: 'Good Boy Supplies & Treats' }, createdAt: now - 1000 }),
  ]
  expect((await page.request.post('/api/sync', { data: { changes: objs.map((o) => ({ id: o.id, patch: o })) } })).ok()).toBe(true)
  const c1 = id()
  await page.request.post('/api/sync', {
    data: { changes: [{ id: c1, patch: { id: c1, kind: 'comment', boardId: board, cardId: ids.rules, text: 'Does Biscuit know about the **kelp** rule?', createdAt: now - 3_600_000 } }] },
  })
  const fido = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  await fido.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })
  const c2 = id()
  await fido.request.post('/api/sync', {
    data: { changes: [{ id: c2, patch: { id: c2, kind: 'comment', boardId: board, cardId: ids.rules, text: 'He has been informed. He disagrees.', createdAt: now - 600_000 } }] },
  })
  await fido.close()

  const settle = async () => {
    await page.keyboard.press(`${MOD}+1`)
    await page.mouse.move(5, 890)
    await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
    await expect(page.locator('[data-testid="card-image"][data-loaded]')).toHaveCount(2)
    await page.waitForTimeout(600)
    await synced()
  }
  /** Measured heights sync silently after layout; wait until nothing is queued. */
  const synced = async () => {
    await page.getByTestId('sync-status').click()
    await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
  }

  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((t) => sessionStorage.setItem('shot-theme', t), theme)
    await page.reload()
    await expect(cardByText(page, 'Beach rules')).toBeVisible({ timeout: 15_000 })
    await settle()
    await page.screenshot({ path: `${OUT}/board-${theme}.png` })
  }

  // Back to dark for the panels.
  await page.evaluate(() => sessionStorage.setItem('shot-theme', 'dark'))
  await page.reload()
  await expect(cardByText(page, 'Beach rules')).toBeVisible({ timeout: 15_000 })
  await settle()
  await cardByText(page, 'Beach rules').getByTestId('comment-badge').click()
  await expect(page.getByTestId('comment')).toHaveCount(2)
  await page.waitForTimeout(400)
  await page.mouse.move(5, 890)
  await synced()
  await page.screenshot({ path: `${OUT}/comments.png` })
  await page.getByTestId('comments-close').click()

  await page.getByTestId('toybox-button').click()
  await expect(page.getByTestId('toybox-item')).toHaveCount(3)
  await page.waitForTimeout(400) // the panel's slide-in
  await page.screenshot({ path: `${OUT}/toybox.png` })
  await page.getByTestId('toybox-button').click()

  await page.getByTestId('export').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/export.png` })
})
