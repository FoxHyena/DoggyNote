import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { at, MOD, camera, canvasBox, cardByText, postSync, waitForSync } from './helpers.ts'
import { setCamera } from './touch.ts'
import { importFixturePack, previewSticker, openStickerTray, placedStickers, stickerBoard, stickerRingPoint, stickerState, adjustSticker, seedStickers } from './sticker-helpers.ts'

test('link preview, one-shot placement, keyboard transforms, undo, reload, collection and share', async ({ page, request, browser }) => {
  const { id } = await stickerBoard(page, request)
  await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray')
  await previewSticker(page)
  await expect(tray.locator('.sticker-large')).toBeVisible()
  await tray.getByRole('button', { name: 'Favorite', exact: true }).click()
  await expect(tray.getByRole('button', { name: 'Unfavorite' })).toBeVisible()
  await tray.getByRole('button', { name: 'Place sticker', exact: true }).click()
  await expect(tray).toHaveCount(0)
  await expect(page.getByTestId('sticker-placement')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await openStickerTray(page)
  await tray.getByLabel('Search your stickers').fill('🐶')
  await expect(tray.getByTestId('sticker-pick')).toHaveCount(4)
  await tray.getByTestId('sticker-pick').first().click()
  await page.getByRole('button', { name: 'Place at center', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  await expect(page.getByTestId('sticker-placement')).toHaveCount(0)
  const initial = await stickerState(page)
  await adjustSticker(page, 'angle', 32)
  await expect.poll(async () => (await stickerState(page)).angle).toBe(32)
  await adjustSticker(page, 'size', 210)
  await expect.poll(async () => (await stickerState(page)).w).toBe(210)
  await page.getByTestId('undo').click()
  await expect.poll(async () => (await stickerState(page)).w).toBe(initial.w)
  await page.getByTestId('redo').click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(2)
  const copy = await stickerState(page, (await page.locator('.placed-sticker.selected').getAttribute('data-sticker-id'))!)
  expect(copy.angle).toBe(32); expect(copy.w).toBe(210)
  await page.getByRole('button', { name: 'Bury', exact: true }).click()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  await page.getByTestId('tool-trash').click()
  await page.getByTestId('restore').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('placed-sticker')).toHaveCount(2)
  await waitForSync(page)
  expect(await placedStickers(page, id)).toHaveLength(2)
  await page.reload()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(2)
  await openStickerTray(page)
  await tray.getByRole('button', { name: '★ Favorites', exact: true }).click()
  await expect(tray.getByTestId('sticker-pick')).toHaveCount(1)
  await tray.getByRole('button', { name: 'Doggy daydreams', exact: true }).click()
  await tray.getByRole('button', { name: 'Remove Doggy daydreams' }).click()
  await expect(tray.locator('.sticker-pack-title')).toHaveCount(0)
  await tray.getByRole('button', { name: 'Close stickers' }).click()
  await expect(page.getByTestId('placed-sticker').first().locator('img')).toBeVisible()
  const share = await page.request.post('/api/shares', { data: { boardId: id, includeChildren: false } })
  expect(share.status()).toBe(201)
  const token = (await share.json()).share.token
  const viewer = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const p = await viewer.newPage(); await p.goto(`/s/${token}`)
    await expect(p.getByTestId('placed-sticker')).toHaveCount(2)
    await expect(p.getByTestId('sticker-controls')).toHaveCount(0)
    await expect(p.getByTestId('tool-stickers')).toHaveCount(0)
    await expect.poll(() => p.getByTestId('placed-sticker').first().locator('img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
  } finally { await viewer.close() }
})

test('artwork-only grid opens a contextual preview and its source pack without placing', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray')
  await expect(tray.getByRole('button', { name: /^Preview / })).toHaveCount(0)
  await expect(tray.locator('.sticker-head')).not.toContainText('personality')
  await previewSticker(page)
  const source = tray.getByTestId('sticker-source-pack')
  await expect(source).toContainText('Doggy daydreams')
  await expect(tray.getByRole('button', { name: 'Place sticker', exact: true })).toBeEnabled()
  await expect(page.getByTestId('sticker-placement')).toHaveCount(0)
  await source.click()
  await expect(tray.getByRole('heading', { name: 'Doggy daydreams', exact: true })).toBeVisible()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(0)
  await tray.getByRole('button', { name: 'Back to your collection', exact: true }).click()
  await expect(tray.locator('.sticker-pack-title')).toContainText('Doggy daydreams')
  const tile = tray.getByTestId('sticker-pick').first()
  await tile.focus(); await page.keyboard.press('Shift+F10')
  await expect(tray.locator('.sticker-large')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tile).toBeFocused()
  await expect(page.getByTestId('sticker-placement')).toHaveCount(0)
})

test('pointer drag commits once; outside drop and Escape cancel; rotated resize and move undo at several zoom levels', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  const pick = page.getByTestId('sticker-pick').first(), box = (await pick.boundingBox())!
  const target = await at(page, .65, .5)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 12 })
  await expect(page.getByTestId('sticker-ghost')).toBeVisible()
  await page.mouse.up()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  const before = await stickerState(page)
  const placed = (await page.getByTestId('placed-sticker').boundingBox())!
  await page.mouse.move(placed.x + placed.width / 2, placed.y + placed.height / 2); await page.mouse.down(); await page.mouse.move(target.x + 80, target.y + 30, { steps: 8 }); await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await stickerState(page)).toEqual(before)
  // Rotate via the real handle, then resize along its new visual diagonal.
  const rotate = await stickerRingPoint(page, -90)
  await page.mouse.move(rotate.x, rotate.y); await page.mouse.down(); await page.mouse.move(target.x + 100, target.y, { steps: 12 }); await page.mouse.up()
  expect(Math.abs((await stickerState(page)).angle)).toBeGreaterThan(20)
  const rotated = await stickerState(page)
  const resize = await stickerRingPoint(page, 45)
  await page.mouse.move(resize.x, resize.y); await page.mouse.down(); await page.mouse.move(resize.x + 70, resize.y + 30, { steps: 12 }); await page.mouse.up()
  expect((await stickerState(page)).w).not.toBe(rotated.w)
  await page.getByTestId('undo').click(); expect(await stickerState(page)).toEqual(rotated)
  await page.getByTestId('redo').click()
  await page.keyboard.press(`${MOD}+-`)
  await page.waitForTimeout(260)
  const b = (await page.getByTestId('placed-sticker').boundingBox())!
  const first = await stickerState(page)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 8 }); await page.mouse.up()
  expect((await stickerState(page)).x - first.x).toBeCloseTo(50, 0)
  await openStickerTray(page)
  await expect(page.getByTestId('sticker-pick').first()).toBeVisible()
  const t = (await page.getByTestId('sticker-pick').first().boundingBox())!
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await page.mouse.down(); await page.mouse.move(20, 20, { steps: 10 }); await page.mouse.up()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
})

