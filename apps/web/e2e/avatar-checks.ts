import { expect, type Page } from '@playwright/test'

export async function avatarUser(page: Page, username = `photo-${crypto.randomUUID().slice(0, 12)}`) {
  const created = await page.request.post('/api/users', { data: { username, password: 'phototest123' } })
  expect(created.ok(), await created.text()).toBe(true)
  const { user } = await created.json() as { user: { id: string } }
  const signed = await page.request.post('/api/auth/login', { data: { username, password: 'phototest123' } })
  expect(signed.ok()).toBe(true)
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  return { username, id: user.id }
}

/** Asymmetric colour blocks make exported framing testable without screenshot thresholds. */
export async function photoFile(page: Page, width = 900, height = 600, transparent = false) {
  const data = await page.evaluate(({ width, height, transparent }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')!
    if (!transparent) { ctx.fillStyle = '#9d532e'; ctx.fillRect(0, 0, width, height) }
    ctx.fillStyle = '#b9dcc9'; ctx.fillRect(0, 0, width / 2, height)
    ctx.fillStyle = '#2a2521'; ctx.font = 'bold 80px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('MILO', width / 2, height / 2)
    return canvas.toDataURL('image/png').split(',')[1]!
  }, { width, height, transparent })
  return { name: 'milo.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }
}

export async function openPhoto(page: Page, file?: Awaited<ReturnType<typeof photoFile>>) {
  if (await page.getByTestId('account').getAttribute('aria-expanded') !== 'true') await page.getByTestId('account').click()
  await page.getByTestId('photo-options-trigger').click()
  const selected = file ?? await photoFile(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('choose-avatar').click()
  await (await chooser).setFiles(selected)
  await expect(page.getByTestId('avatar-editor')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close photo editor', exact: true })).toBeFocused()
  await expect(page.getByRole('slider', { name: 'Resize crop from bottom right' })).toBeEnabled()
  await page.getByTestId('avatar-editor').evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))) })
}

/** Drag a real corner diagonally; the opposite corner stays anchored. */
export async function resizePhoto(page: Page, fraction = .5) {
  const selection = (await page.getByTestId('avatar-selection').boundingBox())!
  const zoom = Number(await page.getByTestId('avatar-crop').getAttribute('data-zoom'))
  const handle = page.getByRole('slider', { name: 'Resize crop from bottom right' })
  const box = (await handle.boundingBox())!
  const side = selection.width * zoom
  const x = box.x + box.width / 2, y = box.y + box.height / 2, delta = side * fraction - selection.width - (fraction === .25 ? 8 : 0)
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + delta, y + delta, { steps: 8 }); await page.mouse.up()
  await expect.poll(async () => Number(await page.getByTestId('avatar-crop').getAttribute('data-zoom'))).toBeCloseTo(1 / fraction, 1)
}
