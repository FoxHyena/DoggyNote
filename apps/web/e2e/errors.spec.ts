import { expect, test } from '@playwright/test'
import { COPY } from '@doggynote/theme'
import { addNote, freshBoard, waitForSync } from './helpers.ts'

// When something goes wrong, people hear first that their work is safe, in plain words.
// A gateway's "Bad Gateway" never reaches the screen.

test('a server that fails without explaining shows reassurance, with the reason folded away', async ({ page }) => {
  await freshBoard(page)
  await waitForSync(page)
  await page.route('**/api/sync*', (route) => route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }))
  await addNote(page, 'Written during the outage')
  const status = page.getByTestId('sync-status')
  await status.click()
  await expect(status).toHaveAttribute('data-sync-state', 'error')
  const details = page.getByTestId('sync-details')
  await expect(details).toContainText(COPY.syncSafe)
  const reason = details.getByTestId('sync-error-detail')
  await expect(reason.locator('p')).toBeHidden()
  await reason.getByText('What happened').click()
  await expect(reason).toContainText("The server isn't answering properly right now.")
  // Retries don't flip the message or fold the reason away while you read it.
  await page.getByTestId('sync-now').click()
  await page.waitForTimeout(600)
  await expect(details).toContainText(COPY.syncSafe)
  await expect(reason.locator('p')).toBeVisible()
  await expect(page.getByText('Bad Gateway')).toHaveCount(0)
  // The server answers again: the reassurance goes, and the note syncs.
  await page.unroute('**/api/sync*')
  await page.getByTestId('sync-now').click()
  await expect(status).toHaveAttribute('data-sync-state', 'idle')
  await expect(details).not.toContainText(COPY.syncSafe)
  await expect(details.getByTestId('pending-changes')).toHaveText('0')
})

test('a wrong password reads as a note under the fields, with a next step', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const page = await ctx.newPage()
    await page.goto('/')
    const form = page.getByTestId('login-form')
    await form.getByLabel('Username', { exact: true }).fill(`nobody_${crypto.randomUUID().slice(0, 8)}`)
    await form.getByLabel('Password', { exact: true }).fill('not-the-password')
    await form.getByRole('button', { name: /sign in/i }).click()
    const error = page.getByTestId('login-error')
    await expect(error).toHaveText('Wrong username or password')
    await expect(form.getByText('Forgotten it? Ask whoever invited you to reset it.')).toBeVisible()
    // A note, not a filled slab.
    expect(await error.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  } finally { await ctx.close() }
})
