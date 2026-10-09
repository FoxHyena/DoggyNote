import { defineConfig, devices } from '@playwright/test'

export const AUTH_FILE = 'e2e/.auth/rex.json'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // The perf budget runs as its own non-blocking CI job (PERF=1); shared runners are too noisy to gate on.
  grepInvert: process.env.CI && !process.env.PERF ? /@perf/ : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5173', storageState: AUTH_FILE },
  // WebKit is what Tauri runs on macOS; Chromium is what most share-link viewers use.
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'], storageState: AUTH_FILE } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE } },
  ],
  webServer: [
    // The production build: same chunks and timing users get. Proxies /api to the Worker.
    {
      command: 'VITE_APP_VERSION=0.0.1 pnpm build && pnpm preview --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // The real Worker on a fresh local D1 + R2, seeded with users rex (admin) and fido.
    {
      command: 'pnpm --filter server e2e:serve',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // The desktop flavour of the build (talks to the API cross-origin with a bearer
    // token), served from another origin to stand in for tauri://localhost.
    {
      command: 'VITE_APP_VERSION=0.0.1 VITE_API_BASE=http://localhost:8787 pnpm exec vite build --outDir dist-desktop && pnpm exec vite preview --outDir dist-desktop --port 4174 --strictPort',
      url: 'http://localhost:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // Pages for link previews, so tests never touch the internet.
    { command: 'node e2e/fixture-server.mjs', url: 'http://localhost:5180/og.html', reuseExistingServer: !process.env.CI },
  ],
})