test('bot pairing confirms the fixture identity, suggests a pack without adding, disconnects and rejects replay', async ({ page, request }) => {
  await stickerBoard(page, request); await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByRole('button', { name: 'Send a sticker in Telegram ↗', exact: true }).click()
  await tray.getByRole('button', { name: 'Connect Telegram bot', exact: true }).click()
  await tray.getByText('Use the connection link', { exact: true }).click()
  await expect(tray.getByLabel('Telegram bot pairing link')).toBeVisible()
  const url = await tray.getByLabel('Telegram bot pairing link').inputValue()
  const challenge = new URL(url).searchParams.get('start')!
  // Fixture updates target only our explicitly isolated test Worker/account. No bot is messaged.
  const telegramId = Math.floor(Math.random() * 1e9) + 1e9
  const sender = { from: { id: telegramId, username: 'fixture_pup' }, chat: { id: telegramId, type: 'private' } }
  const updateId = Math.floor(Math.random() * 1e12)
  const webhook = (data: unknown) => page.request.post('/api/telegram/webhook', { headers: { 'x-telegram-bot-api-secret-token': 'e2e-sticker-webhook' }, data })
  const startReply = await webhook({ update_id: updateId, message: { ...sender, text: `/start ${challenge}` } })
  expect(startReply.status()).toBe(200)
  expect(await startReply.json()).toMatchObject({ method: 'sendMessage', chat_id: telegramId, text: expect.stringContaining('confirm your Telegram account') })
  await expect(tray.getByText('@fixture_pup', { exact: true })).toBeVisible()
  expect((await (await page.request.get('/api/stickers/telegram')).json()).pair).toBeNull()
  await tray.getByRole('button', { name: 'Confirm this account', exact: true }).click()
  await expect(tray.getByText('Connected: @fixture_pup', { exact: true })).toBeVisible()
  expect((await page.request.post('/api/stickers/telegram/confirm', { data: { telegramId: String(telegramId) } })).status()).toBe(409)
  const sent = { update_id: updateId + 1, message: { ...sender, sticker: { set_name: 'DoggyFixture' } } }
  const importReply = await webhook(sent)
  expect(importReply.status()).toBe(200)
  expect(await importReply.json()).toMatchObject({ method: 'sendMessage', chat_id: telegramId, text: expect.stringContaining('preview its pack') })
  expect(await (await webhook(sent)).json()).toEqual({ ok: true })
  expect(await (await webhook({ ...sent, update_id: updateId + 3 })).json()).toEqual({ ok: true })
  // The suggestion is named by the pack's title, not its short name.
  await expect(tray.getByRole('list', { name: 'Packs from Telegram' })).toContainText('Doggy daydreams')
  await expect(tray.getByRole('button', { name: 'Preview Doggy daydreams', exact: true })).toBeVisible()
  // After a reload, the Stickers button carries a badge and the collection offers the pack in one click.
  await page.reload(); await expect(page.getByTestId('sticker-found-badge')).toBeVisible()
  await expect(page.getByTestId('tool-stickers')).toHaveAttribute('title', 'Pack found in Telegram')
  await openStickerTray(page)
  const found = tray.getByRole('list', { name: 'Packs from Telegram' })
  await expect(found).toContainText('Doggy daydreams')
  await found.getByRole('button', { name: 'Preview Doggy daydreams', exact: true }).click()
  await expect(tray.getByRole('heading', { name: 'Doggy daydreams' })).toBeVisible()
  expect((await (await page.request.get('/api/stickers')).json()).packs).toHaveLength(0)
  await tray.getByRole('button', { name: 'Add pack', exact: true }).click()
  await expect(tray.getByTestId('sticker-pick')).toHaveCount(12)
  // Adding the pack answers the suggestion everywhere.
  await expect(found).toHaveCount(0)
  await expect(page.getByTestId('sticker-found-badge')).toHaveCount(0)
  expect((await (await page.request.get('/api/stickers/telegram')).json()).pending).toBeNull()
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByRole('button', { name: 'Send a sticker in Telegram ↗', exact: true }).click()
  const disconnect = tray.getByRole('button', { name: 'Disconnect Telegram', exact: true })
  await expect(disconnect).toHaveAttribute('title', 'Your packs and placed stickers stay.')
  await expect(disconnect).toHaveText('Disconnect')
  // The disconnect sits on the account's own row.
  const row = (await tray.getByText('Connected: @fixture_pup', { exact: true }).boundingBox())!, button = (await disconnect.boundingBox())!
  expect(Math.abs((row.y + row.height / 2) - (button.y + button.height / 2))).toBeLessThan(4)
  await disconnect.click()
  await expect(page.getByText('Telegram disconnected. Your packs and placed stickers stay.')).toBeVisible()
  expect((await (await page.request.get('/api/stickers')).json()).packs).toHaveLength(1)
  expect((await webhook({ ...sent, update_id: updateId + 2 })).status()).toBe(200)
  expect((await (await page.request.get('/api/stickers/telegram')).json()).pending).toBeNull()
  // A pack already in the collection is not suggested again; a dismissed suggestion clears the row and the badge.
  await tray.getByRole('button', { name: 'Connect Telegram bot', exact: true }).click()
  await expect(tray.getByRole('link', { name: 'Open bot in Telegram ↗', exact: true })).toBeVisible()
  const second = new URL(await tray.getByLabel('Telegram bot pairing link').inputValue()).searchParams.get('start')!
  await webhook({ update_id: updateId + 4, message: { ...sender, text: `/start ${second}` } })
  await tray.getByRole('button', { name: 'Confirm this account', exact: true }).click()
  await expect(tray.getByText('Connected: @fixture_pup', { exact: true })).toBeVisible()
  await webhook({ update_id: updateId + 5, message: { ...sender, sticker: { set_name: 'DoggyFixture' } } })
  await webhook({ update_id: updateId + 6, message: { ...sender, sticker: { set_name: 'PuppyParade42x' } } })
  await tray.getByRole('button', { name: 'Back to add a pack', exact: true }).click(); await tray.getByRole('button', { name: 'Back to your collection', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('sticker-found-badge')).toBeVisible()
  await expect(found.getByRole('listitem')).toHaveCount(1)
  await found.getByRole('button', { name: 'Dismiss Puppy parade', exact: true }).click()
  await expect(found).toHaveCount(0)
  await expect(page.getByTestId('sticker-found-badge')).toHaveCount(0)
})

test('dragging a sticker lifts it to the front, and one undo restores its place', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  const place = async (i: number) => { await page.getByTestId('sticker-pick').nth(i).click(); await page.getByRole('button', { name: 'Place at center', exact: true }).click() }
  const drag = async (id: string, dx: number, dy: number) => {
    const c = (await page.locator(`[data-sticker-id="${id}"]`).boundingBox())!, from = { x: c.x + c.width / 2, y: c.y + c.height / 2 }
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(from.x + dx * i / 5, from.y + dy * i / 5)
    await page.mouse.up()
  }
  const front = () => page.getByTestId('placed-sticker').last().getAttribute('data-sticker-id')
  await place(0); const a = (await stickerState(page)).id
  await drag(a, 220, 0)
  await openStickerTray(page); await place(3)
  const b = (await page.getByTestId('placed-sticker').last().getAttribute('data-sticker-id'))!
  expect(b).not.toBe(a)
  const before = await stickerState(page, a)
  await drag(a, 30, 20)
  await expect.poll(front).toBe(a)
  expect((await stickerState(page, a)).x).toBeGreaterThan(before.x + 20)
  await page.getByTestId('undo').click()
  await expect.poll(front).toBe(b)
  expect((await stickerState(page, a)).x).toBeCloseTo(before.x, 0)
  // The supplied artwork renders directly, without expensive live silhouette effects.
  await expect(page.getByTestId('placed-sticker').first()).toHaveCSS('filter', 'none')
  await expect(page.locator('.sticker-visual').first()).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('filter#dn-sticker-outline')).toHaveCount(0)
  // The sticker bar floats just above the selected sticker's ring: icon buttons with tooltips, no stray text.
  await page.locator(`[data-sticker-id="${a}"] button`).focus()
  const bar = page.getByTestId('sticker-controls'), ring = (await page.getByTestId('sticker-ring').boundingBox())!, box = (await bar.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(ring.y + 1)
  expect(Math.abs(box.x + box.width / 2 - (ring.x + ring.width / 2))).toBeLessThan(2)
  for (const name of ['Forward', 'Backward', 'Select underneath', 'View pack', 'Duplicate', 'Bury']) {
    const button = bar.getByRole('button', { name, exact: true })
    await expect(button).toHaveAttribute('title', /.+/)
    expect((await button.boundingBox())!.width).toBeLessThanOrEqual(34)
  }
  await expect(bar).not.toContainText('Drag the circle')
  // Turning and resizing belong to the ring: the bar has no size or angle controls.
  await expect(bar.getByRole('slider')).toHaveCount(0); await expect(bar.getByRole('spinbutton')).toHaveCount(0)
  await expect(bar.getByRole('button', { name: 'Reset size and rotation', exact: true })).toHaveCount(0)
  await waitForSync(page)
})

