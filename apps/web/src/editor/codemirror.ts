// The note editor: CodeMirror 6 editing plain markdown, with an Obsidian-style
// live preview. Loaded with a dynamic import only when a note enters edit
// mode, so people who are just looking never download it.
//
// Live preview: headings, bold, italic, strikethrough, code, links and quotes
// are styled in place. Their markdown markers are hidden everywhere except on
// the line(s) the cursor is on, where they show faded so you can edit them.
// Bullets render as dots and "[ ]" as a clickable checkbox off the active line.

import { EditorSelection, EditorState, type Extension, type Range, type StateCommand } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { insertNewlineContinueMarkup, markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'

// ---- live preview ------------------------------------------------------------

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-md-bullet'
    s.textContent = '•'
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
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? '[ ]' : '[x]' } })
    })
    return box
  }
  ignoreEvent() {
    return false
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
const MARKERS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark', 'URL', 'HeaderMark', 'QuoteMark'])

function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  if (!view.hasFocus) return lines
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number
    const b = view.state.doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) lines.add(n)
  }
  return lines
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const active = activeLines(view)
  const out: Range<Decoration>[] = []
  const lineOf = (pos: number) => state.doc.lineAt(pos)

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        const line = lineOf(node.from)
        const isActive = active.has(line.number)

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
          if (!isActive) out.push(hidden.range(node.from, node.to))
          return
        }
        if (MARK_CLASS[name]) {
          if (node.to > node.from) out.push(Decoration.mark({ class: MARK_CLASS[name] }).range(node.from, node.to))
          return
        }
        if (name === 'ListMark') {
          const text = state.sliceDoc(node.from, node.to)
          const bullet = /^[-*+]$/.test(text)
          // Task list items hide their bullet; the checkbox stands in for it.
          const next = node.node.nextSibling
          const isTask = next?.name === 'Task'
          if (isActive) out.push(faded.range(node.from, node.to))
          else if (isTask) out.push(hidden.range(node.from, Math.min(node.to + 1, line.to)))
          else if (bullet) out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
          return
        }
        if (name === 'TaskMarker') {
          if (isActive) out.push(faded.range(node.from, node.to))
          else {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to))
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to))
            if (checked) {
              const end = lineOf(node.to).to
              if (end > node.to) out.push(Decoration.mark({ class: 'cm-md-done' }).range(node.to, end))
            }
          }
          return
        }
        if (MARKERS.has(name)) {
          // Header and quote marks take their trailing space with them.
          let end = node.to
          if ((name === 'HeaderMark' || name === 'QuoteMark') && state.sliceDoc(end, end + 1) === ' ') end++
          if (end <= node.from) return
          // Hiding a heading's trailing "#"s etc. is fine; never hide across lines.
          if (lineOf(end).number !== line.number) end = line.to
          out.push((isActive ? faded : hidden).range(node.from, end))
        }
      },
    })
  }
  return Decoration.set(out, true)
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) this.decorations = buildDecorations(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)

// ---- formatting commands ----------------------------------------------------------

/** Wrap each selection in `mark` (or unwrap if it's already wrapped). Empty selections get a pair to type into. */
function wrap(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((r) => {
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

export const commands = {
  bold: wrap('**'),
  italic: wrap('_'),
  strike: wrap('~~'),
  code: wrap('`'),
  heading: linePrefix('## '),
  bullets: linePrefix('- '),
  numbers: linePrefix('1. '),
  task: linePrefix('- [ ] '),
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
  destroy(): void
}

export function createEditor(
  mount: HTMLElement,
  md: string,
  opts: { onChange: (md: string) => void; onExit: () => void; placeAt?: { x: number; y: number } },
): NoteEditor {
  const run = (cmd: StateCommand) => (v: EditorView) => cmd({ state: v.state, dispatch: v.dispatch })
  const extensions: Extension[] = [
    history(),
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
      ...markdownKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString())
    }),
  ]
  const view = new EditorView({ parent: mount, state: EditorState.create({ doc: md, extensions }) })
  view.focus()
  // Put the caret where the user clicked, else at the end.
  const pos = opts.placeAt ? view.posAtCoords(opts.placeAt) : null
  view.dispatch({ selection: { anchor: pos ?? view.state.doc.length } })

  return {
    view,
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
    destroy: () => view.destroy(),
  }
}
