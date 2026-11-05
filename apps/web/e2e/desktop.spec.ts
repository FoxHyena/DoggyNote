import { editProfile } from './profile-checks.ts'
import { waitForSync } from './helpers.ts'
import { expect, test } from '@playwright/test'
import { addNote, cardByText, freshBoard } from './helpers.ts'
import { API_PORT, DESKTOP_PORT } from './ports.ts'
import { openStickerTray } from './sticker-helpers.ts'
import { openPhoto } from './avatar-checks.ts'
import { captureBoardImage } from './clipper-helpers.ts'

// The desktop app's code path: no cookies, a bearer token kept by the native
// side (Keychain), API calls cross-origin to the server. We stand in for the
// Tauri bridge with an in-page fake that records what the app stores.

test.use({ storageState: { cookies: [], origins: [] }, baseURL: `http://localhost:${DESKTOP_PORT}` })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const keychain: { token: string | null; opened: string[]; calls: string[] } = { token: sessionStorage.getItem('fake-keychain'), opened: [], calls: [] }
    w.__fakeKeychain = keychain
    let cb = 0
    w.__TAURI_INTERNALS__ = {
      transformCallback: (fn: unknown) => {
        const id = ++cb
        w[`_${id}`] = fn
        return id
      },
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd.startsWith('plugin:updater|') || cmd.startsWith('plugin:process|') || cmd.startsWith('plugin:window|') || cmd === 'haptic') keychain.calls.push(cmd)
        // A test sets this to pretend the server has a newer desktop release.
        const offered = sessionStorage.getItem('fake-update')
        if (cmd === 'plugin:updater|check')
          return offered ? { rid: 1, currentVersion: '0.0.1', version: offered, date: null, body: 'notes', rawJson: {} } : null
        if (cmd === 'plugin:updater|download') return 2
        if (cmd === 'plugin:updater|install' || cmd === 'plugin:process|restart' || cmd === 'plugin:resources|close' || cmd === 'plugin:window|start_dragging' || cmd === 'haptic') return null
        if (cmd === 'get_token') return keychain.token
        // This fixture has no provider children; session lifecycle still calls
        // the native execution barrier before removing or replacing credentials.
        if (cmd === 'chat_stop_all' || cmd === 'chat_begin_session') return null
        if (cmd === 'set_token') {
          keychain.token = String(args?.token)
          sessionStorage.setItem('fake-keychain', keychain.token)
          return null
        }
        if (cmd === 'clear_token') {
          keychain.token = null
          sessionStorage.removeItem('fake-keychain')
          return null
        }
        if (cmd === 'plugin:opener|open_url') {
          keychain.opened.push(String(args?.url))
          return null
        }
        throw new Error(`unexpected command ${cmd}`)
      },
    }
  })
})

