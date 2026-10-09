import { expect, test } from '@playwright/test'
import { addNote, cardByText, freshBoard } from './helpers.ts'
import { API_PORT } from './ports.ts'

// The desktop app's code path: no cookies, a bearer token kept by the native
// side (Keychain), API calls cross-origin to the server. We stand in for the
// Tauri bridge with an in-page fake that records what the app stores.

test.use({ storageState: { cookies: [], origins: [] }, baseURL: 'http://localhost:4174' })

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
        if (cmd.startsWith('plugin:updater|') || cmd.startsWith('plugin:process|') || cmd === 'haptic') keychain.calls.push(cmd)
        // A test sets this to pretend the server has a newer desktop release.
        const offered = sessionStorage.getItem('fake-update')
        if (cmd === 'plugin:updater|check')
          return offered ? { rid: 1, currentVersion: '0.0.1', version: offered, date: null, body: 'notes', rawJson: {} } : null
        if (cmd === 'plugin:updater|download') return 2
        if (cmd === 'plugin:updater|install' || cmd === 'plugin:process|restart' || cmd === 'plugin:resources|close' || cmd === 'haptic') return null
        if (cmd === 'get_token') return keychain.token
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
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })

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
  await expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
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
