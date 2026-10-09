import { expect, test, type Locator, type Page } from '@playwright/test'
import { MOD, addNote, at, camera, canvasBox, clickEmpty, freshBoard } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await freshBoard(page)
})

/** A card's world rect, from its screen box and the camera. */
async function world(page: Page, card: Locator) {
  const b = (await card.boundingBox())!
  const c = await canvasBox(page)
  const cam = await camera(page)
  const r = (n: number) => Math.round(n * 10) / 10
  return { x: r((b.x - c.x - cam.tx) / cam.zoom), y: r((b.y - c.y - cam.ty) / cam.zoom), w: r(b.width / cam.zoom) }
}

const onGrid = (n: number) => Math.abs(n - Math.round(n / 20) * 20) < 0.6

async function snapOn(page: Page) {
  await page.getByTestId('snap-toggle').click()
  await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'true')
}

async function drag(page: Page, card: Locator, dx: number, dy: number, opts: { alt?: boolean; during?: () => Promise<void> } = {}) {
  const b = (await card.boundingBox())!
  await page.mouse.move(b.x + 30, b.y + 12)
  if (opts.alt) await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(b.x + 30 + dx, b.y + 12 + dy, { steps: 8 })
  await opts.during?.()
  await page.mouse.up()
  if (opts.alt) await page.keyboard.up('Alt')
  await page.waitForTimeout(120) // let the 70 ms snap glide finish
}

test('dots follow the zoom; the snap toggle is remembered', async ({ page }) => {
  const step = () => page.getByTestId('canvas').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--dot-step'))
  await page.keyboard.press(`${MOD}+0`)
  await expect.poll(step).toBe('20px')
  await page.keyboard.press(`${MOD}+=`)
  await expect.poll(step).toBe('25px')

  await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press(`${MOD}+'`)
  await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByTestId('snap-toggle')).toHaveAttribute('aria-pressed', 'true')
})

test('with snapping on, drags land on grid points and the glow shows', async ({ page }) => {
  const note = await addNote(page, 'snappy pup', 0.4, 0.4)
  await snapOn(page)
  await clickEmpty(page)
  await drag(page, note, 37, 23, { during: async () => void (await expect(page.getByTestId('grid-glow')).toBeVisible()) })
  const r = await world(page, note)
  expect(onGrid(r.x), `x ${r.x}`).toBe(true)
  expect(onGrid(r.y), `y ${r.y}`).toBe(true)
  await expect(page.getByTestId('grid-glow')).toHaveCount(0)
})

test('a multi-card drag keeps the group shape', async ({ page }) => {
  const a = await addNote(page, 'pack leader', 0.3, 0.3)
  const b = await addNote(page, 'pack follower', 0.6, 0.6)
  const a0 = await world(page, a)
  const b0 = await world(page, b)
  await snapOn(page)
  await page.keyboard.press(`${MOD}+a`)
  await drag(page, a, 53, 31)
  const a1 = await world(page, a)
  const b1 = await world(page, b)
  expect(onGrid(a1.x) && onGrid(a1.y)).toBe(true)
  expect(b1.x - a1.x).toBeCloseTo(b0.x - a0.x, 0)
  expect(b1.y - a1.y).toBeCloseTo(b0.y - a0.y, 0)
})

test('⌥ bypasses snapping', async ({ page }) => {
  await snapOn(page)
  const note = await addNote(page, 'free spirit', 0.4, 0.4)
  const r0 = await world(page, note)
  expect(onGrid(r0.x) && onGrid(r0.y), 'new cards land on the grid').toBe(true)
  await clickEmpty(page)
  await drag(page, note, 7, 0, { alt: true })
  const r1 = await world(page, note)
  expect(r1.x - r0.x).toBeCloseTo(7, 0)
})

test('resizing snaps the right edge to a grid line', async ({ page }) => {
  await snapOn(page)
  const note = await addNote(page, 'stretchy', 0.4, 0.4)
  await clickEmpty(page)
  await drag(page, note, 1, 0, { alt: true }) // select it without moving off-grid… then put it back
  await drag(page, note, -1, 0, { alt: true })
  const h = (await page.getByTestId('resize-handle').boundingBox())!
  await page.mouse.move(h.x + 5, h.y + 5)
  await page.mouse.down()
  await page.mouse.move(h.x + 5 + 47, h.y + 5, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(120)
  const r = await world(page, note)
  expect(onGrid(r.x + r.w), `right edge ${r.x + r.w}`).toBe(true)
})

test('zoomed in, snapping still uses world grid points', async ({ page }) => {
  const note = await addNote(page, 'zoomed pup', 0.45, 0.45)
  await snapOn(page)
  await page.keyboard.press(`${MOD}+=`)
  await page.keyboard.press(`${MOD}+=`)
  await clickEmpty(page)
  const p = await at(page, 0.5, 0.5)
  void p
  await drag(page, note, 41, 17)
  const r = await world(page, note)
  expect(onGrid(r.x) && onGrid(r.y), `${r.x},${r.y}`).toBe(true)
})
