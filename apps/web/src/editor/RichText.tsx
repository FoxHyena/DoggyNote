import { createEffect } from 'solid-js'
import { sanitizeDoc, type RichDoc, type RichNode } from '@doggynote/core'

// Static renderer for note bodies. Builds DOM from sanitised ProseMirror JSON
// with createElement/textContent only, so synced content can never inject
// markup, and notes render without loading ProseMirror.

const BLOCK_TAG: Record<string, string> = {
  paragraph: 'p',
  bullet_list: 'ul',
  ordered_list: 'ol',
  list_item: 'li',
  blockquote: 'blockquote',
}
const MARK_TAG: Record<string, string> = { strong: 'strong', em: 'em', code: 'code', strike: 's' }

function build(n: RichNode): Node {
  if (n.type === 'text') {
    let node: Node = document.createTextNode(n.text ?? '')
    for (const m of n.marks ?? []) {
      let el: HTMLElement
      if (m.type === 'link') {
        const a = document.createElement('a')
        a.href = String(m.attrs?.href)
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.dataset.nodrag = ''
        el = a
      } else el = document.createElement(MARK_TAG[m.type] ?? 'span')
      el.append(node)
      node = el
    }
    return node
  }
  if (n.type === 'hard_break') return document.createElement('br')
  const tag = n.type === 'heading' ? `h${n.attrs?.level ?? 1}` : (BLOCK_TAG[n.type] ?? 'div')
  const el = document.createElement(tag)
  for (const c of n.content ?? []) el.append(build(c))
  if (n.type === 'paragraph' && !n.content?.length) el.append(document.createElement('br'))
  return el
}

export function RichText(props: { doc: RichDoc | undefined; placeholder?: string }) {
  let el!: HTMLDivElement
  createEffect(() => {
    const doc = sanitizeDoc(props.doc)
    const frag = document.createDocumentFragment()
    for (const n of doc.content ?? []) frag.append(build(n))
    el.replaceChildren(frag)
    el.classList.toggle('is-empty', !(doc.content ?? []).some((n) => n.content?.length))
  })
  return <div ref={el} class="rich" data-placeholder={props.placeholder ?? ''} />
}
