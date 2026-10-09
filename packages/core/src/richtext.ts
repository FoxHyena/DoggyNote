import type { RichDoc, RichNode } from './model.ts'

// Note bodies are ProseMirror JSON. Synced content is untrusted (share links are
// public), so before rendering we keep only known node and mark types and only
// safe link targets. The web renderer builds DOM from this, never innerHTML.

export const BLOCK_NODES = ['paragraph', 'heading', 'bullet_list', 'ordered_list', 'list_item', 'blockquote'] as const
export const INLINE_NODES = ['text', 'hard_break'] as const
export const MARKS = ['strong', 'em', 'code', 'link', 'strike'] as const

const ALLOWED_NODES = new Set<string>([...BLOCK_NODES, ...INLINE_NODES])
const ALLOWED_MARKS = new Set<string>(MARKS)

export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    const u = new URL(href)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? u.href : null
  } catch {
    return null
  }
}

function cleanNode(n: RichNode): RichNode | null {
  if (!n || typeof n !== 'object' || !ALLOWED_NODES.has(n.type)) return null
  if (n.type === 'text') {
    if (typeof n.text !== 'string' || !n.text) return null
    const marks = (n.marks ?? [])
      .filter((m) => ALLOWED_MARKS.has(m.type))
      .map((m) => {
        if (m.type !== 'link') return { type: m.type }
        const href = safeHref(m.attrs?.href)
        return href ? { type: 'link', attrs: { href } } : null
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
    return marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text }
  }
  const out: RichNode = { type: n.type }
  if (n.type === 'heading') {
    const level = Number(n.attrs?.level)
    out.attrs = { level: level >= 1 && level <= 3 ? level : 1 }
  }
  if (n.content) out.content = n.content.map(cleanNode).filter((c): c is RichNode => c !== null)
  return out
}

export function sanitizeDoc(doc: unknown): RichDoc {
  const d = doc as RichDoc
  if (!d || d.type !== 'doc' || !Array.isArray(d.content)) return { type: 'doc', content: [] }
  return { type: 'doc', content: d.content.map(cleanNode).filter((c): c is RichNode => c !== null) }
}

/** Plain text of a doc, one line per block. For search and card previews. */
export function docToText(doc: RichDoc | undefined): string {
  const lines: string[] = []
  const walk = (n: RichNode, line: string[]): void => {
    if (n.type === 'text') line.push(n.text ?? '')
    else if (n.type === 'hard_break') line.push('\n')
    else if (n.content) {
      const isBlock = n.type === 'paragraph' || n.type === 'heading'
      const inner: string[] = isBlock ? [] : line
      for (const c of n.content) walk(c, inner)
      if (isBlock) lines.push(inner.join(''))
    }
  }
  for (const n of doc?.content ?? []) walk(n, [])
  return lines.join('\n')
}

export function textToDoc(text: string): RichDoc {
  const paras = text.split(/\r?\n/)
  return {
    type: 'doc',
    content: paras.map((p) => (p ? { type: 'paragraph', content: [{ type: 'text', text: p }] } : { type: 'paragraph' })),
  }
}

export function isDocEmpty(doc: RichDoc | undefined): boolean {
  return docToText(doc).trim() === ''
}
