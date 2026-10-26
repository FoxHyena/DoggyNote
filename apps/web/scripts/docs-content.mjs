import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { publishedArticles, validateArticle, validateLinks } from '../src/docs/schema.ts'
const root = new URL('../', import.meta.url)
export const contentDirectory = fileURLToPath(new URL('src/docs/content/', root))
export function imageDimensions(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  if (bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WEBP') throw new Error('Expected PNG or WebP bytes')
  const kind = bytes.toString('ascii',12,16)
  if (kind === 'VP8X') return [1 + bytes.readUIntLE(24,3), 1 + bytes.readUIntLE(27,3)]
  if (kind === 'VP8 ') return [bytes.readUInt16LE(26) & 16383, bytes.readUInt16LE(28) & 16383]
  if (kind === 'VP8L') { const bits = bytes.readUInt32LE(21); return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1] }
  throw new Error('Unsupported WebP header')
}
export function readArticles(directory = contentDirectory, publicDirectory = fileURLToPath(new URL('public/', root))) {
  const articles = readdirSync(directory).filter(f => f.endsWith('.json')).map(file => {
    try {
      const article = JSON.parse(readFileSync(`${directory}/${file}`, 'utf8'))
      validateArticle(article)
      if (file !== `${article.slug}.json`) throw new Error('Filename must match slug')
      for (const figure of article.sections.flatMap(s => s.figures ?? [])) {
        const bytes = readFileSync(`${publicDirectory}${figure.src}`)
        const [width, height] = imageDimensions(bytes)
        if (width !== figure.width || height !== figure.height) throw new Error(`Wrong dimensions for ${figure.src}: ${width}×${height}`)
        if (bytes.length > 1500000) throw new Error(`Optimize ${figure.src}: maximum 1.5 MB`)
      }
      return article
    } catch (e) { throw new Error(`${file}: ${e.message}`) }
  })
  validateLinks(articles)
  return articles
}
export function publicArticleSource(articles) {
  return `export default ${JSON.stringify(publishedArticles(articles))}`
}
export function docsContentPlugin() {
  const id = '\0virtual:docs-content'
  return {
    name: 'public-docs-content',
    resolveId(source) { if (source === 'virtual:docs-content') return id },
    load(source) {
      if (source !== id) return
      this.addWatchFile(contentDirectory)
      for (const f of readdirSync(contentDirectory)) this.addWatchFile(`${contentDirectory}/${f}`)
      // Drafts are removed BEFORE Rollup sees content: no public data/route bypass.
      return publicArticleSource(readArticles())
    },
    configureServer(server) {
      server.watcher.add(contentDirectory)
      const reload = (file) => {
        if (!file.startsWith(`${contentDirectory}/`) || !file.endsWith('.json')) return
        const module = server.moduleGraph.getModuleById(id)
        if (module) server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', reload).on('change', reload).on('unlink', reload)
      server.httpServer?.once('close', () => {
        server.watcher.off('add', reload).off('change', reload).off('unlink', reload)
      })
    },
  }
}
