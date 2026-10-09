import { readFile, truncate, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { at, cardByText, freshBoard } from './helpers.ts'

// File uploads: any file becomes a card that downloads the same bytes, behind
// the same access rules as images. PDFs get a first-page preview.

const boardOf = (page: Page) => decodeURIComponent(page.url().split('#/b/')[1])
const uniq = (s: string) => `${s}-${Math.random().toString(36).slice(2, 7)}`

/** A real one-page PDF: an orange box and a line of text. */
function makePdf(): Buffer {
  const stream = '1 0.55 0.2 rg 72 600 300 150 re f BT /F1 28 Tf 0 0 0 rg 72 560 Td (Walkies at six) Tj ET'
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const randomBytes = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7919 + 13) % 256))

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByTestId('upload-input').setInputFiles({ name, mimeType, buffer })
  const card = cardByText(page, name)
  await expect(card.getByTestId('file-download')).toBeVisible({ timeout: 15_000 })
  return card
}

async function serverCard(page: Page, name: string) {
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
  const { objects } = await (await page.request.get('/api/sync?since=0')).json()
  return objects.find((o: { content?: { name?: string } }) => o.content?.name === name) as { content: { assetId: string; thumb?: unknown } }
}

test('upload a PDF: preview of page one, and the download is the same file', async ({ page }) => {
  await freshBoard(page)
  const name = `${uniq('menu')}.pdf`
  const pdf = makePdf()
  const card = await upload(page, name, 'application/pdf', pdf)
  await expect(card.getByTestId('file-meta')).toHaveText(/^PDF · \d+ B$/)

  // The preview is a real render: wide, and mostly not blank.
  const preview = card.getByTestId('file-preview')
  await expect(preview).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(520)
  const orange = await preview.evaluate((img: HTMLImageElement) => {
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    // Inside the orange box: x 72..372 of 612, y 42..192 of 792 from the top.
    const [r, g, b] = ctx.getImageData(Math.round(c.width * 0.3), Math.round(c.height * 0.15), 1, 1).data
    return r > 200 && g > 100 && g < 180 && b < 90
  })
  expect(orange).toBe(true)

  const download = page.waitForEvent('download')
  await card.getByTestId('file-download').click()
  const d = await download
  expect(d.suggestedFilename()).toBe(name)
  expect(Buffer.compare(await readFile((await d.path())!), pdf)).toBe(0)
})

test('any file: a zip downloads byte for byte, always as an attachment', async ({ page, browser }) => {
  await freshBoard(page)
  const name = `${uniq('photos')}.zip`
  const bytes = randomBytes(40_000)
  const card = await upload(page, name, 'application/zip', bytes)
  await expect(card.getByTestId('file-meta')).toHaveText('ZIP · 39 KB')
  await expect(card.getByTestId('file-preview')).toHaveCount(0)

  const { content } = await serverCard(page, name)
  const res = await page.request.get(`/api/files/${content.assetId}`)
  expect(res.status()).toBe(200)
  expect(Buffer.compare(await res.body(), bytes)).toBe(0)
  expect(res.headers()['content-disposition']).toMatch(/^attachment;/)
  expect(res.headers()['content-security-policy']).toContain('sandbox')
  expect(res.headers()['x-content-type-options']).toBe('nosniff')

  // Signed out: no.
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  expect((await anon.request.get(`/api/files/${content.assetId}`)).status()).toBe(401)
  await anon.close()
})

test('an uploaded HTML file never runs as a page', async ({ page }) => {
  await freshBoard(page)
  const name = `${uniq('evil')}.html`
  await upload(page, name, 'text/html', Buffer.from('<script>window.parent.__pwned = 1</script><h1>hi</h1>'))
  const { content } = await serverCard(page, name)
  const res = await page.request.get(`/api/files/${content.assetId}`)
  expect(res.headers()['content-disposition']).toMatch(/^attachment;/)
  expect(res.headers()['content-security-policy']).toMatch(/sandbox/)
})

test('drop any file onto the canvas', async ({ page }) => {
  await freshBoard(page)
  const name = `${uniq('notes')}.txt`
  const p = await at(page, 0.5, 0.5)
  const dt = await page.evaluateHandle((n) => {
    const d = new DataTransfer()
    d.items.add(new File(['good dog'], n, { type: 'text/plain' }))
    return d
  }, name)
  await page.getByTestId('canvas').dispatchEvent('drop', { dataTransfer: dt, clientX: p.x, clientY: p.y })
  await expect(cardByText(page, name).getByTestId('file-meta')).toHaveText('TEXT · 8 B', { timeout: 15_000 })
})

test('files over 50 MB are refused, with the reason', async ({ page }, info) => {
  await freshBoard(page)
  const name = `${uniq('huge')}.mov`
  const big = info.outputPath(name)
  await writeFile(big, '')
  await truncate(big, 51 * 1024 * 1024) // sparse: no real 51 MB write
  await page.getByTestId('upload-input').setInputFiles(big)
  await expect(page.getByTestId('toast')).toContainText('Files can be up to 50 MB')
  await expect(cardByText(page, name)).toHaveCount(0)
  // The server enforces it too.
  const res = await page.request.put(`/api/files/${crypto.randomUUID()}?name=x`, { data: Buffer.alloc(50 * 1024 * 1024 + 1), headers: { 'content-type': 'application/octet-stream' } })
  expect(res.status()).toBe(413)
})

test('share links download files on shared boards only', async ({ page, browser }) => {
  await freshBoard(page)
  const shared = boardOf(page)
  const name = `${uniq('flyer')}.pdf`
  await upload(page, name, 'application/pdf', makePdf())
  const { content } = await serverCard(page, name)
  const { share } = await (await page.request.post('/api/shares', { data: { boardId: shared } })).json()

  // Another file on a board the link doesn't cover.
  await freshBoard(page)
  const other = `${uniq('private')}.zip`
  await upload(page, other, 'application/zip', randomBytes(100))
  const hidden = (await serverCard(page, other)).content

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const v = await ctx.newPage()
  await v.goto(`/s/${share.token}`)
  const link = cardByText(v, name).getByTestId('file-download')
  await expect(link).toHaveAttribute('href', new RegExp(`/api/files/${content.assetId}\\?share=`))
  expect((await ctx.request.get((await link.getAttribute('href'))!)).status()).toBe(200)
  expect((await ctx.request.get(`/api/files/${hidden.assetId}?share=${share.token}`)).status()).toBe(403)
  await ctx.close()
})
