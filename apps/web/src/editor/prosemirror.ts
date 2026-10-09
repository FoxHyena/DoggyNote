// Loaded with a dynamic import only when a note enters edit mode, so the
// ~100 KB of ProseMirror never loads for people who are just looking.

import { Schema, type MarkSpec } from 'prosemirror-model'
import { nodes as basicNodes, marks as basicMarks } from 'prosemirror-schema-basic'
import { addListNodes, liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list'
import { EditorState, Plugin, Selection, TextSelection, type Command } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import type { MarkType } from 'prosemirror-model'
import { safeHref, sanitizeDoc, type RichDoc } from '@doggynote/core'
import OrderedMap from 'orderedmap'

const strike: MarkSpec = {
  parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
  toDOM: () => ['s', 0],
}

const baseNodes = OrderedMap.from({
  doc: basicNodes.doc,
  paragraph: basicNodes.paragraph,
  blockquote: basicNodes.blockquote,
  heading: { ...basicNodes.heading, attrs: { level: { default: 1 } } },
  text: basicNodes.text,
  hard_break: basicNodes.hard_break,
})

export const schema = new Schema({
  nodes: addListNodes(baseNodes, 'paragraph block*', 'block'),
  marks: { strong: basicMarks.strong, em: basicMarks.em, code: basicMarks.code, link: basicMarks.link, strike },
})

/** `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` as you type. */
function markRule(re: RegExp, mark: MarkType) {
  return new InputRule(re, (state, match, start, end) => {
    const inner = match[1]
    return state.tr.replaceWith(start, end, schema.text(inner, [mark.create()])).removeStoredMark(mark)
  })
}

const rules = inputRules({
  rules: [
    textblockTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*([-*])\s$/, schema.nodes.bullet_list),
    wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list),
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
    markRule(/\*\*([^*]+)\*\*$/, schema.marks.strong),
    markRule(/(?<![*\w])\*([^*\s][^*]*)\*$/, schema.marks.em),
    markRule(/~~([^~]+)~~$/, schema.marks.strike),
    markRule(/`([^`]+)`$/, schema.marks.code),
  ],
})

/** Pasting a URL over selected text links it instead of replacing it. */
const linkOnPaste = new Plugin({
  props: {
    handlePaste(view, event) {
      const text = event.clipboardData?.getData('text/plain')?.trim()
      const href = text ? safeHref(text) : null
      const { from, to, empty } = view.state.selection
      if (!href || empty) return false
      view.dispatch(view.state.tr.addMark(from, to, schema.marks.link.create({ href })))
      return true
    },
  },
})

export const commands = {
  bold: toggleMark(schema.marks.strong),
  italic: toggleMark(schema.marks.em),
  strike: toggleMark(schema.marks.strike),
  heading: ((state, dispatch) => {
    const { $from } = state.selection
    const isH = $from.parent.type === schema.nodes.heading
    return setBlockType(isH ? schema.nodes.paragraph : schema.nodes.heading, isH ? undefined : { level: 2 })(state, dispatch)
  }) as Command,
  bullets: wrapInList(schema.nodes.bullet_list),
  numbers: wrapInList(schema.nodes.ordered_list),
}

export type NoteEditor = {
  view: EditorView
  run(cmd: keyof typeof commands): void
  /** Replay typed text as if typed: input rules fire and newlines act like Enter. */
  typeText(text: string): void
  selectAll(): void
  destroy(): void
}

const enter = chainEnter()
function chainEnter(): Command {
  const split = splitListItem(schema.nodes.list_item)
  return (state, dispatch, view) => split(state, dispatch, view) || baseKeymap.Enter(state, dispatch, view)
}

export function createEditor(
  mount: HTMLElement,
  initial: RichDoc,
  opts: { onChange: (doc: RichDoc) => void; onExit: () => void; placeAt?: { x: number; y: number } },
): NoteEditor {
  const doc = schema.nodeFromJSON(
    sanitizeDoc(initial).content?.length ? sanitizeDoc(initial) : { type: 'doc', content: [{ type: 'paragraph' }] },
  )
  const state = EditorState.create({
    doc,
    plugins: [
      rules,
      linkOnPaste,
      keymap({
        'Mod-z': undo,
        'Mod-Shift-z': redo,
        'Mod-y': redo,
        'Mod-b': commands.bold,
        'Mod-i': commands.italic,
        'Mod-Shift-x': commands.strike,
        Enter: enter,
        Tab: sinkListItem(schema.nodes.list_item),
        'Shift-Tab': liftListItem(schema.nodes.list_item),
        Escape: () => {
          opts.onExit()
          return true
        },
      }),
      keymap(baseKeymap),
      history(),
    ],
  })
  const view = new EditorView(mount, {
    state,
    attributes: { class: 'rich pm', 'data-testid': 'note-editor', spellcheck: 'true' },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr)
      view.updateState(next)
      if (tr.docChanged) opts.onChange(next.doc.toJSON() as RichDoc)
    },
  })
  view.focus()
  // Put the caret where the user clicked, else at the end.
  const pos = opts.placeAt ? view.posAtCoords({ left: opts.placeAt.x, top: opts.placeAt.y })?.pos : undefined
  const sel = TextSelection.create(view.state.doc, pos ?? view.state.doc.content.size - 1)
  view.dispatch(view.state.tr.setSelection(sel))

  return {
    view,
    run(cmd) {
      commands[cmd](view.state, view.dispatch, view)
      view.focus()
    },
    typeText(text) {
      for (const ch of text) {
        if (ch === '\n') {
          enter(view.state, view.dispatch, view)
          continue
        }
        const { from, to } = view.state.selection
        const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))
        if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
      }
    },
    selectAll() {
      // A text selection spanning every block, so the next keystroke replaces it
      // the way it does after a real ⌘A.
      const d = view.state.doc
      view.dispatch(view.state.tr.setSelection(TextSelection.between(Selection.atStart(d).$from, Selection.atEnd(d).$to)))
    },
    destroy: () => view.destroy(),
  }
}

/** Backspace: delete the selection, or one character back. */
export function backspace(view: EditorView) {
  const { state } = view
  if (!state.selection.empty) view.dispatch(state.tr.deleteSelection())
  else baseKeymap.Backspace(state, view.dispatch, view)
}
