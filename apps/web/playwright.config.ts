import { defineConfig, devices } from '@playwright/test'
import { API_PORT, DESKTOP_PORT, FIXTURE_PORT, WEB_PORT } from './e2e/ports.ts'

export const AUTH_FILE = 'e2e/.auth/rex.json'
const TOUCH_SPECS = /(mobile|tablet)-.*\.spec\.ts/

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // The perf budget runs as its own non-blocking CI job (PERF=1); shared runners are too noisy to gate on.
  grepInvert: process.env.CI && !process.env.PERF ? /@perf/ : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${WEB_PORT}`, storageState: AUTH_FILE, extraHTTPHeaders: { 'x-doggynote-protocol': '2' } },
  // WebKit is what Tauri runs on macOS; Chromium is what most share-link viewers use.
  // Phones and tablets run their own specs (mobile-*.spec.ts, tablet-*.spec.ts) with real touch emulation.
  projects: [
    { name: 'webkit', testIgnore: TOUCH_SPECS, use: { ...devices['Desktop Safari'], storageState: AUTH_FILE } },
    { name: 'chromium', testIgnore: TOUCH_SPECS, use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE } },
    { name: 'mobile-webkit', testMatch: /mobile-.*\.spec\.ts/, use: { ...devices['iPhone 15 Pro'], storageState: AUTH_FILE } },
    { name: 'mobile-chromium', testMatch: /mobile-.*\.spec\.ts/, use: { ...devices['Pixel 7'], storageState: AUTH_FILE } },
    { name: 'tablet-webkit', testMatch: /tablet-.*\.spec\.ts/, use: { ...devices['iPad Pro 11'], storageState: AUTH_FILE } },
  ],
  webServer: [
    // The production build: same chunks and timing users get. Proxies /api to the Worker.
    {
      command: `VITE_APP_VERSION=0.0.1 pnpm build && API_PORT=${API_PORT} pnpm preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // The real Worker on a fresh local D1 + R2, seeded with users rex (admin) and fido.
    {
      // Never reused: every run gets a fresh database.
      command: `PORT=${API_PORT} DESKTOP_PORT=${DESKTOP_PORT} FIXTURE_PORT=${FIXTURE_PORT} pnpm --filter server e2e:serve`,
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    // The desktop flavour of the build (talks to the API cross-origin with a bearer
    // token), served from another origin to stand in for tauri://localhost.
    {
      command: `VITE_APP_VERSION=0.0.1 VITE_API_BASE=http://localhost:${API_PORT} pnpm exec vite build --outDir dist-desktop && pnpm exec vite preview --outDir dist-desktop --port ${DESKTOP_PORT} --strictPort`,
      url: `http://localhost:${DESKTOP_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // Pages for link previews, so tests never touch the internet.
    { command: `FIXTURE_PORT=${FIXTURE_PORT} node e2e/fixture-server.mjs`, url: `http://localhost:${FIXTURE_PORT}/og.html`, reuseExistingServer: !process.env.CI },
  ],
})
