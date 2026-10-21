// The note editor: CodeMirror 6 editing plain markdown, with an Obsidian-style
// live preview. Loaded with a dynamic import only when a note enters edit
// mode, so people who are just looking never download it.
//
// Live preview: headings, bold, italic, strikethrough, code, links and quotes
// are styled in place, on every line. Their markdown markers stay hidden unless
// the caret or selection touches that exact piece of syntax (the bold word, the
// link, the "# "), where they show faded so you can edit them. Bullets, task
// boxes and rules always render; nested list items indent by depth. Hidden
// ranges are atomic, so Backspace can't silently eat a marker.

import { EditorSelection, EditorState, RangeSetBuilder, type Extension, type Range, type SelectionRange, type StateCommand } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { insertNewlineContinueMarkup, markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { indentListItems } from '@doggynote/core'
import type * as Y from 'yjs'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type { Awareness } from 'y-protocols/awareness'

// ---- live preview ------------------------------------------------------------

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>

const BULLETS = ['•', '◦', '▪']

class BulletWidget extends WidgetType {
  readonly depth: number
  constructor(depth: number) {
    super()
    this.depth = depth
  }
  eq(o: BulletWidget) {
    return o.depth === this.depth
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = BULLETS[this.depth % BULLETS.length]
    return s
  }
}

class CheckboxWidget extends WidgetType {
  readonly checked: boolean
  readonly pos: number
  constructor(checked: boolean, pos: number) {
    super()
    this.checked = checked
    this.pos = pos
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.pos === this.pos
  }
  toDOM(view: EditorView) {
    // In a fixed-width slot, where a bullet would be, so wrapped lines line up.
    const slot = document.createElement('span')
    slot.className = 'cm-md-taskslot'
    const box = document.createElement('input')
    slot.append(box)
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    // pointerdown, not mousedown: touch sends mouse events late or not at all.
    box.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      view.dispatch({ changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? '[ ]' : '[x]' } })
    })
    // The change above already toggled it; the click must not toggle the box back.
    box.addEventListener('click', (e) => e.preventDefault())
    return slot
  }
  ignoreEvent() {
    return true
  }
}

const hidden = Decoration.replace({})
const faded = Decoration.mark({ class: 'cm-md-mark' })
const MARK_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-em',
  Strikethrough: 'cm-md-strike',
  InlineCode: 'cm-md-code',
  Link: 'cm-md-link',
}
const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark', 'URL'])
const LINE_MARKS = new Set(['HeaderMark', 'QuoteMark'])

/** List nesting depth of a node: 0 for a top-level item. */
function listDepth(node: SyntaxNode | null): number {
  let depth = -1
  for (let n = node; n; n = n.parent) if (n.name === 'ListItem') depth++
  return Math.max(0, depth)
}

