import { expect, test } from '@playwright/test'
import { avatarUser, openPhoto, photoFile } from './avatar-checks.ts'
import { center, pinch, touchDrag, Fingers } from './touch.ts'
import { camera } from './helpers.ts'

test('profile photo: touch drag, pinch, cancellation and narrow sheet controls', async ({ page }) => {
  await avatarUser(page)
  const before = await camera(page)
  await openPhoto(page)
  const crop = page.getByTestId('avatar-crop'), c = await center(page.getByTestId('avatar-selection'))
  const image = await crop.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())
  await expect(page.getByTestId('photo-options')).toHaveCount(0)
  const handle = page.getByRole('slider', { name: 'Resize crop from bottom right' }), corner = await center(handle)
  await touchDrag(page, corner, { x: corner.x - 30, y: corner.y - 30 })
  expect(Number(await crop.getAttribute('data-zoom'))).toBeGreaterThan(1.1)
  await page.getByRole('button', { name: 'Reset', exact: true }).tap()
  await pinch(page, c, 1.1, { spread: 12 })
  expect(Number(await crop.getAttribute('data-zoom'))).toBeLessThan(1.25)
  await page.getByRole('button', { name: 'Reset', exact: true }).tap()
  await pinch(page, c, .6, { spread: 20 })
  expect(Number(await crop.getAttribute('data-zoom'))).toBeGreaterThan(1.3)
  await touchDrag(page, c, { x: c.x + 25, y: c.y + 10 })
  expect(Number(await crop.getAttribute('data-x'))).toBeGreaterThan(450)
  const fingers = new Fingers(page)
  await fingers.press(0, c); await fingers.move(0, { x: c.x + 10, y: c.y }); await fingers.cancel()
  await expect(page.getByTestId('avatar-editor')).toBeVisible()
  expect(await camera(page)).toEqual(before)
  expect(await crop.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(image)
  await page.setViewportSize({ width: 320, height: 480 })
  for (const name of ['Cancel', 'Save photo', 'Reset']) {
    const button = page.getByRole('button', { name, exact: true }), box = (await button.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(box.y + box.height).toBeLessThanOrEqual(480)
  }
  await page.getByRole('button', { name: 'Reset', exact: true }).tap()
  const smallCorner = await center(handle)
  await touchDrag(page, smallCorner, { x: smallCorner.x - 150, y: smallCorner.y - 150 })
  await expect(crop).toHaveAttribute('data-zoom', '4')
  const handles = await page.getByRole('slider').all()
  const boxes = await Promise.all(handles.map(async (item) => (await item.boundingBox())!))
  for (const box of boxes) { expect(box.width).toBe(44); expect(box.height).toBe(44) }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i]!, b = boxes[j]!; expect(a.x < b.x + b.width && a.x + a.width > b.x + .5 && a.y < b.y + b.height && a.y + a.height > b.y + .5).toBe(false) }
  await page.getByRole('button', { name: 'Reset', exact: true }).tap()
  await expect(crop).toHaveAttribute('data-zoom', '1.25')
  await page.getByRole('button', { name: 'Save photo', exact: true }).tap()
  await expect(page.getByTestId('avatar-editor')).toHaveCount(0)
  await expect(page.getByTestId('account').locator('img')).toBeVisible()
  await expect(page.getByTestId('photo-options-trigger')).toBeFocused()
  await expect(page.locator('.account-photo-camera')).toHaveCSS('opacity', '0')
  await page.getByTestId('photo-options-trigger').tap()
  const options = (await page.getByTestId('photo-options').boundingBox())!
  expect(options.width).toBeLessThan(250)
  expect(options.x).toBeGreaterThanOrEqual(0)
  expect(options.x + options.width).toBeLessThanOrEqual(320)
  expect(options.y + options.height).toBeLessThanOrEqual(480)
})


test('profile tiny panorama: 44px move grip supports touch positioning over a stationary photo', async ({ page }) => {
  await avatarUser(page)
  await page.setViewportSize({ width: 320, height: 480 })
  await openPhoto(page, await photoFile(page, 2400, 200))
  const crop = page.getByTestId('avatar-crop'), photo = await crop.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())
  const corner = await center(page.getByRole('slider', { name: 'Resize crop from bottom right' }))
  await touchDrag(page, corner, { x: corner.x - 120, y: corner.y - 120 })
  await expect(crop).toHaveAttribute('data-zoom', '4')
  const grip = page.getByRole('button', { name: 'Move crop', exact: true }), at = await center(grip)
  const box = (await grip.boundingBox())!
  expect(box.width).toBe(44); expect(box.height).toBe(44)
  const before = Number(await crop.getAttribute('data-x'))
  await touchDrag(page, at, { x: at.x + 12, y: at.y })
  expect(Number(await crop.getAttribute('data-x'))).toBeGreaterThan(before)
  expect(await crop.locator('canvas').evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(photo)
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap()
  await expect(page.getByTestId('photo-options-trigger')).toBeFocused()
})
