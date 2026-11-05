import { chromium, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CLIPPER_EXTENSION_ID, CLIPPER_REDIRECT } from '@doggynote/core'
import { WEB_PORT } from '../../web/e2e/ports.ts'

// A real MV3 service worker, content script, extension page, and local Worker.
test('hover, capture, choose a board, save, restart, and open the board Inbox', async () => {
  const profile = await mkdtemp(resolve(tmpdir(), 'doggynote-clipper-'))
  const extension = resolve('dist'), base = `http://localhost:${WEB_PORT}`
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
  const bytes = await readFile('../web/public/icons/icon-192.png')
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  let blocked = false, oversized = false
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store')
    if (blocked && req.url?.endsWith('.png')) { res.writeHead(403); res.end('Image unavailable'); return }
    if (req.url?.endsWith('.gif')) { res.setHeader('content-type', 'image/gif'); res.end(gif); return }
    res.setHeader('content-type', req.url?.endsWith('.png') ? 'image/png' : 'text/html')
    if (oversized && req.url === '/oversized.png') res.setHeader('content-length', 16 * 1024 * 1024)
    res.end(req.url?.endsWith('.png') ? bytes : '<title>Reference image</title><style>body{margin:60px}#art{width:360px;height:360px}</style><picture><source srcset="/responsive.png"><img id="art" src="/dog.png"></picture><img width="24" height="24" src="/dog.png">')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const sourceBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
    expect(new URL(worker.url()).hostname).toBe(CLIPPER_EXTENSION_ID)
    const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'rex', password: 'goodboy123' } }); expect(login.ok()).toBe(true)
    const boardId = crypto.randomUUID(), parentId = crypto.randomUUID(), duplicateId = crypto.randomUUID(), title = 'Chrome clip collection'
    const boards = [
      { id: boardId, parentId: 'home', title },
      { id: parentId, parentId: 'home', title: 'Other references' },
      { id: duplicateId, parentId, title },
    ]
    expect((await context.request.post(`${base}/api/sync`, { headers: { 'x-doggynote-protocol': '4' }, data: { changes: boards.map((board) => ({ id: board.id, patch: { ...board, kind: 'board', icon: 'paw', color: 'none', createdAt: Date.now() } })) } })).ok()).toBe(true)
    const verifier = 'a'.repeat(43), challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
    const approved = await context.request.post(`${base}/api/clipper/authorize`, { data: { challenge, state: 'b'.repeat(43), redirectUri: CLIPPER_REDIRECT } })
    const code = new URL((await approved.json()).redirect).searchParams.get('code')
    const connected = await context.request.post(`${base}/api/clipper/exchange`, { data: { code, verifier, redirectUri: CLIPPER_REDIRECT } })
    const connection = await connected.json()
    await worker.evaluate(async (connection) => { await chrome.storage.local.set({ connection }) }, connection)

    const source = await context.newPage()
    await source.goto(`${sourceBase}/art`)
    await source.locator('img').last().hover()
    await expect(source.locator('[data-doggynote-clipper]')).toBeHidden()
    await source.locator('#art').hover()
    const overlay = source.locator('[data-doggynote-clipper]')
    await expect(overlay).toBeVisible()
    const r = await overlay.boundingBox()
    await source.mouse.click(r!.x + 35, r!.y + 18)
    const panel = await context.newPage()
    await panel.setViewportSize({ width: 360, height: 800 })
    await panel.goto(`chrome-extension://${CLIPPER_EXTENSION_ID}/sidepanel.html`)
    await expect(panel.locator('.preview')).toBeVisible()
    expect(await source.locator('#art').evaluate((el: HTMLImageElement) => el.currentSrc)).toBe(`${sourceBase}/responsive.png`)
    expect(await panel.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'state' })).value.capture.source.imageUrl)).toBe(`${sourceBase}/responsive.png`)
    await expect(panel.getByLabel('Save to board', { exact: true }).locator(`option[value="${duplicateId}"]`)).toContainText(`Other references / ${title}`)
    await panel.getByLabel('Save to board', { exact: true }).selectOption(boardId)
    await panel.screenshot({ path: 'test-results/clipper-preview.png' })
    await panel.getByRole('button', { name: `Save to ${title}`, exact: true }).click()
    await expect(panel.locator('.saved')).toContainText(`Saved to ${title}`)
    console.info('Clipper: initial capture saved')
    await panel.screenshot({ path: 'test-results/clipper-saved.png' })
    const destination = await context.newPage()
    await destination.goto(`${base}/?boardInbox=${boardId}`)
    await expect(destination.getByTestId('board-inbox-item')).toHaveCount(1)
    await panel.reload()
    await expect(panel.locator('.saved')).toContainText(`Saved to ${title}`)
    // Simulate a worker stopping after commit but before its acknowledgement was stored.
    await panel.evaluate(async () => {
      const request = indexedDB.open('doggynote-clipper', 1)
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      await new Promise<void>((resolve) => {
        const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts'), read = store.get('current')
        read.onsuccess = () => { const draft = read.result; draft.capture.status = 'saving'; store.put(draft, 'current') }
        tx.oncomplete = () => resolve()
      })
      db.close()
    })
    const devtools = await context.newCDPSession(panel)
    await devtools.send('ServiceWorker.enable')
    await devtools.send('ServiceWorker.stopAllWorkers')
    await devtools.detach()
    await panel.reload()
    await panel.getByRole('button', { name: 'Resume interrupted save' }).click()
    await expect(panel.locator('.saved')).toContainText(`Saved to ${title}`)
    expect((await (await context.request.get(`${base}/api/boards/${boardId}/inbox`)).json()).count).toBe(1)
    console.info('Clipper: worker restart resumed without duplicates')
    await expect(destination.getByTestId('card-image')).toHaveCount(0)
    await destination.getByTestId('board-inbox-item').getByRole('button', { name: 'Place', exact: true }).click()
    await expect(destination.getByTestId('card-image')).toHaveCount(1)
    await expect(destination.getByTestId('image-source')).toHaveAttribute('href', `${sourceBase}/art`)
    console.info('Clipper: saved image placed on the canvas')
    // Delegated hover detection also handles images appended by an infinite feed.
    await source.evaluate(() => {
      const img = document.createElement('img'); img.id = 'dynamic-art'; img.src = '/dog.png'; img.style.cssText = 'display:block;width:280px;height:280px;margin-top:1000px'
      document.body.append(img)
    })
    await source.locator('#dynamic-art').hover()
    await expect(overlay).toBeVisible()
    blocked = true
    const secondButton = await overlay.boundingBox()
    await source.mouse.click(secondButton!.x + 35, secondButton!.y + 18)
    console.info('Clipper: blocked-source capture selected')
    await expect(panel.getByRole('alert')).toContainText('source site would not provide')
    blocked = false
    await panel.getByRole('button', { name: 'Retry image download' }).click()
    await expect(panel.locator('.preview')).toBeVisible()
    await expect(panel.getByLabel('Save to board', { exact: true })).toHaveValue(boardId)
    console.info('Clipper: blocked-source download retried')
    // Interrupt an actual upload while board discovery remains available. Going
    // offline first can correctly disable Save during a concurrent board refresh.
    const interruptedUpload = `${base}/api/clipper/assets/*/medium`
    await context.route(interruptedUpload, (route) => route.abort('internetdisconnected'))
    await panel.getByRole('button', { name: `Save to ${title}`, exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('Cannot reach DoggyNote')
    await context.unroute(interruptedUpload)
    // Exercise manual board retry without an online event automatically healing
    // the panel before the click. Global offline recovery is checked separately.
    const unavailableBoards = `${base}/api/clipper/boards`
    await context.route(unavailableBoards, (route) => route.abort('internetdisconnected'))
    await panel.reload()
    await expect(panel.locator('.preview')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Retry boards' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Save to board', exact: true })).toBeDisabled()
    await context.unroute(unavailableBoards)
    await panel.getByRole('button', { name: 'Retry boards' }).click()
    await expect(panel.getByRole('button', { name: `Save to ${title}`, exact: true })).toBeEnabled()
    await context.setOffline(true)
    await panel.reload()
    await expect(panel.locator('.preview')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Retry boards' })).toBeVisible()
    await panel.screenshot({ path: '../web/.impeccable/review/clipper/clipper-offline.png', animations: 'disabled' })
    await context.setOffline(false)
    await expect(panel.getByRole('button', { name: `Save to ${title}`, exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: `Save to ${title}`, exact: true }).click()
    await expect(panel.locator('.saved')).toContainText(`Saved to ${title}`)
    console.info('Clipper: offline capture recovered')
    await source.evaluate(() => {
      const img = document.createElement('img'); img.id = 'gif-art'; img.src = '/dog.gif'; img.style.cssText = 'display:block;width:280px;height:280px'
      document.body.append(img)
    })
    await expect.poll(() => source.locator('#gif-art').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)
    await source.locator('#gif-art').hover()
    const gifButton = await overlay.boundingBox()
    await source.mouse.click(gifButton!.x + 35, gifButton!.y + 18)
    await expect(panel.getByRole('button', { name: `Save to ${title}`, exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: `Save to ${title}`, exact: true }).click()
    await expect(panel.locator('.saved')).toContainText(`Saved to ${title}`)
    const inbox = await (await context.request.get(`${base}/api/boards/${boardId}/inbox`)).json()
    const savedGif = inbox.items.find((item: { source: { imageUrl: string } }) => item.source.imageUrl.endsWith('.gif'))
    const original = await context.request.get(`${base}/api/assets/${savedGif.image.assetId}/full`)
    expect(original.headers()['content-type']).toBe('image/gif')
    expect(await original.body()).toEqual(gif)
    expect((await context.request.get(`${base}/api/clipper/boards`, { headers: { authorization: `Bearer ${connection.token}` } })).ok()).toBe(true)
    await source.evaluate(() => {
      const img = document.createElement('img'); img.id = 'oversized-art'; img.src = '/oversized.png'; img.style.cssText = 'display:block;width:280px;height:280px'
      document.body.append(img)
    })
    await expect.poll(() => source.locator('#oversized-art').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    await source.locator('#oversized-art').hover()
    oversized = true
    const oversizedButton = await overlay.boundingBox()
    await source.mouse.click(oversizedButton!.x + 35, oversizedButton!.y + 18)
    await expect(panel.getByRole('alert')).toContainText('15 MB image limit')
    await expect(panel.getByRole('button', { name: 'Retry image download' })).toBeVisible()
    console.info('Clipper: oversized download rejected; capture flow complete')
  } catch (error) {
    console.error('Clipper capture failed before cleanup:', error)
    throw error
  } finally {
    console.info('Clipper: closing test context')
    await context.close()
    console.info('Clipper: closing fixture server')
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })
    await rm(profile, { recursive: true, force: true })
  }
})

test('connects through DoggyNote sign-in and explicit approval', async () => {
  const profile = await mkdtemp(resolve(tmpdir(), 'doggynote-approval-')), extension = resolve('dist')
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
  try {
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${CLIPPER_EXTENSION_ID}/sidepanel.html`)
    const popup = context.waitForEvent('page')
    await panel.getByRole('button', { name: 'Connect DoggyNote', exact: true }).click()
    const consent = await popup
    await consent.waitForURL(`http://localhost:${WEB_PORT}/clipper/connect**`)
    await consent.getByLabel('Username').fill('rex')
    await consent.getByLabel('Password').fill('goodboy123')
    await consent.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(consent.getByRole('heading', { name: 'Connect Chrome to DoggyNote' })).toBeVisible()
    await consent.getByRole('button', { name: 'Connect Chrome', exact: true }).click()
    await expect(panel.getByText('Connected as rex', { exact: true })).toBeVisible()
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }) }
})
