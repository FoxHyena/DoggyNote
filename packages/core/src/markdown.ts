import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import type { Card, RichDoc, RichNode } from './model.ts'
import { docToText, safeHref, sanitizeDoc } from './richtext.ts'

// Notes are stored as markdown. This turns markdown into the same sanitized
// RichNode tree the renderer already draws with createElement (never
// innerHTML). Raw HTML is never parsed (html: false), links go through
// safeHref, and the result goes through sanitizeDoc as a backstop.

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })

type Mark = NonNullable<RichNode['marks']>[number]

function inline(tokens: Token[]): RichNode[] {
  const out: RichNode[] = []
  const marks: Mark[] = []
  const push = (text: string) => {
    if (!text) return
    out.push(marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text })
  }
  const drop = (type: string) => {
    const i = marks.map((m) => m.type).lastIndexOf(type)
    if (i >= 0) marks.splice(i, 1)
  }
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
      case 'html_inline':
        push(t.content)
        break
      case 'code_inline':
        marks.push({ type: 'code' })
        push(t.content)
        drop('code')
        break
      case 'softbreak':
      case 'hardbreak':
        out.push({ type: 'hard_break' })
        break
      case 'strong_open':
        marks.push({ type: 'strong' })
        break
      case 'em_open':
        marks.push({ type: 'em' })
        break
      case 's_open':
        marks.push({ type: 'strike' })
        break
      case 'strong_close':
        drop('strong')
        break
      case 'em_close':
        drop('em')
        break
      case 's_close':
        drop('strike')
        break
      case 'link_open': {
        const href = safeHref(t.attrGet('href'))
        marks.push(href ? { type: 'link', attrs: { href } } : { type: 'unsafe-link' })
        break
      }
      case 'link_close':
        drop(marks.some((m) => m.type === 'link') ? 'link' : 'unsafe-link')
        break
      case 'image':
        // Images inside notes show as their alt text; images are cards.
        push(t.content || t.attrGet('alt') || '')
        break
    }
  }
  // An unsafe link keeps its text but loses the link.
  for (const n of out) if (n.marks) n.marks = n.marks.filter((m) => m.type !== 'unsafe-link')
  return out
}

const TASK = /^\[( |x|X)\]\s/

/** Turn a list item whose text starts with "[ ] " / "[x] " into a task item. */
function asTask(item: RichNode, line: number): RichNode {
  const first = item.content?.[0]
  const text = first?.type === 'paragraph' ? first.content?.[0] : undefined
  const m = text?.type === 'text' && text.text ? TASK.exec(text.text) : null
  if (!m || !text) return item
  text.text = text.text!.slice(m[0].length)
  if (!text.text) first!.content!.shift()
  return { type: 'task_item', attrs: { checked: m[1] !== ' ', line }, content: item.content }
}

function blocks(tokens: Token[]): RichNode[] {
  const root: RichNode = { type: 'doc', content: [] }
  const stack: { node: RichNode; line: number }[] = [{ node: root, line: 0 }]
  const top = () => stack[stack.length - 1].node
  const open = (node: RichNode, line = 0) => {
    ;(top().content ??= []).push(node)
    stack.push({ node, line })
  }
  const close = () => {
    const { node, line } = stack.pop()!
    if (node.type === 'list_item') {
      const parent = top()
      parent.content![parent.content!.length - 1] = asTask(node, line)
    }
  }
  for (const t of tokens) {
    switch (t.type) {
      case 'paragraph_open':
        open({ type: 'paragraph', content: [] })
        break
      case 'heading_open':
        open({ type: 'heading', attrs: { level: Number(t.tag.slice(1)) }, content: [] })
        break
      case 'bullet_list_open':
        open({ type: 'bullet_list', content: [] })
        break
      case 'ordered_list_open':
        open({ type: 'ordered_list', attrs: { start: Number(t.attrGet('start') ?? 1) }, content: [] })
        break
      case 'list_item_open':
        open({ type: 'list_item', content: [] }, t.map?.[0] ?? 0)
        break
      case 'blockquote_open':
        open({ type: 'blockquote', content: [] })
        break
      case 'table_open':
        open({ type: 'table', content: [] })
        break
      case 'tr_open':
        open({ type: 'table_row', content: [] })
        break
      case 'th_open':
      case 'td_open':
        open({ type: 'table_cell', attrs: { header: t.type === 'th_open' }, content: [] })
        break
      case 'paragraph_close':
      case 'heading_close':
      case 'bullet_list_close':
      case 'ordered_list_close':
      case 'list_item_close':
      case 'blockquote_close':
      case 'table_close':
      case 'tr_close':
      case 'th_close':
      case 'td_close':
        close()
        break
      case 'inline':
        ;(top().content ??= []).push(...inline(t.children ?? []))
        break
      case 'fence':
      case 'code_block':
        ;(top().content ??= []).push({ type: 'code_block', content: [{ type: 'text', text: t.content.replace(/\n$/, '') }] })
        break
      case 'hr':
        ;(top().content ??= []).push({ type: 'horizontal_rule' })
        break
      case 'html_block':
        ;(top().content ??= []).push({ type: 'paragraph', content: [{ type: 'text', text: t.content.replace(/\n$/, '') }] })
        break
      // thead/tbody wrappers are flattened away.
    }
  }
  return root.content ?? []
}

