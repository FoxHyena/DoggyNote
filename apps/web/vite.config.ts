import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// e2e runs its own Worker on another port (see playwright.config.ts), so it never
// talks to a dev Worker that happens to be running.
const api = `http://localhost:${process.env.API_PORT ?? 8787}`

export default defineConfig({
  plugins: [solid()],
  // The Worker (wrangler dev) serves /api in development and e2e.
  server: { proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
})
