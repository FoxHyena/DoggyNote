import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { cardByText, dragBy, freshBoard } from './helpers.ts'

// PNG export: the picture is the board's bounds (+32 px padding) times the
// scale, and has the cards' colours, the image, the link preview (fetched
// through our proxy) and the connector in the right places.

const PAD = 32
const boardOf = (page: Page) => decodeURIComponent(page.url().split('#/b/')[1])

type World = Record<string, { x: number; y: number; w: number; h: number }>

async function seed(page: Page) {
  await freshBoard(page)
  const board = boardOf(page)
  const png = Buffer.from(
    await page.evaluate(async () => {
      const c = new OffscreenCanvas(64, 48)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#d02020'
      ctx.fillRect(0, 0, 64, 48)
      return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]
    }),
  )
  const assetId = crypto.randomUUID()
  for (const size of ['thumb', 'small', 'medium', 'full']) {
    expect((await page.request.put(`/api/assets/${assetId}/${size}`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  }
  const base = { kind: 'card', boardId: board, z: 1, columnId: null, createdAt: Date.now() }
  const ids = { a: crypto.randomUUID(), b: crypto.randomUUID(), img: crypto.randomUUID(), link: crypto.randomUUID(), conn: crypto.randomUUID() }
  const objs = [
    { ...base, id: ids.a, type: 'note', x: 0, y: 0, w: 260, h: 60, color: 'ball', content: { md: 'Ball note' } },
    { ...base, id: ids.b, type: 'note', x: 500, y: 0, w: 260, h: 60, color: 'sky', content: { md: 'Sky note' } },
    { ...base, id: ids.img, type: 'image', x: 0, y: 300, w: 260, h: 195, color: 'none', content: { assetId, width: 64, height: 48, sizes: ['thumb', 'small', 'medium', 'full'] } },
    {
      ...base,
      id: ids.link,
      type: 'link',
      x: 500,
      y: 300,
      w: 260,
      h: 220,
      color: 'none',
      content: { url: 'http://localhost:5180/og-png.html', status: 'ok', title: 'Green dog', image: 'http://localhost:5180/green.png' },
    },
    { id: ids.conn, kind: 'connection', boardId: board, from: ids.a, to: ids.b, arrow: 'end', createdAt: Date.now() },
  ]
  expect((await page.request.post('/api/sync', { data: { changes: objs.map((o) => ({ id: o.id, patch: o })) } })).ok()).toBe(true)
  await page.reload()
  await expect(cardByText(page, 'Sky note')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('card-image')).toBeVisible()
  return ids
}

/** World rects of the free cards, as laid out (heights are measured). */
const worldRects = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {}
    for (const el of document.querySelectorAll<HTMLElement>('.card.free')) {
      out[el.dataset.cardId!] = { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight }
    }
    return out
  })

async function exportWith(page: Page, opts: { scope?: string; scale?: string; background?: string } = {}) {
  await page.getByTestId('export').click()
  for (const [k, v] of Object.entries(opts)) await page.getByTestId(`export-${k}-${v}`).click()
  const dl = page.waitForEvent('download')
  await page.getByTestId('export-go').click()
  const d = await dl
  expect(d.suggestedFilename()).toMatch(/\.png$/)
  return readFile((await d.path())!)
}

/** Decodes the PNG in the page; returns its size and RGBA at the given points. */
async function inspect(page: Page, png: Buffer, points: [number, number][]) {
  return page.evaluate(
    async ({ b64, points }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      return { width: bmp.width, height: bmp.height, px: points.map(([x, y]) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data]) }
    },
    { b64: png.toString('base64'), points },
  )
}

const cssColor = (page: Page, v: string) =>
  page.evaluate((name) => {
    const el = document.createElement('div')
    el.style.color = `var(${name})`
    document.body.append(el)
    const m = getComputedStyle(el).color.match(/\d+/g)!.map(Number)
    el.remove()
    return m.slice(0, 3)
  }, v)

const near = (a: number[], b: number[], tol = 14) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol)

test('export the whole board at 2×: size, colours, image, link preview and connector', async ({ page }) => {
  const ids = await seed(page)
  const r: World = await worldRects(page)
  const all = Object.values(r)
  const minX = Math.min(...all.map((q) => q.x))
  const minY = Math.min(...all.map((q) => q.y))
  const maxX = Math.max(...all.map((q) => q.x + q.w))
  const maxY = Math.max(...all.map((q) => q.y + q.h))
  const png = await exportWith(page, { scope: 'board', scale: '2', background: 'theme' })

  const S = 2
  const at = (wx: number, wy: number): [number, number] => [(wx - (minX - PAD)) * S, (wy - (minY - PAD)) * S]
  const a = r[ids.a]
  const b = r[ids.b]
  const img = r[ids.img]
  const link = r[ids.link]
  const midY = a.y + a.h / 2
  // A short vertical strip across the connector, halfway between the notes.
  const strip = Array.from({ length: 13 }, (_, i) => at((a.x + a.w + b.x) / 2, midY - 6 + i))
  const out = await inspect(page, png, [
    at(a.x + 8, a.y + 6), // ball note background (corner, away from the text)
    at(b.x + 8, b.y + 6), // sky note
    at(img.x + img.w / 2, img.y + img.h / 2), // the red image
    at(link.x + link.w / 2, link.y + 40), // green preview image, via the proxy
    at(minX - PAD + 2, minY - PAD + 2), // padding: canvas background
    ...strip,
  ])
  expect(out.width).toBe(Math.round((maxX - minX + PAD * 2) * S))
  expect(out.height).toBe(Math.round((maxY - minY + PAD * 2) * S))
  const [ball, sky, red, green, bg, ...line] = out.px
  expect(near(ball, await cssColor(page, '--dn-card-ball-bg')), `ball ${ball}`).toBe(true)
  expect(near(sky, await cssColor(page, '--dn-card-sky-bg')), `sky ${sky}`).toBe(true)
  expect(near(red, [208, 32, 32]), `image ${red}`).toBe(true)
  expect(near(green, [60, 154, 95]), `link preview ${green}`).toBe(true)
  expect(near(bg, await cssColor(page, '--dn-bg')), `background ${bg}`).toBe(true)
  expect(line.some((p) => !near(p, bg, 30)), 'connector drawn').toBe(true)
})

test('export just the selection, at 1×, on a transparent background', async ({ page }) => {
  const ids = await seed(page)
  const r: World = await worldRects(page)
  await dragBy(page, cardByText(page, 'Sky note'), 12, 0) // select
  const moved = (await worldRects(page))[ids.b]
  const png = await exportWith(page, { scale: '1', background: 'transparent' }) // scope defaults to the selection
  const out = await inspect(page, png, [
    [2, 2],
    [PAD + 8, PAD + 6],
  ])
  expect(out.width).toBe(moved.w + PAD * 2)
  expect(out.height).toBe(moved.h + PAD * 2)
  expect(out.px[0][3], 'transparent corner').toBe(0)
  expect(near(out.px[1], await cssColor(page, '--dn-card-sky-bg'))).toBe(true)
  expect(r[ids.a]).toBeTruthy()
  // The selection survives the export.
  await expect(cardByText(page, 'Sky note')).toHaveClass(/selected/)
})

test('export is not offered for nothing', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('export').click()
  await expect(page.getByTestId('export-scope-selection')).toBeDisabled()
  await page.getByTestId('export-go').click()
  await expect(page.getByTestId('export-error')).toContainText('empty')
})