test('a pinned tray stays open while placing by click or drag, and Escape cancels placement first', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  const tray = page.getByTestId('sticker-tray'), pin = tray.getByRole('button', { name: 'Keep stickers open', exact: true })
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  // The pinned state shows immediately, even while the pointer still rests on the pin.
  await pin.hover(); await pin.click(); await expect(pin).toHaveAttribute('aria-pressed', 'true')
  const accent = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.color = 'var(--dn-accent)'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c })
  await expect.poll(() => pin.evaluate((el) => getComputedStyle(el).color)).toBe(accent)
  // Click to arm, click the board to place: the tray stays.
  await tray.getByTestId('sticker-pick').first().click()
  await expect(page.getByTestId('sticker-placement')).toBeVisible(); await expect(tray).toBeVisible()
  const spot = await at(page, .6, .4); await page.mouse.click(spot.x, spot.y)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1); await expect(tray).toBeVisible()
  // Escape cancels a placement in progress without closing the tray.
  await tray.getByTestId('sticker-pick').nth(1).click(); await expect(page.getByTestId('sticker-placement')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sticker-placement')).toHaveCount(0); await expect(tray).toBeVisible()
  // Dragging from the tray onto the board keeps it open too.
  const tile = (await tray.getByTestId('sticker-pick').nth(2).boundingBox())!, target = await at(page, .7, .6)
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2); await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(tile.x + (target.x - tile.x) * i / 8, tile.y + (target.y - tile.y) * i / 8)
  await page.mouse.up()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(2); await expect(tray).toBeVisible()
  // Pinned, clicking away leaves the tray open.
  const empty = await at(page, .9, .15); await page.mouse.click(empty.x, empty.y)
  await expect(tray).toBeVisible()
  // The choice is remembered on this device; unpinned, placing closes the tray again.
  await page.reload(); await openStickerTray(page)
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await pin.click(); await tray.getByTestId('sticker-pick').first().click()
  await expect(tray).toHaveCount(0)
  await page.keyboard.press('Escape')
  // Unpinned, buttons on the board don't count as clicking away, but a click on empty board does.
  await openStickerTray(page)
  await page.getByTestId('zoom').click(); await page.getByTestId('zoom').click(); await expect(tray).toBeVisible()
  await page.mouse.click(empty.x, empty.y)
  await expect(tray).toHaveCount(0)
  await waitForSync(page)
})

