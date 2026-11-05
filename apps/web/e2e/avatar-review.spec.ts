import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { avatarUser, openPhoto, photoFile, resizePhoto } from './avatar-checks.ts'

test.skip(!process.env.AVATAR_REVIEW, 'Capture only during profile-photo design review')

test('profile-photo review evidence', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000)
  await avatarUser(page)
  const file = await photoFile(page)
  const state = await page.context().storageState()
  const output = `../../docs/qa/avatars/${process.env.AVATAR_REVIEW}/${testInfo.project.name}`
  await mkdir(output, { recursive: true })
  for (const [label, width, height] of [['desktop', 1440, 900], ['tablet', 768, 720], ['phone', 393, 659], ['narrow', 320, 568], ['short', 720, 480]] as const) {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ storageState: state, viewport: { width, height }, hasTouch: width < 1000, isMobile: width < 600, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      const view = await context.newPage()
      try {
        await view.addInitScript((theme) => localStorage.setItem('doggynote.theme', theme), theme)
        await view.request.delete(new URL('/api/me/avatar', page.url()).href)
        await view.goto('/')
        await expect(view.getByTestId('canvas')).toBeVisible()
        const shot = (name: string) => view.screenshot({ path: `${output}/${label}-${theme}-${name}.png`, fullPage: false, animations: 'disabled' })
        await view.getByTestId('account').click(); await shot('account')
        await view.getByTestId('photo-options-trigger').click(); await shot('options-empty')
        await view.keyboard.press('Escape'); await view.keyboard.press('Escape')
        await openPhoto(view, file)
        await shot('crop')
        await resizePhoto(view, .625)
        await view.getByTestId('avatar-crop').focus(); await view.keyboard.press('Shift+ArrowRight')
        await shot('framed')
        await view.route('**/api/me/avatar', async (route) => {
          await shot('saving')
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Could not save your photo. Check your connection and try again.' }) })
        }, { times: 1 })
        await view.getByRole('button', { name: 'Save photo', exact: true }).click()
        await expect(view.getByRole('alert')).toContainText('try again')
        const footer = (await view.locator('.avatar-actions').boundingBox())!, alert = (await view.getByRole('alert').boundingBox())!
        expect(footer.y + footer.height).toBeLessThanOrEqual(height)
        expect(alert.y + alert.height).toBeLessThanOrEqual(footer.y)
        await shot('error')
        await view.getByRole('button', { name: 'Save photo', exact: true }).click()
        await expect(view.getByTestId('avatar-editor')).toHaveCount(0)
        await expect(view.getByTestId('account').locator('img')).toBeVisible()
        await expect(view.getByTestId('photo-options-trigger')).toBeVisible()
        await expect.poll(() => view.locator('.account-photo-avatar img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(512)
        await view.getByTestId('theme-toggle').focus()
        await view.mouse.move(0, 0)
        await shot('saved')
        await view.getByTestId('photo-options-trigger').click(); await shot('options-saved')
      } finally { await context.close() }
    }
  }
})


test('profile-photo source shapes and narrow handle geometry', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000)
  await avatarUser(page)
  const state = await page.context().storageState()
  const output = `../../docs/qa/avatars/${process.env.AVATAR_REVIEW}/${testInfo.project.name}`
  await mkdir(output, { recursive: true })
  for (const [label, width, height] of [['desktop', 1440, 900], ['narrow', 320, 480]] as const) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ storageState: state, viewport: { width, height }, hasTouch: width < 600, isMobile: width < 600, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const view = await context.newPage()
    try {
      await view.addInitScript((theme) => localStorage.setItem('doggynote.theme', theme), theme)
      await view.goto('/'); await expect(view.getByTestId('canvas')).toBeVisible()
      for (const [shape, w, h, transparent] of [['portrait', 500, 1000, false], ['panorama', 2400, 200, false], ['transparent', 600, 600, true]] as const) {
        await openPhoto(view, await photoFile(view, w, h, transparent))
        const crop = view.getByTestId('avatar-crop'), canvas = crop.locator('canvas')
        const image = await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())
        await resizePhoto(view, .25)
        const handles = await view.getByRole('slider').all(), boxes = await Promise.all(handles.map(async (handle) => (await handle.boundingBox())!))
        for (const box of boxes) { expect(box.width).toBe(44); expect(box.height).toBe(44); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height) }
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i]!, b = boxes[j]!; expect(a.x < b.x + b.width && a.x + a.width > b.x + .5 && a.y < b.y + b.height && a.y + a.height > b.y + .5).toBe(false) }
        const grip = view.getByRole('button', { name: 'Move crop', exact: true })
        if (await grip.isVisible()) {
          const box = (await grip.boundingBox())!, x = Number(await crop.getAttribute('data-x'))
          expect(box.width).toBe(44); expect(box.height).toBe(44)
          for (const handle of boxes) expect(box.x < handle.x + handle.width && box.x + box.width > handle.x && box.y < handle.y + handle.height && box.y + box.height > handle.y).toBe(false)
          await view.mouse.move(box.x + 22, box.y + 22); await view.mouse.down(); await view.mouse.move(box.x + 32, box.y + 22); await view.mouse.up()
          expect(Number(await crop.getAttribute('data-x'))).toBeGreaterThan(x)
        }
        expect(await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(image)
        await view.screenshot({ path: `${output}/${label}-${theme}-${shape}.png`, fullPage: false, animations: 'disabled' })
        await view.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
    } finally { await context.close() }
  }
})
