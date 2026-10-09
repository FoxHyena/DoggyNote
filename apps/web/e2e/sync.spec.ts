import { expect, test, type Browser, type Page } from '@playwright/test'
import { AUTH_FILE } from '../playwright.config.ts'
import { MOD, addNote, cardByText, dragBy, freshBoard } from './helpers.ts'

/** A second signed-in device (its own IndexedDB) opened on the same URL. */
async function secondDevice(browser: Browser, url: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: AUTH_FILE })
  const page = await ctx.newPage()
  await page.goto(url)
  await expect(page.getByTestId('canvas')).toBeVisible()
  return page
}

const synced = (page: Page) => expect(page.getByTestId('sync-status')).toHaveText('Synced', { timeout: 10_000 })
/** Click the status to sync, and wait for that sync's pull to finish (the label may already say Synced). */
const syncNow = async (page: Page) => {
  const pulled = page.waitForResponse((r) => r.url().includes('/api/sync?since=') && r.request().method() === 'GET')
  await page.getByTestId('sync-status').click()
  await pulled
  await synced(page)
}

test.describe('sync between devices', () => {
  test('an edit on one device shows up on another', async ({ page, browser }) => {
    await freshBoard(page)
    await addNote(page, 'synced bone')
    await synced(page)

    const other = await secondDevice(browser, page.url())
    await expect(cardByText(other, 'synced bone')).toBeVisible()

    // Live: a later edit arrives on the next pull.
    await addNote(page, 'second bone', 0.3, 0.3)
    await synced(page)
    await syncNow(other)
    await expect(cardByText(other, 'second bone')).toBeVisible()
  })

  test('background polling picks up changes without a click', async ({ page, browser }) => {
    await freshBoard(page)
    await synced(page)
    const other = await secondDevice(browser, page.url())
    await addNote(page, 'polled in')
    await synced(page)
    await expect(cardByText(other, 'polled in')).toBeVisible({ timeout: 15_000 })
  })

  test('offline edits queue up and sync when the network returns', async ({ page, context, browser }) => {
    await freshBoard(page)
    await synced(page)
    await context.setOffline(true)
    await addNote(page, 'written offline')
    await expect(page.getByTestId('sync-status')).toContainText('Offline', { timeout: 10_000 })
    await expect(page.getByTestId('sync-status')).toContainText('waiting')

    await context.setOffline(false)
    await syncNow(page)
    const other = await secondDevice(browser, page.url())
    await expect(cardByText(other, 'written offline')).toBeVisible()
  })

  test('edits to different fields merge; the same field is last-write-wins', async ({ page, browser }) => {
    await freshBoard(page)
    const note = await addNote(page, 'shared note')
    await synced(page)
    const other = await secondDevice(browser, page.url())
    const otherNote = cardByText(other, 'shared note')
    await expect(otherNote).toBeVisible()

    // Different fields: B recolours while A rewrites the text.
    await dragBy(other, otherNote, 12, 0)
    await other.getByTestId('swatch-gold').click()
    await note.click()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type('edited by A')
    await page.keyboard.press('Escape')
    await synced(other)
    await synced(page)
    await syncNow(page)
    await syncNow(other)
    for (const p of [page, other]) {
      await expect(cardByText(p, 'edited by A')).toHaveClass(/colored/)
    }

    // Same field: the later push wins everywhere.
    await cardByText(page, 'edited by A').click()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type('A says hi')
    await page.keyboard.press('Escape')
    await expect(cardByText(page, 'A says hi')).toBeVisible()
    await synced(page)
    await syncNow(other)
    await expect(cardByText(other, 'A says hi')).toBeVisible()
    await cardByText(other, 'A says hi').click()
    await other.keyboard.press(`${MOD}+a`)
    await other.keyboard.type('B said it last')
    await other.keyboard.press('Escape')
    await expect(cardByText(other, 'B said it last')).toBeVisible()
    await synced(other)
    await syncNow(page)
    await expect(cardByText(page, 'B said it last')).toBeVisible()
    await expect(cardByText(page, 'A says hi')).toHaveCount(0)
  })

  test('images upload in four sizes and load on another device', async ({ page, browser, request }) => {
    await freshBoard(page)
    const png = await page.evaluate(async () => {
      const c = new OffscreenCanvas(900, 600)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#86b89f'
      ctx.fillRect(0, 0, 900, 600)
      const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
      let s = ''
      for (const b of buf) s += String.fromCharCode(b)
      return btoa(s)
    })
    await page.getByTestId('image-input').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await expect(page.getByTestId('card-image')).toHaveCount(1)
    await synced(page)

    const other = await secondDevice(browser, page.url())
    const img = other.getByTestId('card-image')
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)
    const src = (await img.getAttribute('src'))!
    const m = src.match(/\/api\/assets\/([0-9a-f-]{36})\//)
    expect(m, `remote image src: ${src}`).not.toBeNull()
    for (const size of ['thumb', 'small', 'medium', 'full']) {
      const res = await request.get(`/api/assets/${m![1]}/${size}`)
      expect(res.status(), size).toBe(200)
      expect(res.headers()['content-type']).toMatch(/^image\//)
      expect(res.headers()['cache-control']).toContain('immutable')
    }
  })
})

test.describe('auth', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('wrong password is refused; right one gets in; sign out returns to login', async ({ page }) => {
    await page.goto('/')
    const form = page.getByTestId('login-form')
    await form.getByLabel('Username').fill('rex')
    await form.getByLabel('Password').fill('badboy')
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByTestId('login-error')).toHaveText('Wrong username or password')

    await form.getByLabel('Password').fill('goodboy123')
    await form.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByTestId('canvas')).toBeVisible()
    await expect(page.getByTestId('account')).toContainText('rex')

    await page.getByTestId('account').click()
    await page.getByTestId('sign-out').click()
    await expect(page.getByTestId('login-form')).toBeVisible()
    // The session is really gone server-side.
    expect((await page.request.get('/api/me')).status()).toBe(401)
  })

  test('the API refuses writes without a session', async ({ request }) => {
    const res = await request.post('/api/sync', { data: { changes: [{ id: 'x', patch: { kind: 'card' } }] } })
    expect(res.status()).toBe(401)
    expect((await request.put('/api/assets/00000000-0000-4000-8000-000000000000/thumb', { data: 'x', headers: { 'content-type': 'image/png' } })).status()).toBe(401)
  })

  test('an admin adds a person who can then sign in; non-admins cannot manage people', async ({ page, browser }) => {
    const name = `pup${Math.random().toString(36).slice(2, 7)}`
    await page.goto('/')
    await page.getByLabel('Username').fill('rex')
    await page.getByLabel('Password').fill('goodboy123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByTestId('account').click()
    await page.getByTestId('manage-people').click()
    await page.getByTestId('new-username').fill(name)
    await page.getByTestId('new-password').fill('squeaky-toy')
    await page.getByTestId('add-person').click()
    await expect(page.getByTestId('people-dialog')).toContainText(name)

    const ctx = await browser.newContext()
    const p2 = await ctx.newPage()
    await p2.goto('/')
    await p2.getByLabel('Username').fill(name)
    await p2.getByLabel('Password').fill('squeaky-toy')
    await p2.getByRole('button', { name: 'Sign in' }).click()
    await expect(p2.getByTestId('canvas')).toBeVisible()
    await p2.getByTestId('account').click()
    await expect(p2.getByTestId('manage-people')).toHaveCount(0)
    expect((await p2.request.get('/api/users')).status()).toBe(403)
  })
})

test('a device with a stale cursor from another database re-pulls everything', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'survives a db swap')
  await synced(page)
  // Pretend this device last synced with a different database, far ahead.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('doggynote')
        req.onsuccess = () => {
          const tx = req.result.transaction(['meta', 'objects'], 'readwrite')
          tx.objectStore('meta').put('some-other-db', 'epoch')
          tx.objectStore('meta').put(999_999, 'cursor')
          tx.objectStore('objects').clear()
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await page.reload()
  await expect(cardByText(page, 'survives a db swap')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('crumb').first().click()
  await expect(page.getByTestId('board-name')).toHaveText('Doghouse')
})
