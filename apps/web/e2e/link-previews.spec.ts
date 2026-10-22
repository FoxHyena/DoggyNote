import { expect, test } from '@playwright/test'
import { FIXTURES } from './ports.ts'
import { freshBoard, pullAllObjects, waitForSync } from './helpers.ts'
import { loaded, seedLinks } from './link-fixture.ts'

// Link previews show their whole picture. A site that won't let a browser
// hot-link its image (Nextcloud's public previews) gets it through our proxy;
// a dead image disappears instead of leaving a broken box.

test('an image the site refuses to hot-link loads through our proxy', async ({ page }) => {
  const guarded = { url: `${FIXTURES}/guarded.html`, title: 'Woofcloud photo', image: `${FIXTURES}/guarded.png` }
  const { card } = await seedLinks(page, [guarded, { ...guarded, column: true }])
  const img = card(0).getByTestId('link-image')
  await expect(img).toHaveAttribute('data-via', 'proxy')
  await expect.poll(() => loaded(img)).toBe(true)
  await expect(img).toHaveAttribute('src', /^blob:/)
  expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([40, 30])
  // Whole picture, full card width: 40×30 at 260 px wide.
  const box = await img.evaluate((el) => [el.offsetWidth, el.offsetHeight])
  expect(Math.abs(box[1] - (box[0] * 30) / 40)).toBeLessThan(2)
  // In a column a wide picture keeps its shape, 88 px wide: 88 × 66, no bars.
  const thumb = card(1).getByTestId('link-image')
  await expect.poll(() => loaded(thumb)).toBe(true)
  await expect.poll(() => thumb.evaluate((el) => [el.offsetWidth, el.offsetHeight])).toEqual([88, 66])
})

test('the Link tool previews a fresh guarded link with its image', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-link').click()
  await page.getByTestId('link-input').fill(`${FIXTURES}/guarded.html`)
  await page.keyboard.press('Enter')
  const card = page.locator('.card-link')
  await expect(card.getByTestId('link-title')).toHaveText('Woofcloud photo')
  const img = card.getByTestId('link-image')
  await expect(img).toHaveAttribute('data-via', 'proxy')
  await expect.poll(() => loaded(img)).toBe(true)
})

test('a site that hides its tags from bots still gives a real preview', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-link').click()
  await page.getByTestId('link-input').fill(`${FIXTURES}/shop.html`)
  await page.keyboard.press('Enter')
  const card = page.locator('.card-link')
  await expect(card.getByTestId('link-title')).toHaveText('Squeaky Bone, 3 Pack')
  await expect.poll(() => loaded(card.getByTestId('link-image'))).toBe(true)
})

test('a site that only shows its tags to link-preview bots (fixvx) still gives a real preview', async ({ page }) => {
  await freshBoard(page)
  await page.getByTestId('tool-link').click()
  await page.getByTestId('link-input').fill(`${FIXTURES}/embed.html`)
  await page.keyboard.press('Enter')
  const card = page.locator('.card-link')
  await expect(card.getByTestId('link-title')).toHaveText('Nik Raccoon (@NikRaccoon)')
  await expect.poll(() => loaded(card.getByTestId('link-image'))).toBe(true)
})

