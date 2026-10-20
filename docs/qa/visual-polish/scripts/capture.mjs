import { chromium, webkit } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const phase = process.argv[2] ?? 'before'
const base = phase === 'before' ? 'http://localhost:5177' : 'http://localhost:5176'
const out = `docs/qa/visual-polish/${phase}`
await mkdir(out, { recursive: true })
const inventory = []
for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: 'rex', password: 'goodboy123', bearer: true } })
  if (!login.ok()) throw new Error(`Login ${login.status()} ${await login.text()}`)
  const { token } = await login.json()
  await context.route('http://localhost:8787/api/**', async route => {
    const response = await context.request.fetch(route.request().url().replace(':8787/', ':8791/'), {
      method: route.request().method(), headers: { ...route.request().headers(), authorization: `Bearer ${token}` }, postData: route.request().postData() ?? undefined,
    })
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': base } })
  })
  const page = await context.newPage()
  await page.goto(base)
  await page.getByTestId('canvas').waitFor()
  for (const theme of ['Light', 'Dark']) {
    await page.getByTestId('account').click()
    await page.getByRole('radio', { name: theme, exact: true }).click()
    await page.keyboard.press('Escape')
    for (const width of [1440, 1024, 720, 600, 360]) {
      await page.setViewportSize({ width, height: 480 })
      for (const [surface, trigger, selector] of [
        ['boards', 'board-navigation', '.board-nav-menu'],
        ['account', 'account', '.account-popover'],
        ['more', 'board-more', '.board-actions-menu'],
        ['save', 'sync-status', '[data-testid=sync-details]'],
        ['share', 'share', '[data-testid=share-panel]'],
        ['inbox', 'toybox-button', '[data-testid=toybox-panel]'],
        ['trash', 'tool-trash', '[data-testid=trash-panel]'],
      ]) {
        await page.keyboard.press('Escape')
        await page.getByTestId(trigger).click()
        const target = page.locator(selector)
        await target.waitFor({ timeout: 5000 })
        await page.mouse.move(width - 1, 475)
        const file = `${engine}-${theme.toLowerCase()}-${width}-${surface}.png`
        await target.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))) })
        await page.screenshot({ path: `${out}/${file}`, animations: 'disabled' })
        inventory.push({ engine, theme, width, height: 480, surface, file: `${phase}/${file}`, bounds: await target.boundingBox() })
        await page.keyboard.press('Escape')
        if (await target.isVisible()) await page.getByTestId(trigger).click()
      }
    }
  }
  await context.close()
  await browser.close()
}
await writeFile(`${out}/inventory.json`, JSON.stringify(inventory, null, 2))
