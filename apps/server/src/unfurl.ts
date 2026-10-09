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

export async function unfurl(target: URL, fetcher: typeof fetch = fetch): Promise<Unfurled> {
  const res = await fetcher(target.href, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; DoggyNoteBot/1.0; +link-preview)',
      accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (type.startsWith('image/')) return { image: target.href, title: target.pathname.split('/').pop() || target.hostname }
  if (!type.includes('html')) return { title: target.hostname }

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
  return {
    title: clip(dec(pick('og:title', 'twitter:title')) ?? dec(title), MAX_LEN.title),
    description: clip(dec(pick('og:description', 'twitter:description', 'description')), MAX_LEN.description),
    siteName: clip(dec(pick('og:site_name')), MAX_LEN.siteName),
    image,
  }
}