test('two sessions merge different transform fields and reconnect cannot resend a stale angle', async ({ page, request, browser }) => {
  test.setTimeout(60_000)
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  await page.getByTestId('sticker-pick').first().click(); await page.getByRole('button', { name: 'Place at center', exact: true }).click(); await waitForSync(page)
  const initial = await stickerState(page)
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: await page.context().storageState() })
  try {
    const other = await ctx.newPage(); await other.goto(page.url()); await expect(other.getByTestId('placed-sticker')).toHaveCount(1)
    const b = (await other.getByTestId('placed-sticker').boundingBox())!
    await other.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    // A disconnects and changes angle. B moves without knowing that angle.
    await page.context().setOffline(true)
    await adjustSticker(page, 'angle', 42)
    await other.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await other.mouse.down(); await other.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 20, { steps: 8 }); await other.mouse.up(); await waitForSync(other)
    const moved = await stickerState(other); expect(moved.x).not.toBe(initial.x)
    await page.context().setOffline(false); await page.getByTestId('sync-status').click(); await waitForSync(page)
    await other.getByTestId('sync-status').click(); await expect.poll(async () => (await stickerState(other)).angle).toBe(42)
    await page.getByTestId('sync-status').click(); await expect.poll(async () => (await stickerState(page)).x).toBe(moved.x)
    // A later independent angle on B must survive another size edit from A.
    const selected = (await other.getByTestId('placed-sticker').boundingBox())!
    await other.mouse.click(selected.x + selected.width / 2, selected.y + selected.height / 2)
    await adjustSticker(other, 'angle', -25); await waitForSync(other)
    await adjustSticker(page, 'size', 200); await waitForSync(page)
    await page.getByTestId('sync-status').click(); await expect.poll(async () => (await stickerState(page)).angle).toBe(-25)
    await page.reload(); await expect.poll(async () => (await stickerState(page)).angle).toBe(-25)
    expect((await placedStickers(page, id))[0].w).toBe(200)
  } finally { await page.context().setOffline(false); await ctx.close() }
})

