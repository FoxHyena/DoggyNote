import { chromium, expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addNote, cardByText, freshBoard, waitForSync } from './helpers.ts'

test('background tabs suspend presence; returning restores current state and a crashed participant leaves', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native tab visibility and renderer crash use Chromium/CDP')
  test.skip(process.platform === 'linux' && !process.env.DISPLAY, 'Native visibility needs a display; CI uses xvfb-run')
  test.setTimeout(60_000)
  await freshBoard(page); await addNote(page, 'Lifecycle board'); await waitForSync(page)
  const board = page.url().split('/b/')[1]!, origin = new URL(page.url()).origin
  expect((await page.request.post(`/api/boards/${board}/members`, { data: { username: 'fido', permission: 'edit', includeChildren: false } })).ok()).toBe(true)
  // Playwright normally forces every page visible. Attach to a temporary real
  // Chrome profile with noDefaults, preserving native visibility and input.
  const profile = mkdtempSync(join(tmpdir(), 'doggynote-visibility-'))
  const chrome = spawn(chromium.executablePath(), ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage'], { stdio: 'ignore' })
  let native: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    let port = 0
    await expect.poll(() => { try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); return port } catch { return 0 } }).not.toBe(0)
    native = await chromium.connectOverCDP(`http://localhost:${port}`, { noDefaults: true })
    const context = native.contexts()[0]!
    await context.setExtraHTTPHeaders({ 'x-doggynote-protocol': '3' })
    expect((await context.request.post(`${origin}/api/auth/login`, { data: { username: 'fido', password: 'fetchfetch' } })).ok()).toBe(true)
    const friend = await context.newPage(); await friend.goto(page.url())
    await expect(cardByText(friend, 'Lifecycle board')).toBeVisible()
    await page.getByTestId('collaborators').click(); await expect(page.getByTestId('participant')).toHaveCount(2)
    const browserCDP = await native.newBrowserCDPSession(), next = context.waitForEvent('page')
    await browserCDP.send('Target.createTarget', { url: 'about:blank', newWindow: false })
    const background = await next; await background.bringToFront()
    await expect.poll(() => friend.evaluate(() => document.hidden)).toBe(true)
    await expect(page.getByTestId('participant')).toHaveCount(1)
    await friend.bringToFront(); await expect.poll(() => friend.evaluate(() => document.hidden)).toBe(false)
    await expect(page.getByTestId('participant')).toHaveCount(2)
    await expect(page.getByTestId('remote-ping')).toHaveCount(0); await expect(page.getByTestId('remote-preview')).toHaveCount(0)
    await page.getByRole('button', { name: 'Follow fido', exact: true }).click()
    const cdp = await context.newCDPSession(friend)
    const crashed = friend.waitForEvent('crash')
    void cdp.send('Page.crash').catch(() => {}) // CDP intentionally never replies.
    await crashed
    await expect(page.getByRole('button', { name: 'Stop following' })).toHaveCount(0, { timeout: 30_000 })
    await page.getByTestId('collaborators').click(); await expect(page.getByTestId('participant')).toHaveCount(1)
  } finally {
    await native?.close().catch(() => {})
    if (chrome.exitCode === null) await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => chrome.kill('SIGKILL'), 2000)
      chrome.once('exit', () => { clearTimeout(timeout); resolve() }); chrome.kill('SIGTERM')
    })
    // Chrome's helper processes can still write to the profile for a moment after
    // it exits (ENOTEMPTY on CI). Retry, and never fail the test over a temp folder.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* left in tmp */ }
  }
})
