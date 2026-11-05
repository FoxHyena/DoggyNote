import { build } from 'vite'
import solid from 'vite-plugin-solid'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const apiBase = process.env.DOGGYNOTE_URL || 'https://notepad.dog'
const url = new URL(apiBase)
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) throw new Error('Use HTTPS, or localhost for development')
const shared = { root, configFile: false, define: { __API_BASE__: JSON.stringify(url.origin) }, logLevel: 'warn' }
await build({ ...shared, plugins: [solid()], build: { outDir: 'dist', emptyOutDir: true, target: 'chrome116', rollupOptions: { input: resolve(root, 'sidepanel.html') } } })
for (const name of ['background', 'content']) {
  await build({ ...shared, build: { outDir: 'dist', emptyOutDir: false, target: 'chrome116', lib: { entry: resolve(root, `src/${name}.ts`), formats: [name === 'content' ? 'iife' : 'es'], name: 'DoggyNoteClipper', fileName: () => `${name}.js` }, rollupOptions: { output: { codeSplitting: false } } } })
}
await mkdir(resolve(root, 'dist'), { recursive: true })
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
manifest.version = pkg.version
await writeFile(resolve(root, 'dist/manifest.json'), JSON.stringify(manifest, null, 2))
await copyFile(resolve(root, '../web/public/icons/icon-192.png'), resolve(root, 'dist/icon.png'))
await copyFile(resolve(root, '../web/public/favicon.svg'), resolve(root, 'dist/paw.svg'))
await copyFile(resolve(root, '../web/public/licenses/phosphor-icons.txt'), resolve(root, 'dist/phosphor-icons.txt'))
console.log(`Built DoggyNote Clipper ${pkg.version} for ${url.origin}`)
