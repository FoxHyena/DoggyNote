import { chooseCardColour, selectionMore } from './touch.ts'
import { expect, test, type Page } from '@playwright/test'
import { expectHandlesHittable, freshBoard, waitForSync } from './helpers.ts'
import { FIXTURES } from './ports.ts'
import { seedCards, selectionBarFits, tapOn } from './touch.ts'

// On a phone five labelled actions fit the dock. Colour opens a focused sheet
// with seven tints and a custom slot, each with a full fingertip target.

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

async function addImage(page: Page) {
  const b64 = await page.evaluate(async () => {
    const c = new OffscreenCanvas(240, 180)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#4a90c2'
    ctx.fillRect(0, 0, 240, 180)
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const b of buf) s += String.fromCharCode(b)
    return btoa(s)
  })
  await page.getByTestId('image-input').setInputFiles({ name: 'rex.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') })
  const card = page.locator('[data-testid="card"][data-type="image"]')
  await expect(card).toHaveCount(1)
  await waitForSync(page)
  return card
}

test('tap a colour in the sheet and the picture is framed in it', async ({ page }) => {
  const card = await addImage(page)
  await tapOn(page, card.getByTestId('card-image'))
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await chooseCardColour(page, 'ball')
  await expect(card).toHaveClass(/colored/)
  const ball = await page.evaluate(() => {
    const p = document.createElement('span')
    p.style.color = 'var(--dn-card-ball-bg)'
    document.body.append(p)
    const c = getComputedStyle(p).color
    p.remove()
    return c
  })
  await expect.poll(() => card.locator('.image-card').evaluate((el) => getComputedStyle(el, '::after').boxShadow)).toContain(ball)
  await chooseCardColour(page, 'none')
  await expect(card).not.toHaveClass(/colored/)
})

for (const width of [0, 360]) {
  test(`the sheet fits${width ? ` a ${width}px phone` : ''}: five actions, palettes on demand, no scrolling`, async ({ page }) => {
    if (width) await page.setViewportSize({ width, height: 740 })
    const card = await addImage(page)
    await tapOn(page, card.getByTestId('card-image'))
    const bar = page.getByTestId('selection-bar')
    await expect(bar).toBeVisible()
    await selectionBarFits(page)
    const vw = page.viewportSize()!.width

    const actions = bar.locator('.selection-phone-actions')
    expect(await actions.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    for (const [id, label] of [['edit-card', 'Edit'], ['selection-colour', 'Colour'], ['labels-button', 'Labels'], ['selection-more', 'More'], ['bury', 'Bury']] as const) {
      const button = actions.getByTestId(id)
      await expect(button).toBeInViewport({ ratio: 1 })
      await expect(button).toContainText(label)
      const b = (await button.boundingBox())!
      expect(b.height).toBeGreaterThanOrEqual(44)
      expect(b.width).toBeGreaterThanOrEqual(44)
    }
    await expect(bar.locator('.tint-dots')).toHaveCount(0)
    await page.getByTestId('selection-colour').tap()
    const sheet = page.getByTestId('selection-style-sheet')
    const slots = sheet.locator('.tint-dots > .color-dot')
    await expect(slots).toHaveCount(8)
    for (const box of await slots.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.right).toBeLessThanOrEqual(vw)
      expect(box.height).toBeGreaterThanOrEqual(32)
      expect(box.width).toBeGreaterThanOrEqual(32)
    }
    // Each 32px dot carries a 44px+ target.
    for (const target of await slots.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width - 2 * parseFloat(getComputedStyle(el, '::after').left)))) expect(target).toBeGreaterThanOrEqual(44)
    // No colour: an empty ring with a slash.
    expect(await sheet.getByTestId('swatch-none').evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el, '::before').content])).toEqual(['rgba(0, 0, 0, 0)', '""'])
    await page.getByTestId('selection-style-done').tap()
    await selectionMore(page)
    await page.getByTestId('position-lock').tap()
    await expect(page.getByTestId('position-lock')).toContainText('Unlock')
    await expect(page.getByTestId('position-lock')).toHaveAttribute('aria-checked', 'true')
  })
}

test('a tapped image or link keeps its fingertip handles unclipped at the card edge', async ({ page }) => {
  await seedCards(page, [{ type: 'link', x: 0, y: 0, w: 260, content: { url: `${FIXTURES}/og.html`, title: 'A good walk', status: 'ok' } }], { x: 40, y: 60 })
  const link = page.locator('[data-testid="card"][data-type="link"]')
  await tapOn(page, link.locator('.link-host'), { x: 4, y: 4 })
  await expect(link).toHaveClass(/selected/)
  await expectHandlesHittable(link)
  await page.getByTestId('selection-done').tap()

  const image = await addImage(page)
  await tapOn(page, image.getByTestId('card-image'))
  await expect(image).toHaveClass(/selected/)
  await expectHandlesHittable(image)
})