test('desktop: profile photo saves cross-origin and loads with a session-bound image token', async ({ page, context, request }) => {
  const base = `http://localhost:${API_PORT}`
  const login = await request.post(`${base}/api/auth/login`, { data: { username: 'rex', password: 'goodboy123', bearer: true } })
  const { token } = await login.json() as { token: string }
  const username = `avatar-${crypto.randomUUID().slice(0, 12)}`
  expect((await request.post(`${base}/api/users`, { headers: { authorization: `Bearer ${token}` }, data: { username, password: 'phototest123' } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill('phototest123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await openPhoto(page)
  await page.getByRole('button', { name: 'Save photo', exact: true }).click()
  const avatar = page.getByTestId('account').locator('img')
  await expect(avatar).toBeVisible()
  await expect(avatar).toHaveAttribute('src', /\/api\/avatars\/.*\?t=/)
  expect((await context.cookies()).filter((c) => c.name === 'dn_session')).toHaveLength(0)
  await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(512)
  await page.reload()
  await expect(avatar).toBeVisible()
})

test('desktop: sign in with a Keychain token, sync cross-origin, open links in the browser', async ({ page, context }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/tauri/)

  // The token went to the "Keychain", and no session cookie exists.
  expect(await page.evaluate(() => (window as unknown as { __fakeKeychain: { token: string } }).__fakeKeychain.token)).toMatch(/^[A-Za-z0-9_-]{40,}$/)
  expect((await context.cookies()).filter((c) => c.name === 'dn_session')).toHaveLength(0)

  // Requests carry the bearer token and succeed cross-origin.
  const authed = page.waitForRequest((r) => r.url().startsWith(`http://localhost:${API_PORT}/api/sync`) && !!r.headers()['authorization'])
  await freshBoard(page)
  await addNote(page, 'from the desktop')
  await authed
  await waitForSync(page)

  await page.getByTestId('collaborators').click()
  await expect(page.getByTestId('live-status')).toHaveText('Live')
  await page.keyboard.press('Escape')

  // Relaunch: still signed in from the Keychain.
  await page.reload()
  await expect(cardByText(page, 'from the desktop')).toBeVisible()

  // Share links point at the server, not tauri://.
  await page.getByTestId('share').click()
  await page.getByTestId('create-share').click()
  await expect(page.getByTestId('share-url').first()).toHaveValue(new RegExp(`^http://localhost:${API_PORT}/s/`))

  // External links go to the system browser.
  await page.evaluate(() => {
    const a = document.createElement('a')
    a.href = 'https://example.com/bone'
    a.target = '_blank'
    a.textContent = 'x'
    document.body.append(a)
    a.click()
  })
  expect(await page.evaluate(() => (window as unknown as { __fakeKeychain: { opened: string[] } }).__fakeKeychain.opened)).toEqual(['https://example.com/bone'])

  // Sign out clears the Keychain.
  await page.getByTestId('share').click()
  await page.getByTestId('account').click()
  await page.getByTestId('sign-out').click()
  await expect(page.getByTestId('login-form')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __fakeKeychain: { token: string | null } }).__fakeKeychain.token)).toBeNull()
})

test('desktop: zoomed-out overview draws image thumbnails loaded cross-origin', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await freshBoard(page)
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#e8a849'
    ctx.fillRect(0, 0, 400, 300)
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const b of buf) s += String.fromCharCode(b)
    return btoa(s)
  })
  await page.getByTestId('image-input').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByTestId('card-image')).toHaveCount(1)
  await waitForSync(page)
  // Drop the local copy so the thumbnail must come from the server, cross-origin.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('doggynote')
        req.onsuccess = () => {
          const tx = req.result.transaction('assets', 'readwrite')
          tx.objectStore('assets').clear()
          tx.oncomplete = () => resolve()
        }
      }),
  )
  await page.reload()
  await expect(page.getByTestId('card-image')).toHaveCount(1)
  const box = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 80)
  await page.keyboard.up('Control')
  await expect(page.getByTestId('lod-layer')).toBeVisible()
  await expect
    .poll(() =>
      page.getByTestId('lod-layer').evaluate((c: HTMLCanvasElement) => {
        try {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
          let hits = 0
          for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0xe8) < 14 && Math.abs(d[i + 1] - 0xa8) < 14 && Math.abs(d[i + 2] - 0x49) < 14) hits++
          return hits
        } catch (e) {
          return `getImageData failed: ${e}`
        }
      }),
    )
    .toBeGreaterThan(20)
  await page.waitForTimeout(500)
  await expect(page.getByTestId('lod-layer')).toHaveAttribute('data-thumbs', '1')
})

test('desktop: static sticker outlines load cross-origin with an asset token and survive overview zoom', async ({ page, context }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await freshBoard(page)
  await openStickerTray(page)
  const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByLabel('Pack link or short name').fill('DoggyFixture')
  const imageRequest = page.waitForRequest((r) => r.url().includes('/api/assets/') && r.url().includes('/thumb?t='))
  await tray.getByRole('button', { name: 'Preview pack', exact: true }).click()
  const image = tray.getByTestId('sticker-pick').first().locator('img')
  await expect(image).toHaveAttribute('src', /^blob:/)
  expect((await imageRequest).url()).toMatch(new RegExp(`^http://localhost:${API_PORT}/api/assets/`))
  expect((await context.cookies()).filter((c) => c.name === 'dn_session')).toHaveLength(0)
  await tray.getByRole('button', { name: /^(Add pack|Open pack)$/ }).click()
  await expect(tray.locator('.sticker-pack-title')).toContainText('Doggy daydreams')
  await tray.getByTestId('sticker-pick').first().focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Place at center', exact: true }).click()
  await expect(page.getByTestId('placed-sticker').locator('img')).toHaveAttribute('src', /^blob:/)
  await waitForSync(page)
  const box = (await page.getByTestId('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 80)
  await page.keyboard.up('Control')
  await expect(page.getByTestId('lod-layer')).toHaveAttribute('data-thumbs', '1')
  await expect(page.getByRole('button', { name: 'Zoom: 10%', exact: true })).toBeVisible()
  await page.getByTestId('zoom').click()
  await page.getByRole('button', { name: 'Zoom to 100% ⌘0', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Zoom: 100%', exact: true })).toBeVisible()
  await expect(page.getByTestId('placed-sticker').locator('img')).toHaveAttribute('src', /^blob:/)
})

test('desktop: a newer release downloads in the background, then restarts on request', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fake-update', '0.1.50'))
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const toast = page.getByTestId('update-toast')
  await expect(toast).toContainText('A fresh bone is ready')
  await expect(toast).toContainText('v0.1.50')
  await page.getByTestId('apply-update').click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __fakeKeychain: { calls: string[] } }).__fakeKeychain.calls))
    .toEqual(['plugin:updater|check', 'plugin:updater|download', 'plugin:updater|install', 'plugin:process|restart'])
})

