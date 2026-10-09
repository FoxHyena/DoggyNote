import { describe, expect, it } from 'vitest'
import { docToMarkdown, mdToText, noteMarkdown, parseMarkdown, toggleTask, type Card, type RichNode } from './index.ts'

const types = (nodes: RichNode[] | undefined): string[] => (nodes ?? []).map((n) => n.type)

describe('parseMarkdown', () => {
  it('parses headings, lists, quotes, code, rules and tables', () => {
    const doc = parseMarkdown('# Title\n\n- one\n- two\n\n1. first\n\n> quoted\n\n```\ncode\n```\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(types(doc.content)).toEqual(['heading', 'bullet_list', 'ordered_list', 'blockquote', 'code_block', 'horizontal_rule', 'table'])
    expect(doc.content![0].attrs).toEqual({ level: 1 })
    expect(doc.content![4].content![0].text).toBe('code')
  })

  it('keeps inline marks', () => {
    const p = parseMarkdown('**bold** _it_ ~~gone~~ `x` [dog](https://dog.example/)').content![0]
    const marks = p.content!.filter((n) => n.marks).map((n) => n.marks!.map((m) => m.type).join('+'))
    expect(marks).toEqual(['strong', 'em', 'strike', 'code', 'link'])
  })

  it('turns "- [ ]" items into tasks that remember their source line', () => {
    const doc = parseMarkdown('Shopping\n\n- [ ] treats\n- [x] ball\n- plain')
    const list = doc.content![1]
    expect(types(list.content)).toEqual(['task_item', 'task_item', 'list_item'])
    expect(list.content![0].attrs).toEqual({ checked: false, line: 2 })
    expect(list.content![1].attrs).toEqual({ checked: true, line: 3 })
    expect(list.content![0].content![0].content![0].text).toBe('treats')
  })

  it('never produces markup from raw HTML or unsafe links', () => {
    const doc = parseMarkdown('<script>alert(1)</script>\n\n[click](javascript:alert(1)) <img src=x onerror=alert(1)>')
    const json = JSON.stringify(doc)
    expect(json).not.toContain('"type":"script"')
    expect(json).toContain('<script>alert(1)</script>') // shown as text
    // At most visible text, never a link target.
    expect(json).not.toMatch(/"href":"javascript:/i)
    expect(json).not.toContain('"marks":[{"type":"link"')
  })

  it('single newlines are line breaks (notes, not documents)', () => {
    expect(types(parseMarkdown('one\ntwo').content![0].content)).toEqual(['text', 'hard_break', 'text'])
  })
})

describe('helpers', () => {
  it('mdToText strips formatting', () => {
    expect(mdToText('# Walkies\n\n- [ ] **leash**')).toBe('Walkies\nleash')
  })

  it('toggleTask flips exactly that line', () => {
    const src = 'todo\n- [ ] a\n  * [x] b\n1. [ ] c'
    expect(toggleTask(src, 1)).toBe('todo\n- [x] a\n  * [x] b\n1. [ ] c')
    expect(toggleTask(src, 2)).toBe('todo\n- [ ] a\n  * [ ] b\n1. [ ] c')
    expect(toggleTask(src, 3)).toBe('todo\n- [ ] a\n  * [x] b\n1. [x] c')
    expect(toggleTask(src, 0)).toBe(src)
  })

  it('docToMarkdown converts legacy notes', () => {
    const md = docToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plans' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'go ' }, { type: 'text', text: 'now', marks: [{ type: 'strong' }] }] },
        { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'park' }] }] }] },
      ],
    })
    expect(md).toBe('## Plans\n\ngo **now**\n\n- park')
    // And it round-trips through the parser to the same text.
    expect(mdToText(md)).toBe('Plans\ngo now\npark')
  })

  it('noteMarkdown prefers md and falls back to legacy doc', () => {
    expect(noteMarkdown({ content: { md: 'hi' } } as Card<'note'>)).toBe('hi')
    expect(noteMarkdown({ content: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }] } } } as unknown as Card<'note'>)).toBe('old')
  })
})