test('tall images are shown whole; in a column the card is a row with a whole thumbnail; the card height syncs', async ({ page }) => {
  const tall = { url: `${FIXTURES}/tall.html`, title: 'Tall dog', image: `${FIXTURES}/tall.png` }
  const { ids, card } = await seedLinks(page, [tall, { ...tall, column: true }])
  const free = card(0).getByTestId('link-image')
  const inColumn = card(1).getByTestId('link-image')
  await expect.poll(() => loaded(free)).toBe(true)
  await expect.poll(() => loaded(inColumn)).toBe(true)
  await expect(free).toHaveAttribute('data-via', 'direct')

  // Free: 20×30 at full width, not cropped to a strip.
  const f = await free.evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight, fit: getComputedStyle(el).objectFit }))
  expect(f.fit).toBe('contain')
  expect(Math.abs(f.h - (f.w * 30) / 20)).toBeLessThan(2)
  expect(f.h).toBeGreaterThan(300)

  // In a column: a compact row, like a movie card. The thumbnail takes the picture's own
  // shape inside 88 × 108, so a 2:3 picture fills a 72 × 108 poster with no bars.
  await expect(card(1).getByTestId('link-card')).toHaveClass(/link-row/)
  const c = await inColumn.evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight, fit: getComputedStyle(el).objectFit }))
  expect(c).toEqual({ w: 72, h: 108, fit: 'contain' })
  const thumb = (await inColumn.boundingBox())!, title = (await card(1).getByTestId('link-title').boundingBox())!
  expect(title.x).toBeGreaterThan(thumb.x + thumb.width)
  expect(title.y).toBeLessThan(thumb.y + thumb.height)
  expect(await card(1).evaluate((el) => el.offsetHeight)).toBeLessThan(140)

  // The measured card height (image included) syncs, so other devices cull it right.
  const cardH = await card(0).evaluate((el) => el.offsetHeight)
  expect(cardH).toBeGreaterThan(f.h)
  await waitForSync(page)
  await expect
    .poll(async () => {
      const { objects } = await pullAllObjects(page.request)
      return Math.abs((objects.find((o: { id: string }) => o.id === ids[0])?.h ?? 0) - cardH) <= 1
    }, { timeout: 10_000 })
    .toBe(true)
})

test('a dead image leaves no broken box behind', async ({ page }) => {
  const dead = { url: `${FIXTURES}/dead.html`, title: 'Gone dog', image: `${FIXTURES}/missing.png` }
  const { card } = await seedLinks(page, [dead, { ...dead, column: true }])
  await expect(card(0).getByTestId('link-title')).toHaveText('Gone dog')
  await expect(card(0).locator('img')).toHaveCount(0)
  // Just the text: the card is short, with no empty picture area.
  const h = await card(0).evaluate((el) => el.offsetHeight)
  expect(h).toBeLessThan(120)
  // In a column the row keeps no thumbnail gap: the text starts at the card's edge.
  await expect(card(1).locator('img')).toHaveCount(0)
  const row = (await card(1).boundingBox())!, title = (await card(1).getByTestId('link-title').boundingBox())!
  expect(title.x - row.x).toBeLessThan(20)
})

test('an empty preview from an earlier fetch is retried once', async ({ page }) => {
  const { card } = await seedLinks(page, [{ url: `${FIXTURES}/og.html` }])
  await expect(card(0).getByTestId('link-title')).toHaveText('Good Boy Supplies & Treats')
  await expect(card(0)).toContainText('Doggo Shop')
})

test('the share viewer hides an image it cannot load, without asking the proxy', async ({ page, browser }) => {
  const { boardId } = await seedLinks(page, [{ url: `${FIXTURES}/guarded.html`, title: 'Woofcloud photo', image: `${FIXTURES}/guarded.png` }])
  await expect(page.getByTestId('link-image')).toHaveAttribute('data-via', 'proxy')
  const res = await page.request.post('/api/shares', { data: { boardId } })
  expect(res.ok(), await res.text()).toBe(true)
  const { share } = (await res.json()) as { share: { token: string } }

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const v = await ctx.newPage()
    const proxied: string[] = []
    v.on('request', (r) => { if (r.url().includes('/api/proxy-image')) proxied.push(r.url()) })
    await v.goto(`/s/${share.token}`)
    await expect(v.getByTestId('link-title')).toHaveText('Woofcloud photo')
    await expect(v.locator('.card-link img')).toHaveCount(0)
    await v.waitForTimeout(300)
    expect(proxied).toEqual([])
  } finally {
    await ctx.close()
  }
})
