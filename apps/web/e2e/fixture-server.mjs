// Tiny static server for e2e fixtures (link previews), so tests never touch the
// real internet. Port 5180.
import { createServer } from 'node:http'
import { crc32, deflateSync } from 'node:zlib'

/** A solid 16×16 PNG, built here so there's no binary fixture to check in. */
function solidPng([r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(16, 0)
  ihdr.writeUInt32BE(16, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  const rows = Buffer.alloc(16 * (1 + 16 * 3))
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) rows.set([r, g, b], y * 49 + 1 + x * 3)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const PAGES = {
  '/og.html': `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Good Boy Supplies &amp; Treats">
    <meta property="og:description" content="Everything a very good dog needs.">
    <meta property="og:site_name" content="Doggo Shop">
    <meta property="og:image" content="/dog.svg">
  </head><body>hi</body></html>`,
  // Like a real site's preview image: a PNG with no CORS headers.
  '/og-png.html': `<!doctype html><html><head><meta property="og:title" content="Green dog"><meta property="og:image" content="/green.png"></head></html>`,
  '/green.png': solidPng([60, 154, 95]),
  '/plain.html': `<!doctype html><html><head><title>Just a title</title></head><body></body></html>`,
  '/dog.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#e8a849"/></svg>`,
}

createServer((req, res) => {
  const body = PAGES[new URL(req.url, 'http://x').pathname]
  if (!body) {
    res.writeHead(404).end('nope')
    return
  }
  const path = new URL(req.url, 'http://x').pathname
  const type = path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8'
  res.writeHead(200, { 'content-type': type }).end(body)
}).listen(5180, () => console.log('fixtures on :5180'))
