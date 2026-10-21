// Opt-in local QA bridge: real Telegram getUpdates -> production webhook handler.
// Does not register/delete webhooks, send messages, or print bot credentials.
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const config = Object.fromEntries(readFileSync('../server/.dev.vars', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
const token = config.TELEGRAM_BOT_TOKEN, secret = config.TELEGRAM_WEBHOOK_SECRET
if (!token || !/^[a-zA-Z0-9:_-]+$/.test(token) || !secret) throw new Error('Configure local test bot secrets first')
const dir = resolve('../../docs/qa/stickers/live'); mkdirSync(dir, { recursive: true })
const resume = process.argv.includes('--resume')
const report = { date: new Date().toISOString(), transport: 'Telegram getUpdates, forwarded locally to authenticated webhook handler; public webhook registration unchanged', success: false, checks: [] }
const note = (text) => { report.checks.push(text); console.log(text) }
const bot = (method, data) => {
  const r = spawnSync('curl', ['--config', '-', '--silent', '--show-error', '--max-time', '20', '--request', 'POST', '--header', 'content-type: application/json', '--data-binary', JSON.stringify(data)], { input: `url = "https://api.telegram.org/bot${token}/${method}"\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (r.status) throw new Error('Telegram transport failed')
  const result = JSON.parse(r.stdout)
  if (!result.ok) throw new Error(`Telegram returned error ${result.error_code}`)
  return result.result
}
if (bot('getWebhookInfo', {}).url) throw new Error('A webhook is already registered; do not replace it for this check')
async function expectReady(button) { for (let i = 0; i < 120; i++) { if (await button.isEnabled()) return; await new Promise(r => setTimeout(r, 500)) }; throw new Error('Suggested pack did not become ready') }
const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({ baseURL: 'http://localhost:8789', viewport: { width: 1100, height: 800 } })
try {
  const login = await context.request.post('/api/auth/login', { data: { username: 'rex', password: 'goodboy123' } })
  if (!login.ok()) throw new Error('Local fixture sign-in failed')
  const page = await context.newPage(); await page.goto('/')
  await page.getByTestId('tool-stickers').click(); const tray = page.getByTestId('sticker-tray')
  await tray.getByRole('button', { name: 'Add pack', exact: true }).first().click()
  await tray.getByRole('button', { name: 'Send a sticker in Telegram ↗', exact: true }).click()
  const status = await (await context.request.get('/api/stickers/telegram')).json()
  if (status.pair && !resume) throw new Error('The local QA account is already connected; disconnect it in the app before this test')
  if (!resume) await tray.getByRole('button', { name: /^(Connect Telegram bot|Pairing expired · Start again|Get a new pairing link)$/ }).click()
  const url = resume ? '' : await tray.getByLabel('Telegram bot pairing link').inputValue(), start = resume ? '' : new URL(url).searchParams.get('start')
  if (!resume) writeFileSync('/tmp/stickers-pairing-link.txt', url + '\n', { mode: 0o600 })
  note(resume ? 'Resuming the explicitly confirmed real pairing and pending pack suggestion.' : 'Authenticated QA pairing screen opened. Waiting for the test account to press Start in Telegram.')
  let offset = 0, telegramId, capturedConfirmation = false
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const updates = resume ? [] : bot('getUpdates', { offset, timeout: 5, allowed_updates: ['message'] })
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1)
      const message = update.message
      if (!message) continue
      if (message.text === `/start ${start}`) telegramId = message.from?.id
      if (!telegramId || message.from?.id !== telegramId) continue
      const sent = await context.request.post('/api/telegram/webhook', { headers: { 'x-telegram-bot-api-secret-token': secret }, data: update })
      if (!sent.ok()) throw new Error(`Local webhook returned HTTP ${sent.status()}`)
    }
    const state = await (await context.request.get('/api/stickers/telegram')).json()
    if (state.challenge?.telegramId && !capturedConfirmation) {
      await page.getByRole('button', { name: 'Confirm this account', exact: true }).waitFor()
      await page.screenshot({ path: resolve(dir, 'telegram-live-confirmation.png') })
      note('A real Telegram identity arrived. Waiting for explicit confirmation in the authenticated app.')
      capturedConfirmation = true
    }
    if (state.pair && state.pending?.packName) {
      report.packName = state.pending.packName
      await tray.getByRole('button', { name: `Preview ${state.pending.packName}`, exact: true }).click()
      await tray.locator('.sticker-pack-summary').waitFor({ timeout: 60_000 })
      await tray.getByRole('button', { name: /^(Add pack|Open pack)$/ }).waitFor({ state: 'visible', timeout: 60_000 })
      await page.screenshot({ path: resolve(dir, 'telegram-live-pack-preview.png') })
      note('App confirmation bound the test identity; a genuine sent sticker produced the expected pack preview without automatic placement.')
      const add = tray.getByRole('button', { name: /^(Add pack|Open pack)$/ })
      await expectReady(add)
      await add.click()
      await tray.locator('.sticker-pack-title').waitFor()
      report.success = (await (await context.request.get('/api/stickers')).json()).packs.some(p => p.name.toLowerCase() === state.pending.packName.toLowerCase())
      note('Confirmed Add pack imported the real suggested set into the personal collection.')
      break
    }
  }
  if (!report.success) note('Pairing walkthrough remains incomplete: waiting for Telegram Start, app confirmation, or a sticker from hyenafox.')
} catch (e) {
  report.error = String(e.message).replaceAll(token, '[redacted]').replaceAll(secret, '[redacted]').slice(0, 800)
  console.log('Live pairing incomplete:', report.error)
} finally {
  writeFileSync(resolve(dir, 'pairing-result.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
if (!report.success) process.exitCode = 1
