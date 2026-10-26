import { runCardAction } from './helpers.ts'
import { openParentBoard } from './helpers.ts'
import { expect, test } from '@playwright/test'
import { MOD, addNote, cardByText, freshBoard, waitForSync } from './helpers.ts'

test('board selection, explicit rename and double-click opening never create a note', async ({ page }) => {
  await freshBoard(page, 'Interaction QA')
  await page.getByTestId('tool-board').click()
  await page.keyboard.type('New kennel')
  await page.keyboard.press('Enter')
  const tile = cardByText(page, 'New kennel')
  await tile.click()
  await expect(page.getByTestId('board-name')).toHaveText('Interaction QA')
  await expect(tile).toHaveClass(/selected/)
  await runCardAction(page, 'Rename')
  await page.getByTestId('board-title-input').fill('Renamed kennel')
  await page.keyboard.press('Enter')
  await cardByText(page, 'Renamed kennel').locator('.board-tile').dblclick()
  await expect(page.getByTestId('board-name')).toHaveText('Renamed kennel')
  await expect(page.locator('[data-type="note"]')).toHaveCount(0)
  await openParentBoard(page, 'last')
  await cardByText(page, 'Renamed kennel').click()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('board-name')).toHaveText('Renamed kennel')
})

test('Buried bones has no notification badge when items are buried', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'A recoverable bone')
  await runCardAction(page, 'Bury')
  await expect(page.getByTestId('tool-trash').locator('.badge')).toHaveCount(0)
  await page.getByTestId('tool-trash').click()
  await expect(page.getByTestId('trash-panel')).toContainText('A recoverable bone')
  await page.getByTestId('restore').click()
  await expect(cardByText(page, 'A recoverable bone')).toBeVisible()
})

test('dialog keyboard actions do not edit or bury the selected canvas card', async ({ page }) => {
  await freshBoard(page)
  await addNote(page, 'Keep this card while managing people')
  await page.getByTestId('account').click()
  await page.getByTestId('manage-people').click()
  await page.getByRole('tab', { name: 'Invitations' }).focus()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-editor')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('people-dialog')).toHaveCount(0)
  await expect(cardByText(page, 'Keep this card while managing people')).toBeVisible()
})

test('routine saves and empty polls keep status quiet unless outgoing work is slow', async ({ page }) => {
  await freshBoard(page)
  await waitForSync(page)
  const status = page.getByTestId('sync-status')
  const recovery = await page.evaluate(() => new Promise<unknown>((resolve) => {
    const request = indexedDB.open('doggynote')
    request.onsuccess = () => { const query = request.result.transaction('meta').objectStore('meta').getAll(); query.onsuccess = () => resolve(query.result.filter((item) => item && typeof item === 'object' && 'reason' in item)) }
  }))
  await expect(status, JSON.stringify(recovery)).toHaveText('Save status')
  const width = (await status.boundingBox())!.width
  await status.evaluate((el) => {
    const evidence = window as unknown as { syncFlashes: number[] }
    evidence.syncFlashes = []
    let started = 0, working = false, visible = false
    new MutationObserver(() => {
      const nextWorking = el.getAttribute('data-sync-state') === 'syncing'
      const nextVisible = el.getAttribute('data-state') === 'syncing'
      if (nextWorking && !working) started = performance.now()
      if (nextVisible && !visible) evidence.syncFlashes.push(performance.now() - started)
      working = nextWorking; visible = nextVisible
    }).observe(el, { attributes: true, attributeFilter: ['data-state', 'data-sync-state'] })
  })
  await addNote(page, 'A quiet save')
  await waitForSync(page)
  // Parallel tests can make the real Worker slow; only sustained work may show.
  expect(await page.evaluate(() => (window as unknown as { syncFlashes: number[] }).syncFlashes.every((delay) => delay >= 950))).toBe(true)
  await expect(status).toHaveText('Save status')
  await page.evaluate(() => { (window as unknown as { syncFlashes: number[] }).syncFlashes = [] })
  await status.click()
  await expect(page.getByTestId('sync-details')).toBeVisible()
  await waitForSync(page)
  await expect(status).toHaveText('Save status')
  expect((await status.boundingBox())!.width).toBe(width)
  expect(await page.evaluate(() => (window as unknown as { syncFlashes: number[] }).syncFlashes)).toEqual([])
})

test('slow outgoing changes show progress then settle without hiding failures', async ({ page }) => {
  await freshBoard(page)
  await waitForSync(page)
  await page.route('**/api/sync', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 1600))
    await route.continue()
  })
  await addNote(page, 'A slower save')
  await expect(page.getByTestId('sync-status')).toHaveText('Syncing…')
  await waitForSync(page)
  await expect(page.getByTestId('sync-status')).toHaveText('Save status')
})

test('Sync now says it is syncing while busy, then confirms, never a greyed-out button', async ({ page }) => {
  await freshBoard(page)
  await waitForSync(page)
  // Hold one request per action, rather than every page of a permission-reset
  // snapshot. Parallel fixtures continually change access; delaying every page
  // can keep restarting a large snapshot until this presentation test times out.
  let delayNext = true
  await page.route('**/api/sync*', async (route) => {
    if (delayNext) {
      delayNext = false
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    await route.continue()
  })
  await page.getByTestId('sync-status').click()
  const button = page.getByTestId('sync-now')
  await expect(button).toHaveText('Syncing…')
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  await expect(button.locator('.sync-spinner')).toBeVisible()
  expect(await button.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  await expect(button).toHaveText('Synced', { timeout: 10_000 })
  await expect(button).toHaveText('Sync now')
  await expect(button).toHaveAttribute('aria-disabled', 'false')
  // A manual run goes through the same states.
  delayNext = true
  await button.click()
  await expect(button).toHaveText('Syncing…')
  await expect(button).toHaveText('Synced', { timeout: 10_000 })
})

test('unfinished text is checkpointed locally and survives offline reload', async ({ page, context }) => {
  await freshBoard(page)
  const note = await addNote(page, 'Original text')
  await waitForSync(page)
  await context.setOffline(true)
  await note.click()
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.type('Still typing when reloaded')
  // Read the actual durable record without ending the editing session.
  await expect.poll(async () => page.evaluate(() => new Promise<boolean>((resolve) => {
    const request = indexedDB.open('doggynote')
    request.onsuccess = () => {
      const transaction = request.result.transaction('objects', 'readonly')
      const query = transaction.objectStore('objects').getAll()
      query.onsuccess = () => resolve(query.result.some((object) => object.content?.md === 'Still typing when reloaded'))
    }
  }))).toBe(true)
  // Keep the app shell reachable while its API is offline (desktop has a bundled shell).
  await context.setOffline(false)
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'))
  await page.reload()
  await expect(cardByText(page, 'Still typing when reloaded')).toBeVisible()
  await page.unroute('**/api/**')
  await context.setOffline(false)
  await page.getByTestId('sync-status').click()
  await waitForSync(page)
})

test('failed local transactions retain edits for a successful retry', async ({ page }) => {
  await freshBoard(page)
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
  await addNote(page, 'Saved after a retry')
  await expect(page.getByTestId('sync-status')).toHaveText('Save problem')
  await page.evaluate(() => { (window as unknown as { denyLocalSave: boolean }).denyLocalSave = false })
  await page.getByTestId('sync-status').click()
  await waitForSync(page)
  await expect(page.getByTestId('sync-status')).toHaveText('Save status')
  await page.reload()
  await expect(cardByText(page, 'Saved after a retry')).toBeVisible()
})
