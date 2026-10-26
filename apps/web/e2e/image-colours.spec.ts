import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { MOD, at, camera, expectHandlesHittable, freshBoard, waitForSync } from './helpers.ts'
import { FIXTURES } from './ports.ts'
import { seedCards } from './touch.ts'

// A colour on a picture frames it (a thin inset border, so the card keeps its size)
// and tints its caption. No colour is the default. Any colour can come from the
// system picker, and it syncs like the named ones.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const contexts = new Set<BrowserContext>()
test.afterEach(async () => {
  await Promise.all([...contexts].map((c) => c.close()))
  contexts.clear()
})

async function addCaptionedImage(page: Page, caption = 'Rex at the beach') {
  const b64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(320, 240)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#4a90c2'
    ctx.fillRect(0, 0, 320, 240)
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const b of buf) s += String.fromCharCode(b)
    return btoa(s)
  })
  await page.getByTestId('image-input').setInputFiles({ name: 'rex.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') })
  const card = page.locator('[data-testid="card"][data-type="image"]')
  await expect(card).toHaveCount(1)
  if (caption) {
    await card.getByTestId('card-image').dblclick()
    await page.keyboard.type(caption)
    await page.keyboard.press('Escape')
    await expect(card.getByTestId('image-caption')).toHaveText(caption)
  }
  await card.getByTestId('card-image').click()
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  return card
}

/** A CSS colour as the browser computes it (`rgb(…)`). */
const resolve = (page: Page, css: string) =>
  page.evaluate((css) => {
    const probe = document.createElement('span')
    probe.style.color = css
    document.body.append(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  }, css)

const frame = (card: Locator) => card.locator('.image-card').evaluate((el) => {
  const s = getComputedStyle(el, '::after')
  return { content: s.content, shadow: s.boxShadow }
})
const caption = (card: Locator) => card.getByTestId('image-caption').evaluate((el) => {
  const s = getComputedStyle(el)
  return { bg: s.backgroundColor, fg: s.color }
})

test('a tint frames the picture and colours its caption; No colour takes it off', async ({ page }) => {
  const card = await addCaptionedImage(page)
  const height = (await card.boundingBox())!.height
  // The default is no colour: no frame, the plain card caption.
  expect((await frame(card)).content).toBe('none')
  expect((await caption(card)).bg).toBe(await resolve(page, 'var(--dn-card)'))

  await page.getByTestId('swatch-sky').click()
  await expect(page.getByTestId('swatch-sky')).toHaveAttribute('aria-pressed', 'true')
  const sky = await resolve(page, 'var(--dn-card-sky-bg)')
  await expect.poll(() => frame(card)).toEqual({ content: '""', shadow: expect.stringContaining(sky) })
  expect((await frame(card)).shadow).toContain('inset')
  expect(await caption(card)).toEqual({ bg: sky, fg: await resolve(page, 'var(--dn-card-sky-text)') })
  // A frame, not a border: the card is exactly as tall as before.
  expect((await card.boundingBox())!.height).toBe(height)

  await page.getByTestId('swatch-none').click()
  await expect.poll(async () => (await frame(card)).content).toBe('none')
  expect(await caption(card)).toEqual({ bg: await resolve(page, 'var(--dn-card)'), fg: await resolve(page, 'var(--dn-text)') })
})

async function friend(browser: Browser, owner: Page) {
  const id = owner.url().split('/b/')[1]!
  const grant = await owner.request.post(`/api/boards/${id}/members`, { data: { username: 'fido', permission: 'edit', includeChildren: true } })
  expect(grant.ok(), await grant.text()).toBe(true)
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '4' } })
  contexts.add(context)
  expect((await context.request.post('/api/auth/login', { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
  const page = await context.newPage()
  await page.goto(owner.url())
  await expect(page.getByTestId('canvas')).toBeVisible()
  return page
}

test('a custom colour is one undo step, survives a reload and reaches someone else', async ({ page, browser }) => {
  test.setTimeout(60_000)
  const card = await addCaptionedImage(page)
  const custom = page.getByTestId('swatch-custom-input')
  await custom.fill('#123abc')
  await expect(card).toHaveClass(/colored/)
  const navy = 'rgb(18, 58, 188)'
  await expect.poll(() => caption(card)).toEqual({ bg: navy, fg: await resolve(page, 'var(--dn-custom-ink-light)') })
  expect((await frame(card)).shadow).toContain(navy)
  // The custom slot shows the colour it holds and reads as picked.
  await expect(page.getByTestId('swatch-custom')).toHaveClass(/\bon\b/)
  await expect(custom).toHaveValue('#123abc')

  await custom.blur()
  await page.keyboard.press(`${MOD}+z`)
  await expect(card).not.toHaveClass(/colored/)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect(card).toHaveClass(/colored/)

  // A pale pick gets dark ink.
  await custom.fill('#f0e68c')
  await expect.poll(async () => (await caption(card)).fg).toBe(await resolve(page, 'var(--dn-custom-ink-dark)'))
  await custom.fill('#123abc')
  await expect.poll(async () => (await caption(card)).bg).toBe(navy)

  await waitForSync(page)
  await page.reload()
  const again = page.locator('[data-testid="card"][data-type="image"]')
  await expect.poll(() => caption(again)).toEqual({ bg: navy, fg: await resolve(page, 'var(--dn-custom-ink-light)') })

  const other = await friend(browser, page)
  const theirs = other.locator('[data-testid="card"][data-type="image"]')
  await expect(theirs.getByTestId('image-caption')).toHaveText('Rex at the beach')
  await expect.poll(async () => (await caption(theirs)).bg).toBe(navy)
})

test('zoomed out, the overview draws the frame in the tint', async ({ page }) => {
  // No caption, so every tinted pixel is the frame.
  const card = await addCaptionedImage(page, '')
  await page.getByTestId('swatch-custom-input').fill('#ff00ff')
  await expect(card).toHaveClass(/colored/)
  await waitForSync(page)
  const p = await at(page, 0.5, 0.5)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 80)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(0.35)
  const magenta = () => page.getByTestId('lod-layer').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let hits = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] < 30 && d[i + 2] > 235) hits++
    return hits
  })
  await expect.poll(magenta).toBeGreaterThan(20)
})

test('image and link cards leave their handles unclipped, outside the card edge', async ({ page }) => {
  const image = await addCaptionedImage(page)
  await page.getByTestId('swatch-sky').click()
  await expectHandlesHittable(image)
  // The picture still rounds to the card's corners; the card itself doesn't clip.
  expect(await image.locator('.image-card').evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden')
  expect(await image.evaluate((el) => getComputedStyle(el).overflow)).toBe('visible')

  await seedCards(page, [{ type: 'link', x: 0, y: 0, content: { url: `${FIXTURES}/og.html`, title: 'A good walk', status: 'ok' } }])
  const link = page.locator('[data-testid="card"][data-type="link"]')
  await link.locator('.link-host').click()
  await expect(link).toHaveClass(/selected/)
  await expectHandlesHittable(link)
})
