import { createEffect } from 'solid-js'
import { sanitizeDoc, type RichDoc, type RichNode } from '@doggynote/core'

// Static renderer for note bodies. Builds DOM from the sanitized tree (see
// core/markdown.ts) with createElement/textContent only, so synced content can
// never inject markup, and notes render without loading the editor.

const BLOCK_TAG: Record<string, string> = {
  paragraph: 'p',
  bullet_list: 'ul',
  ordered_list: 'ol',
  list_item: 'li',
  task_item: 'li',
  blockquote: 'blockquote',
  horizontal_rule: 'hr',
  table: 'table',
  table_row: 'tr',
}
const MARK_TAG: Record<string, string> = { strong: 'strong', em: 'em', code: 'code', strike: 's' }

function build(n: RichNode, onToggleTask?: (line: number) => void): Node {
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
  if (n.type === 'code_block') {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = n.content?.[0]?.text ?? ''
    pre.append(code)
    return pre
  }
  if (n.type === 'table_cell') {
    const cell = document.createElement(n.attrs?.header ? 'th' : 'td')
    for (const c of n.content ?? []) cell.append(build(c, onToggleTask))
    return cell
  }
  const tag = n.type === 'heading' ? `h${n.attrs?.level ?? 1}` : (BLOCK_TAG[n.type] ?? 'div')
  const el = document.createElement(tag)
  if (n.type === 'ordered_list' && Number(n.attrs?.start) > 1) (el as HTMLOListElement).start = Number(n.attrs!.start)
  if (n.type === 'task_item') {
    el.className = 'task'
    el.classList.toggle('done', n.attrs?.checked === true)
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'task-check'
    box.checked = n.attrs?.checked === true
    box.dataset.nodrag = ''
    box.dataset.testid = 'task-check'
    box.disabled = !onToggleTask
    const line = Number(n.attrs?.line)
    box.addEventListener('change', () => onToggleTask?.(line))
    el.append(box)
  }
  for (const c of n.content ?? []) el.append(build(c, onToggleTask))
  if (n.type === 'paragraph' && !n.content?.length) el.append(document.createElement('br'))
  return el
}

export function RichText(props: { doc: RichDoc | undefined; placeholder?: string; onToggleTask?: (line: number) => void }) {
  let el!: HTMLDivElement
  createEffect(() => {
    const doc = sanitizeDoc(props.doc)
    const frag = document.createDocumentFragment()
    for (const n of doc.content ?? []) frag.append(build(n, props.onToggleTask))
    el.replaceChildren(frag)
    el.classList.toggle('is-empty', !(doc.content ?? []).some((n) => n.content?.length || n.type === 'horizontal_rule'))
  })
  return <div ref={el} class="rich" data-placeholder={props.placeholder ?? ''} />
}
