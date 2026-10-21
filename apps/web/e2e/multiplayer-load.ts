import { expect, type Browser, type Page } from '@playwright/test'

/** Nine other identities, real room tickets, and 120 cursor updates/second. */
export async function multiplayerLoad(page: Page, browser: Browser, board: string) {
  const origin = new URL(page.url()).origin, contexts = [], tickets: string[] = []
  for (let i = 0; i < 9; i++) {
    const username = `perf_${crypto.randomUUID().slice(0, 12)}`, password = 'local-perf-password'
    expect((await page.request.post('/api/users', { data: { username, password } })).ok()).toBe(true)
    expect((await page.request.post(`/api/boards/${board}/members`, { data: { username, permission: 'view', includeChildren: false } })).ok()).toBe(true)
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-doggynote-protocol': '3' } })
    contexts.push(context)
    expect((await context.request.post(`${origin}/api/auth/login`, { data: { username, password } })).ok()).toBe(true)
    tickets.push((await (await context.request.post(`${origin}/api/boards/${board}/live-ticket`, { data: {} })).json()).ticket)
  }
  await page.evaluate(async ({ board, tickets }) => {
    const sockets: WebSocket[] = []
    await Promise.all(tickets.map((ticket) => new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/api/boards/${board}/live`)
      const timer = setTimeout(() => reject(new Error('Room load participant did not connect')), 10000)
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ticket }))
      ws.onmessage = (event) => { if (JSON.parse(event.data).type === 'ready') { clearTimeout(timer); sockets.push(ws); resolve() } }
    })))
    let step = 0
    const timer = setInterval(() => {
      const world = document.querySelector<HTMLElement>('[data-testid="world"]')!, canvas = document.querySelector<HTMLElement>('[data-testid="canvas"]')!
      const m = new DOMMatrixReadOnly(getComputedStyle(world).transform), width = canvas.clientWidth, height = canvas.clientHeight
      const camera = { x: -m.e / m.a, y: -m.f / m.a, zoom: m.a }
      sockets.forEach((ws, i) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'presence', pointer: { x: camera.x + (40 + ((i * 137 + step * 3) % (width - 80))) / m.a, y: camera.y + (70 + ((i * 53) % (height - 140))) / m.a }, camera, width, height, selection: [], editing: null, previews: [], caret: null }))
      })
      step++
    }, 75)
    ;(window as unknown as { stopMultiplayerLoad: () => void }).stopMultiplayerLoad = () => { clearInterval(timer); sockets.forEach((s) => s.close()) }
  }, { board, tickets })
  await expect(page.locator('.people-count')).toHaveText('10')
  return async () => {
    await page.evaluate(() => (window as unknown as { stopMultiplayerLoad: () => void }).stopMultiplayerLoad()).catch(() => {})
    await Promise.all(contexts.map((context) => context.close()))
  }
}
