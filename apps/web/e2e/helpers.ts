import { expect, type Locator, type Page } from '@playwright/test'

export const MOD = 'ControlOrMeta'

/** Camera from the world transform: translate3d(tx, ty, 0) scale(z). */
export async function camera(page: Page) {
  const t = await page.getByTestId('world').evaluate((el) => (el as HTMLElement).style.transform)
  const m = t.match(/translate3d\((-?[\d.e-]+)px, (-?[\d.e-]+)px, 0px\) scale\(([\d.e-]+)\)/)
  if (!m) throw new Error(`unexpected transform ${t}`)
  return { tx: Number(m[1]), ty: Number(m[2]), zoom: Number(m[3]) }
}

export async function canvasBox(page: Page) {
  const box = await page.getByTestId('canvas').boundingBox()
  if (!box) throw new Error('no canvas')
  return box
}

/** Screen point at fractions of the canvas. */
export async function at(page: Page, fx: number, fy: number) {
  const b = await canvasBox(page)
  return { x: b.x + b.width * fx, y: b.y + b.height * fy }
}

export const cards = (page: Page) => page.getByTestId('card')
export const cardByText = (page: Page, text: string) => page.locator('[data-testid="card"]', { hasText: text }).last()

/** Double-click empty canvas, type, and leave edit mode. */
export async function addNote(page: Page, text: string, fx = 0.5, fy = 0.5) {
  const p = await at(page, fx, fy)
  await page.mouse.dblclick(p.x, p.y)
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
  const card = cardByText(page, text)
  await expect(card).toBeVisible()
  return card
}

export async function dragBy(page: Page, target: Locator, dx: number, dy: number, opts: { steps?: number } = {}) {
  const b = await target.boundingBox()
  if (!b) throw new Error('no box')
  const x = b.x + Math.min(30, b.width / 2)
  const y = b.y + Math.min(14, b.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: opts.steps ?? 8 })
  await page.mouse.up()
}

export async function clickEmpty(page: Page, fx = 0.95, fy = 0.95) {
  const p = await at(page, fx, fy)
  await page.mouse.click(p.x, p.y)
}

/** Fresh board so tests don't see each other's cards (they share a server once sync lands). */
export async function freshBoard(page: Page, name = `Test ${Math.random().toString(36).slice(2, 7)}`) {
  // Start from the Doghouse explicitly: '/' reopens the last board you were on.
  await page.goto('/#/b/home')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.getByTestId('tool-board').click()
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await cardByText(page, name).locator('.board-tile').click()
  await expect(page.getByTestId('board-name')).toHaveText(name)
  return name
}