/** Markdown → sanitized tree for rendering. Task items carry their source line for toggling. */
export function parseMarkdown(source: string): RichDoc {
  return sanitizeDoc({ type: 'doc', content: blocks(md.parse(source ?? '', {})) })
}

/** Plain text of a markdown note, for search, previews and trash labels. */
export function mdToText(source: string): string {
  return docToText(parseMarkdown(source))
}

/** Flip the checkbox of the task on `line` (0-based). Returns the source unchanged if there isn't one. */
export function toggleTask(source: string, line: number): string {
  const lines = source.split('\n')
  const l = lines[line]
  if (l === undefined) return source
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/.exec(l)
  if (!m) return source
  const next = m[2] === ' ' ? 'x' : ' '
  lines[line] = `${m[1]}[${next}]${l.slice(m[0].length)}`
  return lines.join('\n')
}

// ---- legacy notes (ProseMirror JSON) ------------------------------------------

function inlineMd(nodes: RichNode[] | undefined): string {
  let s = ''
  for (const n of nodes ?? []) {
    if (n.type === 'hard_break') {
      s += '\n'
      continue
    }
    let t = (n.text ?? '').replace(/([\\`*_~[\]])/g, '\\$1')
    for (const m of n.marks ?? []) {
      if (m.type === 'strong') t = `**${t}**`
      else if (m.type === 'em') t = `_${t}_`
      else if (m.type === 'strike') t = `~~${t}~~`
      else if (m.type === 'code') t = `\`${n.text}\``
      else if (m.type === 'link' && safeHref(m.attrs?.href)) t = `[${t}](${safeHref(m.attrs?.href)})`
    }
    s += t
  }
  return s
}

function blockMd(n: RichNode, indent = ''): string {
  switch (n.type) {
    case 'paragraph':
      return indent + inlineMd(n.content).replace(/\n/g, `\n${indent}`)
    case 'heading':
      return `${'#'.repeat(Number(n.attrs?.level) || 1)} ${inlineMd(n.content)}`
    case 'blockquote':
      return (n.content ?? []).map((c) => blockMd(c)).join('\n\n').replace(/^/gm, '> ')
    case 'bullet_list':
    case 'ordered_list':
      return (n.content ?? [])
        .map((item, i) => {
          const marker = n.type === 'bullet_list' ? '- ' : `${i + 1}. `
          const [first, ...rest] = (item.content ?? []).map((c) => blockMd(c, ' '.repeat(marker.length)))
          return `${indent}${marker}${(first ?? '').trimStart()}${rest.length ? `\n${rest.join('\n')}` : ''}`
        })
        .join('\n')
    default:
      return inlineMd(n.content)
  }
}

/** Convert a legacy ProseMirror-JSON note to markdown. */
export function docToMarkdown(doc: RichDoc | undefined): string {
  return (sanitizeDoc(doc).content ?? []).map((n) => blockMd(n)).join('\n\n')
}

/** A note's markdown, converting legacy content on the fly. */
export function noteMarkdown(card: Card<'note'>): string {
  const c = card.content as { md?: string; doc?: RichDoc }
  return typeof c.md === 'string' ? c.md : docToMarkdown(c.doc)
}