function buildDecorations(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
  const { state } = view
  const ranges = view.hasFocus ? state.selection.ranges : []
  /** Does the caret or selection touch [from, to]? */
  const touched = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)
  const out: Range<Decoration>[] = []
  const lineOf = (pos: number) => state.doc.lineAt(pos)
  const tree = syntaxTree(state)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        const line = lineOf(node.from)

        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name)
        if (heading) {
          out.push(Decoration.line({ class: `cm-md-h${heading[1]}` }).range(line.from))
          return
        }
        if (name === 'Blockquote' || name === 'FencedCode') {
          for (let pos = node.from; pos <= node.to; ) {
            const l = lineOf(pos)
            out.push(Decoration.line({ class: name === 'Blockquote' ? 'cm-md-quote' : 'cm-md-codeblock' }).range(l.from))
            pos = l.to + 1
          }
          return name !== 'FencedCode' // don't style markers inside code blocks
        }
        if (name === 'HorizontalRule') {
          out.push(Decoration.line({ class: 'cm-md-hr' }).range(line.from))
          if (!touched(node.from, node.to)) out.push(hidden.range(node.from, node.to))
          return
        }
        if (MARK_CLASS[name]) {
          if (node.to > node.from) out.push(Decoration.mark({ class: MARK_CLASS[name] }).range(node.from, node.to))
          return
        }
        if (name === 'ListMark') {
          const text = state.sliceDoc(node.from, node.to)
          // Task list items hide their bullet; the checkbox stands in for it.
          if (node.node.nextSibling?.name === 'Task') out.push(hidden.range(node.from, Math.min(node.to + 1, line.to)))
          else if (/^[-*+]$/.test(text)) out.push(Decoration.replace({ widget: new BulletWidget(listDepth(node.node)) }).range(node.from, Math.min(node.to + 1, line.to)))
          else out.push(Decoration.mark({ class: 'cm-md-num' }).range(node.from, Math.min(node.to + 1, line.to)))
          return
        }
        if (name === 'TaskMarker') {
          const checked = /x/i.test(state.sliceDoc(node.from, node.to))
          const end = Math.min(node.to + 1, lineOf(node.to).to)
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, end))
          if (checked && lineOf(node.to).to > end) out.push(Decoration.mark({ class: 'cm-md-done' }).range(end, lineOf(node.to).to))
          return
        }
        if (INLINE_MARKS.has(name)) {
          // Revealed while the caret touches the bold word, the code span, the link…
          const owner = node.node.parent ?? node.node
          if (node.to > node.from) out.push((touched(owner.from, owner.to) ? faded : hidden).range(node.from, node.to))
          return
        }
        if (LINE_MARKS.has(name)) {
          // "# " and "> " take their trailing space with them, never across lines.
          let end = node.to
          if (state.sliceDoc(end, end + 1) === ' ') end++
          if (lineOf(end).number !== line.number) end = line.to
          if (end > node.from) out.push((touched(node.from, end) ? faded : hidden).range(node.from, end))
        }
      },
    })
    // Nested list items: hide the leading spaces and indent by depth instead, with
    // a hanging indent so wrapped lines line up with the text, as in the rendered note.
    for (let pos = from; pos <= to; ) {
      const line = lineOf(pos)
      pos = line.to + 1
      const lead = /^ */.exec(line.text)![0].length
      if (lead === line.length) continue
      let item: SyntaxNode | null = tree.resolveInner(line.from + lead, 1)
      while (item && item.name !== 'ListItem') item = item.parent
      if (!item) continue
      const depth = listDepth(item)
      const first = item.from === line.from + lead
      if (lead) out.push(hidden.range(line.from, line.from + lead))
      out.push(Decoration.line({ class: 'cm-md-li', attributes: { style: `--li-depth: ${depth + 1}` + (first ? '' : '; text-indent: 0') } }).range(line.from))
    }
  }
  const decorations = Decoration.set(out, true)
  // Everything replaced (hidden markers, bullets, boxes) is one unit to the caret.
  const atomic = new RangeSetBuilder<Decoration>()
  decorations.between(0, state.doc.length, (from, to, value) => {
    if (to > from && (value.spec.widget || value === hidden)) atomic.add(from, to, value)
  })
  return { decorations, atomic: atomic.finish() }
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    atomic: DecorationSet
    constructor(view: EditorView) {
      ;({ decorations: this.decorations, atomic: this.atomic } = buildDecorations(view))
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) ({ decorations: this.decorations, atomic: this.atomic } = buildDecorations(u.view))
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
)

// ---- formatting commands ----------------------------------------------------------

/** Wrap each selection in `mark` (or unwrap if it's already wrapped). Empty selections get a pair to type into. */
/**
 * Keep inline marks inside a line's block syntax and off the edges of the
 * selection: bolding a whole heading line gives "# **Title**", not
 * "**# Title**" (which is no longer a heading).
 */
function inlineRange(state: EditorState, r: SelectionRange): SelectionRange {
  if (r.empty) return r
  let { from, to } = r
  const line = state.doc.lineAt(from)
  const prefix = line.from + (LINE_PREFIX.exec(line.text)?.[0].length ?? 0)
  if (from < prefix && to > prefix) from = prefix
  while (from < to && /\s/.test(state.sliceDoc(from, from + 1))) from++
  while (to > from && /\s/.test(state.sliceDoc(to - 1, to))) to--
  return from < to ? EditorSelection.range(from, to) : r
}

