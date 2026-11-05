import { expect, test } from '@playwright/test'
import { avatarUser, openPhoto, photoFile, resizePhoto } from './avatar-checks.ts'

test('profile photo: crop, retry, persist, replace and remove', async ({ page }) => {
  const person = await avatarUser(page)
  const file = await photoFile(page)
  await openPhoto(page, file)
  const crop = page.getByTestId('avatar-crop')
  await resizePhoto(page)
  const handle = page.getByRole('slider', { name: 'Resize crop from bottom right' })
  await handle.focus(); await page.keyboard.press('ArrowLeft')
  expect(Number(await crop.getAttribute('data-zoom'))).toBeGreaterThan(2)
  const before = Number(await crop.getAttribute('data-x'))
  await crop.focus(); await page.keyboard.press('ArrowLeft')
  expect(Number(await crop.getAttribute('data-x'))).toBeLessThan(before)
  const moved = Number(await crop.getAttribute('data-x'))
  await page.setViewportSize({ width: 800, height: 650 })
  await expect(crop).toHaveAttribute('data-x', String(moved))
  const expectedPixels = await page.evaluate(async ({ data, x, y, zoom }) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob())
    const output = new OffscreenCanvas(512, 512), ctx = output.getContext('2d')!, side = 600 / zoom
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, x - side / 2, y - side / 2, side, side, 0, 0, 512, 512); image.close()
    // Compare decoded PNGs on both sides: Linux WebKit can round interpolated
    // channel values during a PNG round trip, even for an unchanged canvas.
    const encoded = await createImageBitmap(await output.convertToBlob({ type: 'image/png' }))
    const decoded = new OffscreenCanvas(512, 512), decodedCtx = decoded.getContext('2d')!
    decodedCtx.drawImage(encoded, 0, 0); encoded.close()
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', decodedCtx.getImageData(0, 0, 512, 512).data))]
  }, { data: file.buffer.toString('base64'), x: moved, y: Number(await crop.getAttribute('data-y')), zoom: Number(await crop.getAttribute('data-zoom')) })
  // A failed request keeps the crop and has an immediate retry path.
  await page.route('**/api/me/avatar', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Could not save your photo. Try again.' }) }), { times: 1 })
  await page.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Try again')
  await expect(crop).toHaveAttribute('data-x', String(moved))
  await page.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(page.getByTestId('avatar-editor')).toHaveCount(0)
  const avatar = page.getByTestId('account').locator('img')
  await expect(avatar).toBeVisible()
  const first = await avatar.getAttribute('src')
  const response = await page.request.get(first!)
  expect(response.ok()).toBe(true)
  const pixels = await page.evaluate(async (url) => {
    const image = await createImageBitmap(await (await fetch(url)).blob())
    const canvas = new OffscreenCanvas(512, 512), ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const value = { width: image.width, height: image.height, pixel: [...ctx.getImageData(0, 0, 1, 1).data], hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, 512, 512).data))] }
    image.close(); return value
  }, first!)
  expect(pixels).toEqual({ width: 512, height: 512, pixel: [185, 220, 201, 255], hash: expectedPixels })
  await page.reload(); await expect(avatar).toBeVisible()
  await expect(avatar).toHaveAttribute('src', first!)
  // Cancelling replacement leaves the acknowledged photo unchanged.
  await openPhoto(page)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(avatar).toHaveAttribute('src', first!)
  await openPhoto(page, await photoFile(page, 500, 800))
  await page.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(avatar).toBeVisible()
  await expect(avatar).not.toHaveAttribute('src', first!)
  const second = await avatar.getAttribute('src')
  // A fresh anonymous context cannot fetch a profile picture.
  const anon = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } })
  try { expect((await anon.request.get(new URL(second!, page.url()).href)).status()).toBe(401) } finally { await anon.close() }
  await page.getByTestId('photo-options-trigger').click()
  await page.getByRole('menuitem', { name: 'Remove photo', exact: true }).click()
  await expect(page.getByTestId('photo-options-trigger')).toBeVisible()
  await expect(avatar).toHaveCount(0)
  const me = await (await page.request.get('/api/me')).json() as { user: { id: string; avatarId: string | null } }
  expect(me.user).toMatchObject({ id: person.id, avatarId: null })
})

