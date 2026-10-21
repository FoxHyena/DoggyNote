import { expect, test } from '@playwright/test'
import { at, waitForSync } from './helpers.ts'
import { center, touchDrag, pinch, setCamera, tap } from './touch.ts'
import { importFixturePack, openStickerTray, seedStickers, stickerBoard, stickerRingPoint, stickerState } from './sticker-helpers.ts'

test('tablet tray arms one placement and touch handles preserve appearance through pinch and reload', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  await page.getByTestId('sticker-pick').first().tap()
  const target = await at(page, .55, .4)
  await page.touchscreen.tap(target.x, target.y)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  const p = await center(page.getByTestId('placed-sticker'))
  await touchDrag(page, p, { x: p.x + 50, y: p.y + 35 })
  const r = await stickerRingPoint(page, 45)
  await touchDrag(page, r, { x: r.x + 40, y: r.y + 40 })
  const a = await stickerRingPoint(page, -90)
  await touchDrag(page, a, { x: a.x + 70, y: a.y + 30 })
  const before = await stickerState(page)
  await pinch(page, await at(page, .35, .7), .7)
  expect(await stickerState(page)).toEqual(before)
  await waitForSync(page); await page.reload()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  expect(await stickerState(page)).toEqual(before)
})

test('on a tablet, a long-press box selects several stickers; one finger moves them all and their shared ring turns them together', async ({ page, request }) => {
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  const ids = await seedStickers(page, id, [{ x: 200, y: 200 }, { x: 380, y: 240 }])
  await setCamera(page, { x: -24, y: -24, zoom: 1 })
  const all = () => Promise.all(ids.map((s) => stickerState(page, s)))
  const box = (await page.getByTestId('canvas').boundingBox())!, world = (x: number, y: number) => ({ x: box.x + 24 + x, y: box.y + 24 + y })
  // Hold on empty board, then sweep a box over both.
  await touchDrag(page, world(150, 150), world(560, 420), { hold: 550 })
  const ring = page.getByTestId('sticker-ring')
  await expect(ring).toHaveCount(1); await expect(ring).toHaveAttribute('data-ring', 'group')
  const before = await all()
  const grab = await center(page.locator(`[data-sticker-id="${ids[0]}"]`))
  await touchDrag(page, grab, { x: grab.x + 60, y: grab.y + 30 })
  const moved = await all()
  moved.forEach((s, i) => { expect(s.x).toBeCloseTo(before[i].x + 60, 0); expect(s.y).toBeCloseTo(before[i].y + 30, 0) })
  // The shared ring turns both about its center.
  const r = await stickerRingPoint(page, 0)
  await touchDrag(page, r, { x: r.x - 20, y: r.y + 60 })
  const turned = await all()
  expect(turned[0].angle).toBeGreaterThan(10); expect(turned[1].angle).toBeCloseTo(turned[0].angle, 1)
  // A tap on empty board puts an open tray away.
  await openStickerTray(page)
  await tap(page, world(640, 640)); await expect(page.getByTestId('sticker-tray')).toHaveCount(0)
  await waitForSync(page)
})