function wrap(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((whole) => {
      const r = inlineRange(state, whole)
      const before = state.sliceDoc(r.from - mark.length, r.from)
      const after = state.sliceDoc(r.to, r.to + mark.length)
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: r.from - mark.length, to: r.from },
            { from: r.to, to: r.to + mark.length },
          ],
          range: EditorSelection.range(r.from - mark.length, r.to - mark.length),
        }
      }
      return {
        changes: [
          { from: r.from, insert: mark },
          { from: r.to, insert: mark },
        ],
        range: EditorSelection.range(r.from + mark.length, r.to + mark.length),
      }
    })
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

const LINE_PREFIX = /^(\s*)(#{1,6}\s|[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s|>\s)?/

/** Toggle a line prefix ("## ", "- ", "1. ", "- [ ] ") on every selected line, replacing any other. */
function linePrefix(prefix: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes: { from: number; to: number; insert: string }[] = []
    const seen = new Set<number>()
    for (const r of state.selection.ranges) {
      for (let pos = r.from; pos <= r.to; ) {
        const line = state.doc.lineAt(pos)
        if (!seen.has(line.number)) {
          seen.add(line.number)
          const m = LINE_PREFIX.exec(line.text)!
          const current = m[2] ?? ''
          const from = line.from + m[1].length
          changes.push({ from, to: from + current.length, insert: current === prefix ? '' : prefix })
        }
        pos = line.to + 1
      }
    }
    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

/**
 * Tab / Shift-Tab: nest or un-nest the list items under the selection. Inside
 * a code block Tab indents; anywhere else it does nothing, but it never moves
 * focus out of the note.
 */
function indentList(dir: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    const doc = state.doc
    const edits = new Map<number, { from: number; to: number; insert: string }>()
    let inList = false
    for (const r of state.selection.ranges) {
      const a = doc.lineAt(r.from).number - 1
      const b = doc.lineAt(r.to).number - 1
      const found = indentListItems(doc.toString(), a, b, dir)
      if (!found) continue
      inList = true
      for (const e of found) {
        const line = doc.line(e.line + 1)
        edits.set(e.line, { from: line.from + e.from, to: line.from + e.to, insert: e.insert })
      }
    }
    if (inList) {
      if (edits.size) dispatch(state.update({ changes: [...edits.values()], userEvent: 'input.indent' }))
      return true
    }
    const inCode = state.selection.ranges.some((r) => {
      for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(r.head, -1); n; n = n.parent) if (n.name === 'FencedCode') return true
      return false
    })
    if (inCode && dir === 1) dispatch(state.update(state.replaceSelection('  '), { userEvent: 'input' }))
    return true
  }
}

/** Backspace right after a heading's "# " turns it back into a paragraph. */
const deleteHeadingMarkBackward: StateCommand = ({ state, dispatch }) => {
  const r = state.selection.main
  if (!r.empty || state.selection.ranges.length > 1) return false
  const line = state.doc.lineAt(r.head)
  const m = /^#{1,6} +/.exec(line.text)
  if (!m || r.head !== line.from + m[0].length) return false
  dispatch(state.update({ changes: { from: line.from, to: r.head }, userEvent: 'delete' }))
  return true
}

/**
 * Backspace at the start of a list item's text: a nested item moves out a level;
 * a top-level one becomes a plain line of its own (a blank line before it keeps
 * markdown from folding it into the line above).
 */
const deleteListMarkBackward: StateCommand = (target) => {
  const { state, dispatch } = target
  const r = state.selection.main
  if (!r.empty || state.selection.ranges.length > 1) return false
  const line = state.doc.lineAt(r.head)
  const m = /^(\s*)(?:[-*+]|\d{1,9}[.)])(?: \[[ xX]\])? +/.exec(line.text)
  if (!m || r.head !== line.from + m[0].length) return false
  if (m[1].length) return indentList(-1)(target)
  const prev = line.number > 1 ? state.doc.line(line.number - 1).text : ''
  const gap = prev.trim() ? state.lineBreak : ''
  dispatch(state.update({ changes: { from: line.from, to: r.head, insert: gap }, selection: { anchor: line.from + gap.length }, userEvent: 'delete' }))
  return true
}

export const commands = {
  bold: wrap('**'),
  italic: wrap('_'),
  strike: wrap('~~'),
  code: wrap('`'),
  heading: linePrefix('## '),
  bullets: linePrefix('- '),
  numbers: linePrefix('1. '),
  task: linePrefix('- [ ] '),
  indent: indentList(1),
  outdent: indentList(-1),
}
export type FormatCommand = keyof typeof commands