test('profile editor: mouse drag, reset, invalid file, keyboard containment and fallback', async ({ page }) => {
  await avatarUser(page)
  await openPhoto(page)
  const crop = page.getByTestId('avatar-crop')
  await resizePhoto(page)
  const photo = await crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  const beforeDrag = Number(await crop.getAttribute('data-x'))
  const box = (await page.getByTestId('avatar-selection').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20, { steps: 6 }); await page.mouse.up()
  expect(Number(await crop.getAttribute('data-x'))).toBeGreaterThan(beforeDrag)
  expect(await crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(photo)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(crop).toHaveAttribute('data-x', '450')
  await expect(crop).toHaveAttribute('data-zoom', '1.25')
  await page.getByRole('button', { name: 'Save photo', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Close photo editor' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('photo-options-trigger')).toBeFocused()
  await page.getByTestId('avatar-input').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('broken') })
  await expect(page.getByRole('alert')).toContainText('could not be read')
  await expect(page.getByRole('button', { name: 'Save photo', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await openPhoto(page)
  await page.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(page.getByTestId('account').locator('img')).toBeVisible()
  await page.route('**/api/avatars/**', (route) => route.fulfill({ status: 404 }))
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('account').locator('img')).toHaveCount(0)
  await expect(page.getByTestId('account').locator('.person-avatar')).not.toBeEmpty()
})

test('other members see profile changes in live presence and sharing attribution', async ({ page, browser }) => {
  const person = await avatarUser(page)
  const board = decodeURIComponent(page.url().match(/#\/b\/([^/?#]+)/)![1]!)
  const context = await browser.newContext()
  const viewer = await context.newPage()
  try {
    const observer = await avatarUser(viewer)
    const grant = await page.request.post(`/api/boards/${encodeURIComponent(board)}/members`, { data: { username: observer.username, permission: 'view', includeChildren: true } })
    expect(grant.ok(), await grant.text()).toBe(true)
    await viewer.goto(page.url())
    await expect(viewer.getByTestId('canvas')).toBeVisible()
    await viewer.getByTestId('collaborators').click()
    await expect(viewer.getByTestId('participant').filter({ hasText: person.username })).toBeVisible()
    await openPhoto(page)
    await page.getByRole('button', { name: 'Save photo', exact: true }).click()
    const member = viewer.getByTestId('participant').filter({ hasText: person.username })
    await expect(member.locator('img')).toBeVisible({ timeout: 20_000 })
    const avatarId = (await (await page.request.get('/api/me')).json()).user.avatarId as string
    const access = await (await viewer.request.get('/api/access')).json()
    expect(access.boards.find((b: { id: string }) => b.id === board)).toMatchObject({ sharedByAvatarId: avatarId })
    await page.getByTestId('photo-options-trigger').click()
    await page.getByRole('menuitem', { name: 'Remove photo', exact: true }).click()
    await expect(member.locator('img')).toHaveCount(0, { timeout: 20_000 })
  } finally { await context.close() }
})


test('profile photo options: balanced identity, picker cancellation, nested keyboard dismissal and removal retry', async ({ page }) => {
  await avatarUser(page, `photo${crypto.randomUUID().replaceAll('-', '').slice(0, 27)}`)
  await page.getByTestId('account').click()
  const trigger = page.getByTestId('photo-options-trigger'), identity = page.locator('.account-photo-identity')
  await expect(trigger).toBeFocused()
  const avatar = (await trigger.boundingBox())!, name = (await identity.locator('.account-profile-text').boundingBox())!
  expect(avatar.width).toBe(56)
  expect(name.x - (avatar.x + avatar.width)).toBe(16)
  expect(Math.abs(name.y + name.height / 2 - avatar.y - avatar.height / 2)).toBeLessThan(1)
  await expect(trigger.locator('.account-photo-camera')).toHaveCSS('opacity', '0')
  await trigger.hover()
  await expect(trigger.locator('.account-photo-camera')).toHaveCSS('opacity', '1')
  await page.mouse.move(0, 0)
  await expect(trigger.locator('.account-photo-camera')).toHaveCSS('opacity', '0')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Add photo', exact: true })).toBeFocused()
  await expect(trigger.locator('.account-photo-camera')).toHaveCSS('opacity', '0')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('edit-profile')).toBeFocused()
  await expect(page.getByTestId('photo-options')).toHaveCount(0)
  await trigger.focus(); await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+Tab')
  await expect(trigger).toBeFocused()
  await expect(page.getByTestId('photo-options')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.getByTestId('account')).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('account')).toBeFocused()
  await expect(identity).toHaveCount(0)
  await page.getByTestId('account').click(); await trigger.click()
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Add photo', exact: true }).click()
  await (await picker).setFiles([])
  await expect(identity).toBeVisible()
  await expect(page.getByTestId('avatar-editor')).toHaveCount(0)
  await openPhoto(page)
  await page.getByRole('button', { name: 'Save photo', exact: true }).click()
  await expect(trigger).toBeFocused()
  const original = await trigger.locator('img').getAttribute('src')
  await page.locator('.account-menu-appearance button').focus()
  await page.mouse.move(0, 0)
  await expect(trigger.locator('.account-photo-camera')).toHaveCSS('opacity', '0')
  await trigger.hover()
  await expect(trigger.locator('.account-photo-camera')).toHaveCSS('opacity', '1')
  await trigger.click()
  await page.mouse.move(0, 0)
  await expect(trigger.locator('.account-photo-camera')).toHaveCSS('opacity', '0')
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitem', { name: 'Remove photo', exact: true })).toBeFocused()
  await page.route('**/api/me/avatar', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Could not remove your photo. Try again.' }) }), { times: 1 })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Try again')
  await expect(trigger.locator('img')).toHaveAttribute('src', original!)
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Remove photo', exact: true }).click()
  await expect(trigger.locator('img')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('profile selection: outside dragging, every image edge and immediate reversal keep photo pixels fixed', async ({ page }) => {
  await avatarUser(page); await openPhoto(page)
  const crop = page.getByTestId('avatar-crop'), selection = page.getByTestId('avatar-selection')
  const canvas = crop.locator('canvas'), photo = await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())
  const stage = (await crop.boundingBox())!, first = (await selection.boundingBox())!
  await page.mouse.move(stage.x + 3, stage.y + 3); await page.mouse.down()
  await page.mouse.move(stage.x + 25, stage.y + 25); await page.mouse.up()
  expect(await selection.boundingBox()).toEqual(first)
  const x = first.x + first.width / 2, y = first.y + first.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(stage.x + stage.width + 100, stage.y + stage.height + 100)
  const edge = Number(await crop.getAttribute('data-x'))
  await page.mouse.move(stage.x + stage.width + 99, stage.y + stage.height + 99)
  expect(Number(await crop.getAttribute('data-x'))).toBeLessThan(edge)
  await page.mouse.up()
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await crop.focus()
    for (let n = 0; n < 15; n++) await page.keyboard.press(`Shift+${key}`)
    const box = (await selection.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(stage.x + 43)
    expect(box.y).toBeGreaterThanOrEqual(stage.y + 43)
    expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width - 43)
    expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height - 43)
  }
  expect(await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(photo)
})


test('profile transparency is visible in the editor and preserved in the saved PNG', async ({ page }) => {
  await avatarUser(page)
  await openPhoto(page, await photoFile(page, 600, 600, true))
  await expect(page.locator('.avatar-transparency')).toBeVisible()
  await page.getByRole('button', { name: 'Save photo', exact: true }).click()
  const avatar = page.getByTestId('account').locator('img')
  await expect(avatar).toBeVisible()
  const alpha = await page.evaluate(async (url) => {
    const image = await createImageBitmap(await (await fetch(url)).blob()), canvas = new OffscreenCanvas(512, 512), ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0); image.close()
    return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(511, 511, 1, 1).data[3]]
  }, (await avatar.getAttribute('src'))!)
  expect(alpha).toEqual([255, 0])
})


test('profile visible corner marks themselves resize the crop', async ({ page }) => {
  await avatarUser(page); await openPhoto(page)
  for (const corner of [{ x: -1, y: -1, name: 'top left' }, { x: 1, y: -1, name: 'top right' }, { x: -1, y: 1, name: 'bottom left' }, { x: 1, y: 1, name: 'bottom right' }]) {
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    const box = (await page.getByTestId('avatar-selection').boundingBox())!
    const x = box.x + (corner.x < 0 ? 4 : box.width - 4), y = box.y + (corner.y < 0 ? 1 : box.height - 1)
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="slider"]')?.getAttribute('aria-label'), { x, y })).toBe(`Resize crop from ${corner.name}`)
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - corner.x * 15, y - corner.y * 15, { steps: 5 }); await page.mouse.up()
    expect(Number(await page.getByTestId('avatar-crop').getAttribute('data-zoom'))).toBeGreaterThan(1.25)
  }
})