test('desktop: coming back to a long-open app finds a release published since launch', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeKeychain: { calls: string[] } }).__fakeKeychain.calls)).toContain('plugin:updater|check')
  await page.evaluate(() => sessionStorage.setItem('fake-update', '0.1.51'))
  // macOS suspended the app's timers while it sat in the background; only the clock moved on.
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 10 * 60_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('update-toast')).toContainText('v0.1.51')
})

test('desktop: snapping across grid points taps the trackpad haptic', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await freshBoard(page)
  await page.getByTestId('snap-toggle').click()
  const note = await addNote(page, 'buzzy pup', 0.4, 0.4)
  await page.mouse.click(5, 5) // deselect via the canvas edge
  const b = (await note.boundingBox())!
  await page.mouse.move(b.x + 30, b.y + 12)
  await page.mouse.down()
  // Human speed: ticks are throttled so a fast fling doesn't buzz continuously.
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(b.x + 30 + i * 20, b.y + 12, { steps: 2 })
    await page.waitForTimeout(60)
  }
  await page.mouse.up()
  const calls = await page.evaluate(() => (window as unknown as { __fakeKeychain: { calls: string[] } }).__fakeKeychain.calls)
  expect(calls.filter((c) => c === 'haptic').length).toBeGreaterThanOrEqual(3)
})

test('desktop: an update waits for durable local text and explains a failed save', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fake-update', '0.1.50'))
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await freshBoard(page)
  const note = await addNote(page, 'Before updating')
  await waitForSync(page)
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction
    ;(window as unknown as { denyLocalSave: boolean }).denyLocalSave = true
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const transaction = original.apply(this, args)
      if ((window as unknown as { denyLocalSave: boolean }).denyLocalSave && args[1] === 'readwrite' && Array.isArray(args[0]) && args[0].includes('objects') && args[0].includes('outbox')) queueMicrotask(() => transaction.abort())
      return transaction
    }
  })
  await note.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Text preserved before restart')
  await page.getByTestId('apply-update').click()
  await expect(page.getByRole('alert')).toContainText('Could not save your changes')
  expect(await page.evaluate(() => (window as unknown as { __fakeKeychain: { calls: string[] } }).__fakeKeychain.calls)).not.toContain('plugin:updater|install')
  await page.evaluate(() => { (window as unknown as { denyLocalSave: boolean }).denyLocalSave = false })
  await page.getByTestId('apply-update').click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __fakeKeychain: { calls: string[] } }).__fakeKeychain.calls)).toContain('plugin:process|restart')
  await page.reload()
  await expect(cardByText(page, 'Text preserved before restart')).toBeVisible()
})

test('desktop: upload a file cross-origin; the download opens in the browser with a file token', async ({ page, request }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await freshBoard(page)
  const name = `desk-${Math.random().toString(36).slice(2, 7)}.zip`
  const bytes = Buffer.from('zip-ish bytes from the desktop')
  await page.getByTestId('upload-input').setInputFiles({ name, mimeType: 'application/zip', buffer: bytes })
  const link = cardByText(page, name).getByTestId('file-download')
  await expect(link).toBeVisible({ timeout: 15_000 })
  await link.click()
  const opened = await page.evaluate(() => (window as unknown as { __fakeKeychain: { opened: string[] } }).__fakeKeychain.opened)
  const url = opened.find((u) => u.includes('/api/files/'))!
  expect(url).toMatch(new RegExp(`^http://localhost:${API_PORT}/api/files/[0-9a-f-]+\\?t=`))
  // The system browser has no session: the token alone gets the bytes.
  const res = await request.get(url, { headers: { cookie: '' } })
  expect(res.status()).toBe(200)
  expect(Buffer.compare(await res.body(), bytes)).toBe(0)
})


