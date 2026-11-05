import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import web from '../web/playwright.config.ts'
const webRoot = fileURLToPath(new URL('../web/', import.meta.url))
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  webServer: process.env.CLIPPER_TEST_EXISTING_SERVER === '1' ? undefined : (Array.isArray(web.webServer) ? web.webServer : [web.webServer!]).map((server) => ({ ...server, cwd: webRoot, env: { E2E_PERSIST_DIR: '.wrangler/extension-e2e' } })),
})
