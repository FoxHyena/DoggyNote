// Tiny static server for e2e fixtures (link previews), so tests never touch the
// real internet. Port 5180.
import { createServer } from 'node:http'

const PAGES = {
  '/og.html': `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Good Boy Supplies &amp; Treats">
    <meta property="og:description" content="Everything a very good dog needs.">
    <meta property="og:site_name" content="Doggo Shop">
    <meta property="og:image" content="/dog.svg">
  </head><body>hi</body></html>`,
  '/plain.html': `<!doctype html><html><head><title>Just a title</title></head><body></body></html>`,
  '/dog.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#e8a849"/></svg>`,
}

createServer((req, res) => {
  const body = PAGES[new URL(req.url, 'http://x').pathname]
  if (!body) {
    res.writeHead(404).end('nope')
    return
  }
  res.writeHead(200, { 'content-type': req.url.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8' }).end(body)
}).listen(5180, () => console.log('fixtures on :5180'))