test('desktop: profile name saves cross-origin with a bearer token and survives reload', async ({ page, context, request }) => {
  const base = `http://localhost:${API_PORT}`
  const login = await request.post(`${base}/api/auth/login`, { data: { username: 'rex', password: 'goodboy123', bearer: true } })
  const { token } = await login.json()
  const username = `profile-${crypto.randomUUID().slice(0, 12)}`
  expect((await request.post(`${base}/api/users`, { headers: { authorization: `Bearer ${token}` }, data: { username, password: 'profiletest123' } })).ok()).toBe(true)
  await page.goto('/')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill('profiletest123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await editProfile(page)
  await page.getByLabel('Display name', { exact: true }).fill('Desktop Pup 🐾')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.account-menu-identity strong')).toHaveText('Desktop Pup 🐾')
  expect((await context.cookies()).filter(c => c.name === 'dn_session')).toHaveLength(0)
  await page.reload()
  await page.getByTestId('account').click()
  await expect(page.locator('.account-menu-identity strong')).toHaveText('Desktop Pup 🐾')
})

test('desktop: the empty top bar drags the window, its buttons still click', async ({ page }) => {
  // Tauri's drag script (crates/tauri/src/window/scripts/drag.js, 2.12): a bare
  // data-tauri-drag-region only answers mousedowns on that very element, and a
  // clickable element without the attribute blocks dragging.
  await page.addInitScript(() => {
    const clickable = (el: HTMLElement) => ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY'].includes(el.tagName)
      || (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
      || (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
      || ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option'].includes(el.getAttribute('role') ?? '')
    document.addEventListener('mousedown', (e) => {
      const path = e.composedPath()
      for (const el of path) {
        if (!(el instanceof HTMLElement)) continue
        const attr = el.getAttribute('data-tauri-drag-region')
        if (clickable(el) && attr === null) return
        if (attr === null) continue
        if (attr === 'false') return
        if (attr === 'deep' || el === path[0]) void (window as unknown as { __TAURI_INTERNALS__: { invoke(cmd: string): Promise<unknown> } }).__TAURI_INTERNALS__.invoke('plugin:window|start_dragging')
        return
      }
    })
  })
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await freshBoard(page)
  const drags = () => page.evaluate(() => (window as unknown as { __fakeKeychain: { calls: string[] } }).__fakeKeychain.calls.filter((c) => c === 'plugin:window|start_dragging').length)

  // Top centre, and either end of the empty stretch between the board heading and the toolbar.
  const bar = (await page.locator('header.topbar').boundingBox())!
  const name = (await page.getByTestId('board-name').boundingBox())!
  const [from, to] = await page.evaluate(() => [
    Math.max(...[...document.querySelectorAll('.board-heading > *')].map((el) => el.getBoundingClientRect().right)),
    Math.min(...[...document.querySelectorAll('.topbar-right > *')].map((el) => el.getBoundingClientRect().left)),
  ])
  expect(to - from).toBeGreaterThan(100)
  const y = name.y + name.height / 2
  for (const x of [bar.x + bar.width / 2, from + 10, to - 10]) {
    const before = await drags()
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.up()
    expect(await drags(), `drag at x=${Math.round(x)}`).toBe(before + 1)
  }

  // The board name is a button: it renames, it doesn't drag.
  const before = await drags()
  await page.getByTestId('board-name').click()
  await expect(page.getByTestId('board-name-input')).toBeVisible()
  expect(await drags()).toBe(before)
})

test('desktop: clipped images load in the board Inbox with signed asset URLs', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await freshBoard(page, 'Desktop clip collection')
  const boardId = new URL(page.url()).hash.split('/b/')[1]
  const token = await page.evaluate(() => sessionStorage.getItem('fake-keychain'))
  await captureBoardImage(page.request, boardId, { sessionToken: token!, apiBase: `http://localhost:${API_PORT}` })
  await page.goto(`/?boardInbox=${boardId}`)
  const item = page.getByTestId('board-inbox-item')
  await expect(item).toBeVisible()
  await expect(item.locator('img')).toHaveAttribute('src', /\?t=/)
  await expect.poll(() => item.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  await item.getByRole('button', { name: 'Place', exact: true }).click()
  await expect(item).toHaveCount(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByTestId('card-image')).toHaveCount(1)
  await expect.poll(() => page.getByTestId('card-image').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
})
