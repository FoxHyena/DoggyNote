import { expect, test, type Page } from '@playwright/test'
import { expectHandlesHittable, freshBoard, waitForSync } from './helpers.ts'
import { FIXTURES } from './ports.ts'
import { seedCards, selectionBarFits, tapOn } from './touch.ts'

// On a phone the colours and actions share one sheet along the bottom. Every tint
// and the custom slot fit one row with fingertip targets, and every action is
// labelled on screen without a sideways scroll.

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
  await page.getByTestId('swatch-ball').tap()
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
  await page.getByTestId('swatch-none').tap()
  await expect(card).not.toHaveClass(/colored/)
})

for (const width of [0, 360]) {
  test(`the sheet fits${width ? ` a ${width}px phone` : ''}: one row of colours, labelled actions, no scrolling`, async ({ page }) => {
    if (width) await page.setViewportSize({ width, height: 740 })
    const card = await addImage(page)
    await tapOn(page, card.getByTestId('card-image'))
    const bar = page.getByTestId('selection-bar')
    await expect(bar).toBeVisible()
    await selectionBarFits(page)
    const vw = page.viewportSize()!.width

    // Seven tints and the custom slot, all on screen, on one row, each a 44px-tall target.
    const slots = bar.locator('.swatches > .swatch')
    await expect(slots).toHaveCount(8)
    const boxes = await slots.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
    for (const b of boxes) {
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.right).toBeLessThanOrEqual(vw)
      expect(b.height).toBeGreaterThanOrEqual(44)
      expect(b.width).toBeGreaterThanOrEqual(40)
      expect(Math.round(b.top)).toBe(Math.round(boxes[0].top))
    }
    // Neighbouring targets don't overlap.
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.5)
    // No colour reads as "none": an empty, slashed ring.
    expect(await bar.getByTestId('swatch-none').evaluate((el) => [getComputedStyle(el, '::before').backgroundColor, getComputedStyle(el, '::after').content])).toEqual(['rgba(0, 0, 0, 0)', '""'])

    // The lock is one of the actions, and every action shows its label without scrolling.
    const actions = bar.locator('.bar-actions')
    expect(await actions.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    for (const [id, label] of [['edit-card', 'Edit'], ['position-lock', 'Lock'], ['comment-button', 'Comment'], ['selection-more', 'More'], ['bury', 'Bury'], ['selection-done', 'Done']] as const) {
      const button = actions.getByTestId(id)
      await expect(button).toBeInViewport({ ratio: 1 })
      await expect(button).toContainText(label)
      const b = (await button.boundingBox())!
      expect(b.height).toBeGreaterThanOrEqual(44)
      expect(b.width).toBeGreaterThanOrEqual(44)
    }
    await expect(bar.locator('.bar-position')).toHaveCount(0)
    await actions.getByTestId('position-lock').tap()
    await expect(actions.getByTestId('position-lock')).toContainText('Unlock')
    await expect(actions.getByTestId('position-lock')).toHaveAttribute('aria-pressed', 'true')
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