test('keyboard Space previews and Enter arms placement; a pack preview cannot place before Add', async ({ page, request }) => {
  await stickerBoard(page, request); await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByLabel('Pack link or short name').fill('DoggyFixture'); await tray.getByRole('button', { name: 'Preview pack', exact: true }).click()
  await tray.getByTestId('sticker-pick').first().click()
  await expect(tray.locator('.sticker-large')).toBeVisible()
  await expect(tray.getByRole('button', { name: 'Place sticker', exact: true })).toBeDisabled()
  await expect(page.getByTestId('sticker-placement')).toHaveCount(0)
  await tray.getByTestId('sticker-preview-back').click(); await tray.getByRole('button', { name: 'Add pack', exact: true }).click()
  await expect(tray.locator('.sticker-pack-title')).toContainText('Doggy daydreams')
  await tray.getByTestId('sticker-pick').first().focus(); await page.keyboard.press('Space')
  await expect(tray.locator('.sticker-large')).toBeVisible()
  await page.keyboard.press('Escape'); await expect(tray.locator('.sticker-large')).toHaveCount(0)
  await expect(tray.getByTestId('sticker-pick').first()).toBeFocused(); await page.keyboard.press('Enter')
  await expect(page.getByTestId('sticker-placement')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Place at center', exact: true })).toBeFocused(); await page.keyboard.press('Enter')
  await expect(page.getByTestId('sticker-controls')).toBeFocused()
  // Keyboard: the focused ring turns with left/right and resizes with up/down; Shift takes bigger steps.
  const ring = page.getByTestId('sticker-transform'), before = await stickerState(page)
  // A fresh sticker has nothing to reset.
  await expect(page.getByTestId('sticker-reset')).toHaveCount(0)
  await ring.focus()
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => Math.round((await stickerState(page)).angle)).toBe(Math.round(before.angle) + 16)
  await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('ArrowDown')
  await expect.poll(async () => Math.round((await stickerState(page)).w)).toBe(Math.round(before.w) + 9)
  await expect(ring).toBeFocused()
  // The whole burst of presses is one undo step.
  await page.keyboard.press(`${MOD}+z`)
  await expect.poll(async () => (await stickerState(page)).w).toBe(before.w); expect((await stickerState(page)).angle).toBe(before.angle)
  await page.keyboard.press(`${MOD}+Shift+z`)
  await expect.poll(async () => Math.round((await stickerState(page)).angle)).toBe(Math.round(before.angle) + 16)
  // A turned or resized sticker shows a reset by its ring, back to a fresh sticker's size (placed here at 100%).
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await ring.blur()
  await expect.poll(async () => Math.round((await stickerState(page)).w)).toBe(Math.round(before.w) + 9)
  const reset = page.getByTestId('sticker-reset'), center = await stickerState(page)
  await expect(reset).toHaveAttribute('aria-label', 'Reset size and rotation')
  await reset.click()
  await expect.poll(async () => (await stickerState(page)).angle).toBe(0)
  const after = await stickerState(page)
  expect(after.w).toBeCloseTo(before.w, 1)
  // It shrinks back about the same center.
  expect(after.x + after.w / 2).toBeCloseTo(center.x + center.w / 2, 0)
  await expect(reset).toHaveCount(0)
})

