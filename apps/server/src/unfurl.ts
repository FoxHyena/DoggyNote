// Link previews: fetch the page and read OpenGraph / Twitter / <title> tags with
// HTMLRewriter (streaming, so we never buffer a whole page).

export type Unfurled = { title?: string; description?: string; image?: string; siteName?: string }

const MAX_LEN = { title: 300, description: 600, siteName: 100 }

function clip(s: string | undefined, n: number) {
  if (!s) return undefined
  const t = s.replace(/\s+/g, ' ').trim()
  return t ? (t.length > n ? t.slice(0, n - 1) + '…' : t) : undefined
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function isFetchableUrl(raw: string): URL | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/**
 * How we ask first: as a link-preview bot. Sites that build previews for chat apps
 * (fixvx, vxtwitter) only send their tags to user agents they recognise as one.
 */
export const PREVIEW_UA = 'Mozilla/5.0 (compatible; DoggyNoteBot/1.0; like Twitterbot; +link-preview)'

/**
 * Safari on a Mac: the second try. Some sites (Amazon) send a bare page with no
 * OpenGraph tags to anything that looks like a bot.
 */
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

type Page = { found: Unfurled; tagged: boolean }

/** Ask as a preview bot; if the page has no preview tags (or refuses), ask again as a browser. */
export async function unfurl(target: URL, fetcher: typeof fetch = fetch): Promise<Unfurled> {
  let first: Page | undefined
  try {
    first = await readPage(target, PREVIEW_UA, fetcher)
    if (first.tagged) return first.found
  } catch {
    first = undefined
  }
  try {
    const second = await readPage(target, BROWSER_UA, fetcher)
    return second.tagged || !first ? second.found : first.found
  } catch (e) {
    if (first) return first.found
    throw e
  }
}

async function readPage(target: URL, ua: string, fetcher: typeof fetch): Promise<Page> {
  const res = await fetcher(target.href, {
    headers: {
      'user-agent': ua,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (type.startsWith('image/')) return { found: { image: target.href, title: target.pathname.split('/').pop() || target.hostname }, tagged: true }
  if (!type.includes('html')) return { found: { title: target.hostname }, tagged: false }

  const meta: Record<string, string> = {}
  let title = ''
  let inTitle = false
  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') ?? el.getAttribute('name') ?? '').toLowerCase()
        const content = el.getAttribute('content')
        if (key && content && !(key in meta)) meta[key] = content
      },
    })
    .on('title', {
      element() {
        inTitle = !title
      },
      text(t) {
        if (inTitle) title += t.text
        if (t.lastInTextNode) inTitle = false
      },
    })
  // Drain the transformed stream; we only want the callbacks.
  await rewriter.transform(res).arrayBuffer()

  const base = res.url || target.href
  const pick = (...keys: string[]) => keys.map((k) => meta[k]).find(Boolean)
  const rawImage = pick('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')
  let image: string | undefined
  if (rawImage) {
    try {
      const u = new URL(decodeEntities(rawImage), base)
      if (u.protocol === 'https:' || u.protocol === 'http:') image = u.href
    } catch {
      image = undefined
    }
  }
  const dec = (s?: string) => (s ? decodeEntities(s) : undefined)
  const tagTitle = pick('og:title', 'twitter:title')
  return {
    found: {
      title: clip(dec(tagTitle) ?? dec(title), MAX_LEN.title),
      description: clip(dec(pick('og:description', 'twitter:description', 'description')), MAX_LEN.description),
      siteName: clip(dec(pick('og:site_name')), MAX_LEN.siteName),
      image,
    },
    // A plain <title> alone isn't a preview: Amazon gives bots one, and nothing else.
    tagged: !!(tagTitle || image),
  }
}

export const MAX_PROXY_BYTES = 5 * 1024 * 1024

/** Fetches an image and passes it on, refusing anything that isn't a reasonably sized image. */
export async function proxyImage(target: URL, fetcher: typeof fetch = fetch): Promise<Response> {
  const res = await fetcher(target.href, {
    headers: { 'user-agent': BROWSER_UA, accept: 'image/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok || !res.body) throw new Error(`upstream ${res.status}`)
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  // Never SVG: it's a document, and could carry script.
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/i.test(type)) throw new Error('not an image')
  if (Number(res.headers.get('content-length') ?? 0) > MAX_PROXY_BYTES) throw new Error('image too large')
  const body = await res.arrayBuffer()
  if (body.byteLength > MAX_PROXY_BYTES) throw new Error('image too large')
  return new Response(body, {
    headers: { 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" },
  })
}
