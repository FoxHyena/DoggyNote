import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MOD, clickEmpty, freshBoard, waitForSync } from './helpers.ts'

// Image captions are typed in place: double-click the picture, type under it,
// click away or press Escape. No dialog, no Edit button.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

const contexts = new Set<BrowserContext>()
test.afterEach(async () => {
  await Promise.all([...contexts].map((c) => c.close()))
  contexts.clear()
})

/** A small PNG made in the page, as a file the image input accepts. */
async function pngBytes(page: Page, w = 320, h = 240): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ w, h }) => {
      const c = new OffscreenCanvas(w, h)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#4a90c2'
      ctx.fillRect(0, 0, w, h)
      const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
      let s = ''
      for (const b of buf) s += String.fromCharCode(b)
      return btoa(s)
    },
    { w, h },
  )
  return Buffer.from(b64, 'base64')
}

async function addImage(page: Page) {
  await page.getByTestId('image-input').setInputFiles({ name: 'rex.png', mimeType: 'image/png', buffer: await pngBytes(page) })
  const card = page.locator('[data-testid="card"][data-type="image"]')
  await expect(card).toHaveCount(1)
  await expect.poll(() => card.getByTestId('card-image').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)
  return card
}

async function textStyle(page: Page, testid: string) {
  return page.getByTestId(testid).evaluate((el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { font: `${s.fontFamily} ${s.fontSize} ${s.fontWeight} ${s.lineHeight}`, padding: s.padding, color: s.color, background: s.backgroundColor, top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }
  })
}

test('double-click an image, type a caption, click away: it stays after a reload', async ({ page }) => {
  const card = await addImage(page)
  // Nothing to edit with but the image itself.
  await expect(card.getByRole('button', { name: /edit/i })).toHaveCount(0)
  await expect(card.getByTestId('image-caption')).toHaveCount(0)

  await card.getByTestId('card-image').dblclick()
  const input = page.getByTestId('image-caption-input')
  await expect(input).toBeFocused()
  await expect(page.getByRole('group', { name: 'Image caption' })).toBeVisible()
  await page.keyboard.type('Rex at the beach')
  // Two lines: the editor grows like the caption will.
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Summer, 2025')
  const editing = await textStyle(page, 'image-caption-input')

  await clickEmpty(page)
  await expect(input).toHaveCount(0)
  const caption = card.getByTestId('image-caption')
  await expect(caption).toHaveText('Rex at the beach\nSummer, 2025')
  // Same box, same type: the text doesn't move when editing ends.
  const shown = await textStyle(page, 'image-caption')
  expect(shown.font).toBe(editing.font)
  expect(shown.padding).toBe(editing.padding)
  expect(shown.color).toBe(editing.color)
  expect(shown.background).toBe(editing.background)
  expect(Math.abs(shown.top - editing.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(shown.left - editing.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(shown.width - editing.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(shown.height - editing.height)).toBeLessThanOrEqual(1)
  await expect(card.getByTestId('card-image')).toHaveAttribute('alt', 'Rex at the beach\nSummer, 2025')

  await waitForSync(page)
  await page.reload()
  await expect(page.locator('[data-testid="card"][data-type="image"]').getByTestId('image-caption')).toHaveText('Rex at the beach\nSummer, 2025')
})

test('Escape keeps the caption and ends editing; one undo takes it back', async ({ page }) => {
  const card = await addImage(page)
  await card.getByTestId('card-image').dblclick()
  await page.keyboard.type('Good boy')
  // Typing keys stay in the caption: Backspace edits text, not the board.
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('image-caption-input')).toHaveCount(0)
  await expect(card).toHaveCount(1)
  await expect(card.getByTestId('image-caption')).toHaveText('Good bo')

  // Editing again starts from the saved text; Enter on a selected image also opens it.
  await expect(card).toHaveClass(/selected/)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('image-caption-input')).toHaveValue('Good bo')
  await page.keyboard.type('y')
  await page.keyboard.press('Escape')
  await expect(card.getByTestId('image-caption')).toHaveText('Good boy')

  await page.keyboard.press(`${MOD}+z`)
  await expect(card.getByTestId('image-caption')).toHaveText('Good bo')
  await page.keyboard.press(`${MOD}+z`)
  await expect(card.getByTestId('image-caption')).toHaveCount(0)
  await expect(card).toHaveCount(1)
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

test('a caption reaches someone else on the board', async ({ page, browser }) => {
  const card = await addImage(page)
  await waitForSync(page)
  const other = await friend(browser, page)
  await expect(other.locator('[data-testid="card"][data-type="image"]')).toHaveCount(1)

  await page.bringToFront()
  await card.getByTestId('card-image').dblclick()
  await page.keyboard.type('Fetch practice')
  await clickEmpty(page)
  await waitForSync(page)
  await expect(other.locator('[data-testid="card"][data-type="image"]').getByTestId('image-caption')).toHaveText('Fetch practice')
})
