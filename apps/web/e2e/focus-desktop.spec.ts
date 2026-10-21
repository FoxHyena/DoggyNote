import { expect, test, type Page } from '@playwright/test'
import { MOD, addNote, freshBoard, waitForSync } from './helpers.ts'
import { DESKTOP_PORT } from './ports.ts'

// Boundary simulation only: the real app, IndexedDB and Worker still run.
// This cannot replace testing the Rust close handler in a fresh Mac bundle.
type NativeExit = { ready: boolean; decisions: boolean[]; emitClose: () => void }
const nativeExit = (page: Page) => page.evaluate(() => (window as unknown as { __focusNativeExit: NativeExit }).__focusNativeExit.decisions)

test.use({ storageState: { cookies: [], origins: [] }, baseURL: `http://localhost:${DESKTOP_PORT}` })
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const callbacks = new Map<number, (event: unknown) => void>()
    const listeners = new Map<number, { event: string; handler: number }>()
    let sequence = 0
    const exit: NativeExit = {
      ready: false, decisions: [],
      emitClose: () => {
        for (const [id, listener] of listeners) if (listener.event === 'save-before-exit') callbacks.get(listener.handler)?.({ event: listener.event, id, payload: null })
      },
    }
    w.__focusNativeExit = exit
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => listeners.delete(id) }
    w.__TAURI_INTERNALS__ = {
      transformCallback: (fn: (event: unknown) => void) => { const id = ++sequence; callbacks.set(id, fn); return id },
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'get_token') return sessionStorage.getItem('fake-keychain')
        if (command === 'set_token') { sessionStorage.setItem('fake-keychain', String(args?.token)); return null }
        if (command === 'clear_token') { sessionStorage.removeItem('fake-keychain'); return null }
        if (command === 'plugin:updater|check') return null
        if (command === 'haptic' || command === 'plugin:opener|open_url') return null
        if (command === 'plugin:event|listen') {
          const id = ++sequence
          listeners.set(id, { event: String(args?.event), handler: Number(args?.handler) })
          return id
        }
        if (command === 'plugin:event|unlisten') { listeners.delete(Number(args?.eventId)); return null }
        if (command === 'exit_save_ready') { exit.ready = true; return null }
        if (command === 'finish_exit_save') { exit.decisions.push(args?.allow === true); return null }
        throw new Error(`Unexpected focused-exit command: ${command}`)
      },
    }
  })
  await page.goto('/')
  await page.getByLabel('Username').fill('rex')
  await page.getByLabel('Password').fill('goodboy123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await freshBoard(page, `Focused native exit ${crypto.randomUUID().slice(0, 6)}`)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __focusNativeExit: NativeExit }).__focusNativeExit.ready)).toBe(true)
})

async function startFocusedNote(page: Page) {
  const card = await addNote(page, 'Research before closing')
  const id = (await card.getAttribute('data-card-id'))!
  await waitForSync(page)
  await page.getByTestId('focus-note').click()
  await expect(page.getByTestId('focus-surface').getByTestId('note-editor')).toBeFocused()
  await page.keyboard.press(`${MOD}+End`)
  return id
}

async function requestClose(page: Page) {
  await page.evaluate(() => (window as unknown as { __focusNativeExit: NativeExit }).__focusNativeExit.emitClose())
}

async function locallySaved(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const open = indexedDB.open('doggynote')
    return new Promise<string>((resolve, reject) => {
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const read = db.transaction('objects').objectStore('objects').get(id)
        read.onsuccess = () => { db.close(); resolve(read.result?.content?.md ?? '') }
        read.onerror = () => { db.close(); reject(read.error) }
      }
    })
  }, id)
}

test('focused desktop exit saves the last active character offline before allowing quit', async ({ page, context }) => {
  const id = await startFocusedNote(page)
  const text = 'Research before closing — final character ✓'
  await context.setOffline(true)
  try {
    await page.keyboard.insertText(' — final character ✓')
    await requestClose(page)
    await expect.poll(() => nativeExit(page)).toEqual([true])
    await expect(page.getByTestId('focus-surface')).toHaveCount(0)
    expect(await locallySaved(page, id)).toBe(text)
  } finally { await context.setOffline(false) }
  await page.reload()
  await expect(page.locator(`[data-card-id="${id}"]`)).toHaveText(text)
  await expect(page.getByTestId('card')).toHaveCount(1)
  await waitForSync(page)
})

test('focused desktop exit keeps active text when local saving fails, then retries safely', async ({ page }) => {
  const id = await startFocusedNote(page)
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction
    ;(window as unknown as { denyFocusSave: boolean }).denyFocusSave = true
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const transaction = original.apply(this, args)
      if ((window as unknown as { denyFocusSave: boolean }).denyFocusSave && args[1] === 'readwrite' && Array.isArray(args[0]) && args[0].includes('objects') && args[0].includes('outbox')) queueMicrotask(() => transaction.abort())
      return transaction
    }
  })
  await page.keyboard.insertText(' — unsaved final text')
  await requestClose(page)
  const alert = page.getByRole('alertdialog', { name: 'Your latest changes need saving' })
  await expect(alert).toBeVisible()
  expect(await nativeExit(page)).toEqual([])
  await alert.getByRole('button', { name: 'Keep working', exact: true }).click()
  await expect(alert).toHaveCount(0)
  await expect.poll(() => nativeExit(page)).toEqual([false])
  await expect(page.locator(`[data-card-id="${id}"]`)).toContainText('unsaved final text')
  await page.locator(`[data-card-id="${id}"]`).click()
  await page.getByTestId('focus-note').click()
  await expect(page.getByTestId('focus-surface').getByTestId('note-editor')).toBeFocused()
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.insertText(' continued')
  await requestClose(page)
  await expect(alert).toBeVisible()
  expect(await nativeExit(page)).toEqual([false])
  await page.evaluate(() => { (window as unknown as { denyFocusSave: boolean }).denyFocusSave = false })
  await alert.getByRole('button', { name: 'Retry saving and quit', exact: true }).click()
  await expect.poll(() => nativeExit(page)).toEqual([false, true])
  const text = 'Research before closing — unsaved final text continued'
  expect(await locallySaved(page, id)).toBe(text)
  await page.reload()
  await expect(page.locator(`[data-card-id="${id}"]`)).toHaveText(text)
  await expect(page.getByTestId('card')).toHaveCount(1)
})