test('several selected stickers share one ring that turns and scales them together; grabbing any selected thing moves them all', async ({ page, request }) => {
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  await page.getByRole('button', { name: 'Close stickers', exact: true }).click()
  const spots = [{ x: 160, y: 160 }, { x: 400, y: 190 }, { x: 260, y: 360 }], ids = await seedStickers(page, id, spots), card = crypto.randomUUID()
  const changes = [{ id: card, patch: { id: card, kind: 'card', boardId: id, x: 620, y: 160, w: 240, h: 80, z: 1, color: 'none', type: 'note', content: { md: 'Comes along' }, columnId: null, createdAt: Date.now() } }]
  expect((await postSync(page.request, { data: { changes } })).ok()).toBe(true)
  await setCamera(page, { x: -24, y: -24, zoom: 1 })
  const all = () => Promise.all(ids.map((s) => stickerState(page, s)))
  const middle = async (sid: string) => { const b = (await page.locator(`[data-sticker-id="${sid}"]`).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const cardLeft = () => cardByText(page, 'Comes along').evaluate((el) => parseFloat((el as HTMLElement).style.left))
  const drag = async (from: { x: number; y: number }, dx: number, dy: number) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + dx * i / 6, from.y + dy * i / 6)
    await page.mouse.up()
  }
  // Click one, Shift-click the others: one ring around the three, no ring each.
  let p = await middle(ids[0]); await page.mouse.click(p.x, p.y)
  await page.keyboard.down('Shift')
  for (const sid of ids.slice(1)) { p = await middle(sid); await page.mouse.click(p.x, p.y) }
  await page.keyboard.up('Shift')
  const ring = page.getByTestId('sticker-ring')
  await expect(ring).toHaveCount(1); await expect(ring).toHaveAttribute('data-ring', 'group')
  await expect(page.getByTestId('sticker-transform')).toHaveAttribute('aria-label', 'Turn and resize 3 stickers')
  await expect(page.getByTestId('sticker-reset')).toHaveCount(0)
  const shots = resolve(`../../docs/qa/stickers/round-${process.env.STICKER_VISUAL_ROUND ?? '1'}`); mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: resolve(shots, `${test.info().project.name}-group-ring.png`) })
  // Drag the ring a third of a turn's worth further out: all three turn 30° and grow 25% about the ring's center.
  const before = await all(), r = (await ring.boundingBox())!, c = { x: r.x + r.width / 2, y: r.y + r.height / 2 }, radius = r.width / 2
  const spread = (list: typeof before) => Math.hypot(list[1].x + list[1].w / 2 - list[0].x - list[0].w / 2, list[1].y - list[0].y + (list[1].w - list[0].w) / 2)
  await page.mouse.move(c.x + radius, c.y); await page.mouse.down()
  for (let i = 1; i <= 8; i++) { const a = Math.PI / 6 * i / 8, k = 1 + .25 * i / 8; await page.mouse.move(c.x + radius * k * Math.cos(a), c.y + radius * k * Math.sin(a)) }
  await page.mouse.up()
  const turned = await all()
  for (const s of turned) { expect(s.angle).toBeCloseTo(30, 0); expect(s.w).toBeCloseTo(150, 0) }
  expect(spread(turned) / spread(before)).toBeCloseTo(1.25, 2)
  const after = (await ring.boundingBox())!
  expect(after.x + after.width / 2).toBeCloseTo(c.x, 0); expect(after.y + after.height / 2).toBeCloseTo(c.y, 0)
  // One undo puts all three back.
  await page.getByTestId('undo').click()
  await expect.poll(async () => (await all()).map((s) => [Math.round(s.angle), Math.round(s.w)])).toEqual([[0, 120], [0, 120], [0, 120]])
  // Grabbing any one of them moves the whole selection; one undo moves them back.
  await drag(await middle(ids[1]), 80, 40)
  const moved = await all()
  moved.forEach((s, i) => { expect(s.x).toBeCloseTo(before[i].x + 80, 0); expect(s.y).toBeCloseTo(before[i].y + 40, 0) })
  expect(await cardLeft()).toBe(620)
  await page.getByTestId('undo').click()
  await expect.poll(async () => (await all()).map((s) => s.x)).toEqual(before.map((s) => s.x))
  // A click without moving picks just that sticker.
  p = await middle(ids[2]); await page.mouse.click(p.x, p.y)
  await expect(ring).toHaveAttribute('data-ring', 'single')
  // A card and a sticker selected together travel together, whichever one is grabbed.
  const note = cardByText(page, 'Comes along'), nb = (await note.boundingBox())!
  await page.keyboard.down('Shift'); await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2); await page.keyboard.up('Shift')
  await drag({ x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 }, 60, 0)
  await expect.poll(cardLeft).toBe(680)
  expect((await stickerState(page, ids[2])).x).toBeCloseTo(before[2].x + 60, 0)
  await drag(await middle(ids[2]), 0, 50)
  await expect.poll(async () => (await stickerState(page, ids[2])).y).toBeCloseTo(before[2].y + 50, 0)
  await expect.poll(() => note.evaluate((el) => parseFloat((el as HTMLElement).style.top))).toBe(210)
  await waitForSync(page)
  const saved = await placedStickers(page, id)
  expect(saved.find((s: { id: string }) => s.id === ids[2]).x).toBeCloseTo(before[2].x + 60, 0)
})