// ---- editor ---------------------------------------------------------------------

const theme = EditorView.theme({
  '&': { background: 'transparent', color: 'inherit', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.45', overflow: 'visible' },
  '.cm-content': { padding: '0', caretColor: 'currentColor', fontFamily: 'inherit' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'currentColor' },
})

export type NoteEditor = {
  view: EditorView
  run(cmd: FormatCommand): void
  /** Replay typed text as if typed: newlines continue lists like Enter does. */
  typeText(text: string): void
  selectAll(): void
  backspace(): void
  flush(): void
  destroy(): void
}

export function createEditor(
  mount: HTMLElement,
  md: string,
  opts: { onChange: (md: string) => void; onExit: () => void; onComposition?: (active: boolean) => void; placeAt?: { x: number; y: number }; shared?: { text: Y.Text; awareness: Awareness; undoManager: Y.UndoManager } },
): NoteEditor {
  let compositionEnd: ReturnType<typeof setTimeout> | undefined
  const run = (cmd: StateCommand) => (v: EditorView) => cmd({ state: v.state, dispatch: v.dispatch })
  const extensions: Extension[] = [
    EditorView.domEventHandlers({
      compositionstart() { clearTimeout(compositionEnd); opts.onComposition?.(true) },
      // Native compositionend can precede its final DOM input transaction.
      compositionend() { compositionEnd = setTimeout(() => opts.onComposition?.(false), 50) },
    }),
    ...(opts.shared ? [yCollab(opts.shared.text, opts.shared.awareness, { undoManager: opts.shared.undoManager })] : [history()]),
    markdown({ base: markdownLanguage, addKeymap: false }),
    livePreview,
    EditorView.lineWrapping,
    theme,
    EditorView.contentAttributes.of({ 'data-testid': 'note-editor', spellcheck: 'true', 'aria-label': 'Note' }),
    keymap.of([
      { key: 'Escape', run: () => (opts.onExit(), true) },
      { key: 'Mod-b', run: run(commands.bold) },
      { key: 'Mod-i', run: run(commands.italic) },
      { key: 'Mod-Shift-x', run: run(commands.strike) },
      { key: 'Mod-e', run: run(commands.code) },
      { key: 'Tab', run: run(commands.indent), shift: run(commands.outdent) },
      { key: 'Backspace', run: run(deleteHeadingMarkBackward) },
      { key: 'Backspace', run: run(deleteListMarkBackward) },
      ...markdownKeymap,
      ...(opts.shared ? yUndoManagerKeymap : historyKeymap),
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString())
    }),
  ]
  const view = new EditorView({ parent: mount, state: EditorState.create({ doc: md, extensions }) })
  // Put the caret where the user clicked, else at the end. Measured before focus:
  // unfocused, every marker is hidden, so the layout matches the note they tapped.
  const pos = opts.placeAt ? view.posAtCoords(opts.placeAt) : null
  view.focus()
  view.dispatch({ selection: { anchor: pos ?? view.state.doc.length } })
  // CM can postpone native DOM input until the next animation frame. Its
  // observer has no public flush API; keep this bridge isolated and covered by
  // the rapid-exit, reload, IME and slow-IDB regressions when upgrading CM.
  const flush = () => (view as unknown as { observer: { forceFlush(): void } }).observer.forceFlush()

  return {
    view,
    flush,
    run(cmd) {
      commands[cmd]({ state: view.state, dispatch: view.dispatch })
      view.focus()
    },
    typeText(text) {
      for (const ch of text) {
        if (ch === '\n') {
          if (!insertNewlineContinueMarkup(view)) insertNewline(view)
        } else view.dispatch(view.state.replaceSelection(ch))
      }
    },
    selectAll() {
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    },
    backspace() {
      const { from, to } = view.state.selection.main
      if (from !== to) view.dispatch(view.state.replaceSelection(''))
      else if (from > 0) view.dispatch({ changes: { from: from - 1, to: from } })
    },
    destroy: () => { clearTimeout(compositionEnd); flush(); view.destroy(); opts.onComposition?.(false) },
  }
}
