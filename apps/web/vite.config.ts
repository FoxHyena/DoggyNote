import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'
// Relative, so the config bundler compiles it (the workspace package is TS source).
import { surfaces } from '../../packages/theme/src/tokens.ts'
import { COPY } from '../../packages/theme/src/copy.ts'

// e2e runs its own Worker on another port (see playwright.config.ts), so it never
// talks to a dev Worker that happens to be running.
const api = `http://localhost:${process.env.API_PORT ?? 8787}`

/**
 * Add to Home Screen: the web app manifest, icons and phone meta tags. Colours
 * come from the theme tokens. Shared links and text from other apps arrive at
 * /share (Android) and land in your Inbox.
 */
function homeScreen(): Plugin {
  const manifest = JSON.stringify({
    id: '/',
    name: COPY.appName,
    short_name: COPY.appName,
    description: 'Boards for notes, to-dos, links and pictures. Good dog.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: surfaces.dark.bg,
    theme_color: surfaces.dark.panel,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [{ name: `Jot something in your ${COPY.unsorted}`, short_name: COPY.unsorted, url: '/?inbox=1', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }],
    share_target: { action: '/share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
  })
  const meta = (name: string, content: string, attrs: Record<string, string> = {}) => ({ tag: 'meta', attrs: { name, content, ...attrs }, injectTo: 'head' as const })
  return {
    name: 'doggynote-home-screen',
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('content-type', 'application/manifest+json')
        res.end(manifest)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest })
    },
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }, injectTo: 'head' },
      meta('apple-mobile-web-app-capable', 'yes'),
      meta('mobile-web-app-capable', 'yes'),
      meta('apple-mobile-web-app-title', COPY.appName),
      // The page draws under the status bar; the header's safe-area padding keeps it clear.
      meta('apple-mobile-web-app-status-bar-style', 'black-translucent'),
      meta('theme-color', surfaces.light.panel, { media: '(prefers-color-scheme: light)' }),
      meta('theme-color', surfaces.dark.panel, { media: '(prefers-color-scheme: dark)' }),
    ],
  }
}

export default defineConfig({
  plugins: [solid(), homeScreen()],
  // The Worker (wrangler dev) serves /api in development and e2e.
  server: { proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
})
