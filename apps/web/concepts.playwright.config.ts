import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './concept-tests',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5196', viewport: { width: 1440, height: 1000 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 5196 --strictPort', url: 'http://127.0.0.1:5196/concepts.html', reuseExistingServer: true },
})