test('transparent padding selects the image underneath; explicit underneath and clipboard preserve overlay behavior', async ({ page, request }) => {
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  await page.getByRole('button', { name: 'Close stickers', exact: true }).click()
  const assetId = crypto.randomUUID(), bytes = await readFile('e2e/fixtures/stickers/3.png')
  for (const size of ['thumb', 'full']) expect((await page.request.put(`/api/assets/${assetId}/${size}`, { headers: { 'content-type': 'image/png' }, data: bytes })).ok()).toBe(true)
  const cam = await camera(page), v = await canvasBox(page), center = { x: (v.width / 2 - cam.tx) / cam.zoom, y: (v.height / 2 - cam.ty) / cam.zoom }, cardId = crypto.randomUUID()
  const card = { id: cardId, kind: 'card', type: 'image', boardId: id, x: center.x - 150, y: center.y - 150, w: 300, h: 300, z: 1, color: 'none', createdAt: Date.now(), content: { assetId, width: 256, height: 256, sizes: ['thumb', 'full'] } }
  expect((await postSync(page.request, { data: { changes: [{ id: cardId, patch: card }] } })).ok()).toBe(true)
  await page.reload(); await expect(page.getByTestId('card-image')).toBeVisible()
  await openStickerTray(page); await page.getByRole('button', { name: 'Doggy daydreams', exact: true }).click(); await page.getByTestId('sticker-pick').first().click()
  const image = (await page.getByTestId('card').boundingBox())!
  await page.mouse.click(image.x + image.width / 2, image.y + image.height / 2)
  const initial = await stickerState(page), box = (await page.getByTestId('placed-sticker').boundingBox())!
  await page.mouse.click(box.x + 5, box.y + 5)
  await expect(page.getByTestId('card')).toHaveClass(/selected/)
  await expect(page.getByTestId('placed-sticker')).not.toHaveClass(/selected/)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.getByRole('button', { name: 'Select underneath', exact: true }).click()
  await expect(page.getByTestId('card')).toHaveClass(/selected/)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await adjustSticker(page, 'angle', 37)
  // Return focus to the canvas, then exercise the actual browser clipboard shortcuts.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.press(`${MOD}+c`); await page.keyboard.press(`${MOD}+v`)
  await expect(page.getByTestId('placed-sticker')).toHaveCount(2)
  const copy = await stickerState(page, (await page.getByTestId('placed-sticker').last().getAttribute('data-sticker-id'))!)
  expect(copy.x).toBeCloseTo(initial.x + 20); expect(copy.y).toBeCloseTo(initial.y + 20); expect(copy.angle).toBe(37)
  await page.getByTestId('undo').click(); await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
  await page.getByTestId('redo').click(); await expect(page.getByTestId('placed-sticker')).toHaveCount(2)
  await waitForSync(page); const saved = await placedStickers(page, id)
  await page.reload(); await expect(page.getByTestId('placed-sticker')).toHaveCount(2)
  expect(await placedStickers(page, id)).toEqual(saved)
})

test('any point on the ring turns and scales about a fixed center in one undo step at different zooms', async ({ page, request }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  await page.getByTestId('sticker-pick').first().click(); await page.getByRole('button', { name: 'Place at center', exact: true }).click()
  for (const [key, degrees] of [['0', 0], ['-', 120], ['+', -90]] as const) {
    await page.keyboard.press(`${MOD}+${key}`); await page.waitForTimeout(260)
    const before = await stickerState(page), b = (await page.getByTestId('placed-sticker').boundingBox())!, center = { x: b.x + b.width / 2, y: b.y + b.height / 2 }, ringAt = await stickerRingPoint(page, degrees)
    // WebKit delivers whole-pixel pointer positions, so aim at whole pixels and expect what they imply.
    const start = { x: Math.round(ringAt.x), y: Math.round(ringAt.y) }, a = 20 * Math.PI / 180, x = start.x - center.x, y = start.y - center.y
    const end = { x: Math.round(center.x + (x * Math.cos(a) - y * Math.sin(a)) * 1.18), y: Math.round(center.y + (x * Math.sin(a) + y * Math.cos(a)) * 1.18) }
    const scale = Math.hypot(end.x - center.x, end.y - center.y) / Math.hypot(x, y), turn = (Math.atan2(end.y - center.y, end.x - center.x) - Math.atan2(y, x)) * 180 / Math.PI
    expect(scale).toBeCloseTo(1.18, 1); expect(turn).toBeCloseTo(20, 0)
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up()
    const after = await stickerState(page)
    expect(after.w).toBeCloseTo(before.w * scale, 0); expect(after.angle).toBeCloseTo(before.angle + turn, 0)
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2, 2); expect(after.y + after.w / 2).toBeCloseTo(before.y + before.w / 2, 2)
    await page.getByTestId('undo').click(); expect(await stickerState(page)).toEqual(before)
    await page.getByTestId('redo').click(); expect(await stickerState(page)).toEqual(after)
    const again = await stickerRingPoint(page, 60)
    await page.mouse.move(again.x, again.y); await page.mouse.down(); await page.mouse.move(again.x + 30, again.y + 40, { steps: 8 }); await page.keyboard.press('Escape'); await page.mouse.up()
    expect(await stickerState(page)).toEqual(after)
  }
})

