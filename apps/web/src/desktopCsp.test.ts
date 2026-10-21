import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The Mac app's CSP decides what the web app inside it may reach. Live presence
// is a WebSocket to the same server as the API: `https:` doesn't cover `wss:` in
// WebKit, so each API source needs its WebSocket twin or the app reconnects forever.
const conf = JSON.parse(readFileSync(new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const connect: string[] = conf.app.security.csp['connect-src'].split(/\s+/)

describe('desktop CSP', () => {
  it('allows a WebSocket wherever it allows the API', () => {
    for (const source of connect.filter((s) => /^https?:/.test(s) && !s.includes('ipc.localhost'))) {
      expect(connect).toContain(source.replace(/^http/, 'ws'))
    }
  })
})
