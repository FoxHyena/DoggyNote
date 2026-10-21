import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { postSync, pullAllObjects } from './helpers.ts'

/** Each test has its own account, so collection mutations never race another project. */
export async function stickerBoard(page: Page, admin: APIRequestContext) {
  const username = `stick${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
  const created = await admin.post('/api/users', { data: { username, password: 'stickers-test-password' } })
  expect(created.status(), await created.text()).toBe(201)
  expect((await page.request.post('/api/auth/login', { data: { username, password: 'stickers-test-password' } })).ok()).toBe(true)
  const id = crypto.randomUUID()
  const board = { id, kind: 'board', parentId: null, title: 'A very good day', icon: 'paw', color: 'gold', createdAt: Date.now() }
  expect((await postSync(page.request, { data: { changes: [{ id, patch: board }] } })).ok()).toBe(true)
  await page.goto(`/#/b/${id}`)
  await expect(page.getByTestId('canvas')).toBeVisible()
  return { id, username }
}
export async function openStickerTray(page: Page) {
  const { phone, touch } = await page.evaluate(() => ({ phone: matchMedia('(max-width: 599px), (pointer: coarse) and (max-height: 500px)').matches, touch: navigator.maxTouchPoints > 0 }))
  if (!phone) { await expect(page.getByTestId('tool-stickers')).toBeVisible(); await page.getByTestId('tool-stickers').click() }
  else if (touch) { await page.getByTestId('mobile-stickers').tap() }
  else { await page.getByTestId('mobile-stickers').click() }
  await expect(page.getByTestId('sticker-tray')).toBeVisible()
}
/** Desktop's deliberate secondary action; no preview buttons clutter the grid. */
export async function previewSticker(page: Page, emoji = '🐶') {
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: new RegExp(`^Choose ${emoji} from`) }).first().click({ button: 'right' })
  await expect(tray.getByTestId('sticker-preview-back')).toBeVisible()
}
export async function importFixturePack(page: Page) {
  await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByLabel('Pack link or short name').fill('https://t.me/addstickers/DoggyFixture')
  await tray.getByRole('button', { name: 'Preview pack', exact: true }).click()
  await expect(tray.getByRole('heading', { name: 'Doggy daydreams' })).toBeVisible()
  await expect(tray.getByTestId('sticker-pick')).toHaveCount(12)
  expect((await (await page.request.get('/api/stickers')).json()).packs).toHaveLength(0)
  await tray.getByRole('button', { name: 'Add pack', exact: true }).click()
  await expect(tray.locator('.sticker-pack-title')).toContainText('Doggy daydreams')
  await expect.poll(() => tray.getByTestId('sticker-pick').first().locator('img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
}
export async function placedStickers(page: Page, boardId: string) {
  const all = await pullAllObjects(page.request)
  return all.objects.filter((o: { kind: string; boardId: string; deletedAt?: number; purged?: boolean }) => o.kind === 'sticker' && o.boardId === boardId && !o.deletedAt && !o.purged)
}
export async function stickerState(page: Page, id?: string) {
  const el = id ? page.locator(`[data-sticker-id="${id}"]`) : page.getByTestId('placed-sticker').first()
  return el.evaluate((el) => ({ id: (el as HTMLElement).dataset.stickerId!, x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top), w: parseFloat((el as HTMLElement).style.width), angle: parseFloat((el.querySelector('.sticker-rotation') as HTMLElement).style.transform.match(/rotate\(([-\d.]+)/)![1]) }))
}

/** Puts stickers from the first collected pack on a board at world positions, 120 wide. Returns their ids. */
export async function seedStickers(page: Page, boardId: string, spots: { x: number; y: number }[]) {
  const pack = (await (await page.request.get('/api/stickers')).json()).packs[0], ids = spots.map(() => crypto.randomUUID())
  const changes = spots.map((p, i) => {
    const { assetId, stickerId, packName, emoji, width, height, format } = pack.stickers[i % pack.stickers.length]
    return { id: ids[i], patch: { id: ids[i], kind: 'sticker', boardId, ...p, w: 120, angle: 0, z: i + 1, createdAt: Date.now(), content: { assetId, stickerId, packName, emoji, width, height, format } } }
  })
  expect((await postSync(page.request, { data: { changes } })).ok()).toBe(true)
  return ids
}

/** A real grab point on the selected sticker's circular transform control. */
export async function stickerRingPoint(page: Page, degrees = -45) {
  const b = (await page.getByTestId('sticker-ring').boundingBox())!, a = degrees * Math.PI / 180
  return { x: b.x + b.width / 2 * (1 + Math.cos(a)), y: b.y + b.height / 2 * (1 + Math.sin(a)) }
}

/** Pairs the signed-in account with a fixture Telegram identity through the real endpoints. No bot is messaged. */
export async function pairFixtureTelegram(page: Page, username = 'fixture_pup') {
  const telegramId = Math.floor(Math.random() * 1e9) + 1e9
  let updateId = Math.floor(Math.random() * 1e12)
  const sender = { from: { id: telegramId, username }, chat: { id: telegramId, type: 'private' } }
  const webhook = (message: object) => page.request.post('/api/telegram/webhook', { headers: { 'x-telegram-bot-api-secret-token': 'e2e-sticker-webhook' }, data: { update_id: updateId++, message: { ...sender, ...message } } })
  const { url } = await (await page.request.post('/api/stickers/telegram/challenge', { data: {} })).json()
  await webhook({ text: `/start ${new URL(url).searchParams.get('start')}` })
  expect((await page.request.post('/api/stickers/telegram/confirm', { data: { telegramId: String(telegramId) } })).status()).toBe(200)
  return { sendSticker: (setName: string) => webhook({ sticker: { set_name: setName } }) }
}

/** Turns or resizes the selected sticker from its focused ring with the arrow keys, like a keyboard user. */
export async function adjustSticker(page: Page, kind: 'size' | 'angle', value: number) {
  const ring = page.getByTestId('sticker-transform'), id = (await ring.getAttribute('data-sticker-target'))!
  await ring.focus()
  for (let i = 0; i < 200; i++) {
    const s = await stickerState(page, id), diff = value - Math.round(kind === 'size' ? s.w : s.angle)
    // Done adjusting: leaving the ring lands the burst as one undo step.
    if (!diff) return ring.blur()
    const big = Math.abs(diff) >= (kind === 'size' ? 10 : 15)
    await page.keyboard.press(`${big ? 'Shift+' : ''}${kind === 'size' ? diff > 0 ? 'ArrowUp' : 'ArrowDown' : diff > 0 ? 'ArrowRight' : 'ArrowLeft'}`)
  }
  throw new Error(`Could not reach ${kind} ${value}`)
}