test('personal packs and favorites refresh across two devices while placed stickers survive collection removal', async ({ page, request, browser }) => {
  await stickerBoard(page, request); await importFixturePack(page)
  await page.getByTestId('sticker-pick').first().click(); await page.getByRole('button', { name: 'Place at center', exact: true }).click()
  await openStickerTray(page); const tray = page.getByTestId('sticker-tray')
  await previewSticker(page); await tray.getByRole('button', { name: 'Favorite', exact: true }).click()
  await expect(tray.getByRole('button', { name: 'Unfavorite', exact: true })).toBeVisible()
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: await page.context().storageState() })
  try {
    const other = await ctx.newPage(); await other.goto(page.url()); await openStickerTray(other)
    const second = other.getByTestId('sticker-tray')
    await second.getByRole('button', { name: '★ Favorites', exact: true }).click(); await expect(second.getByTestId('sticker-pick')).toHaveCount(1)
    await previewSticker(other); await second.getByRole('button', { name: 'Unfavorite', exact: true }).click()
    await expect(second.getByRole('button', { name: 'Favorite', exact: true })).toBeVisible()
    await page.reload(); await openStickerTray(page); await tray.getByRole('button', { name: '★ Favorites', exact: true }).click()
    await expect(tray.getByRole('heading', { name: 'Keep your favorites here' })).toBeVisible()
    // With packs saved, the header's Add pack is the only one; the empty state points at the packs instead.
    await expect(tray.getByRole('button', { name: 'Add pack', exact: true })).toHaveCount(1)
    await second.getByTestId('sticker-preview-back').click(); await second.getByRole('button', { name: 'Doggy daydreams', exact: true }).click()
    await second.getByRole('button', { name: 'Remove Doggy daydreams', exact: true }).click(); await expect(second.getByRole('heading', { name: 'Make room for a little fun' })).toBeVisible()
    // Until the collection answers, the tray says it is loading rather than claiming there are no packs.
    let release!: () => void; const held = new Promise<void>((done) => { release = done })
    await page.route('**/api/stickers', async (route) => { await held; await route.continue() })
    await page.reload(); await openStickerTray(page)
    await expect(tray.getByRole('status').filter({ hasText: 'Loading your stickers…' })).toBeVisible()
    await expect(tray.getByRole('heading', { name: 'Make room for a little fun' })).toHaveCount(0)
    release(); await expect(tray.getByRole('heading', { name: 'Make room for a little fun' })).toBeVisible()
    await page.unroute('**/api/stickers')
    await expect(tray.getByRole('button', { name: 'Add pack', exact: true })).toHaveCount(2)
    await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
    await expect.poll(() => page.getByTestId('placed-sticker').locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  } finally { await ctx.close() }
})

test('an agent proposal that adds a sticker is labelled in review and drawn by the board preview', async ({ page, request }) => {
  const { id } = await stickerBoard(page, request); await importFixturePack(page)
  await page.getByRole('button', { name: 'Close stickers', exact: true }).click()
  const [existing] = await seedStickers(page, id, [{ x: 100, y: 100 }])
  await setCamera(page, { x: -24, y: -24, zoom: 1 })
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1); await waitForSync(page)
  const connection = await (await page.request.post('/api/agent-connections', { data: { name: 'Sticker helper', mode: 'propose', boardIds: [id] } })).json()
  const source = (await placedStickers(page, id)).find((s: { id: string }) => s.id === existing)
  const { id: _old, kind, boardId, w, angle, z, createdAt, content } = source
  const staged = await page.request.post('/api/agent/proposals', { headers: { authorization: `Bearer ${connection.token}` }, data: { idempotencyKey: `sticker-${crypto.randomUUID()}`, label: 'Add a second pup', operations: [{ action: 'create', object: { id: crypto.randomUUID(), kind, boardId, x: 320, y: 100, w, angle, z: z + 1, createdAt, content } }] } })
  expect(staged.status(), await staged.text()).toBe(201)
  await page.getByTestId('board-more').click(); await page.getByTestId('agent-proposals').click()
  await page.getByTestId('agent-review').getByRole('button', { name: /Add a second pup/ }).click()
  await expect(page.getByTestId('agent-change-list')).toContainText(`Sticker · ${content.emoji} ${content.packName}`)
  await page.getByTestId('preview-on-board').click()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(2)
  await page.getByTestId('proposal-exit').click()
  await expect(page.getByTestId('placed-sticker')).toHaveCount(1)
})
