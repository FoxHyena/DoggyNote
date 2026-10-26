import { COPY } from '@doggynote/theme'

// Every keyboard shortcut, for the "?" sheet. The handlers live in
// ui/shortcuts.ts, state/clipboard.ts, canvas/Canvas.tsx (Space) and the note
// editor; keep this list in step with them and with the Keyboard shortcuts guide.

/** `mod` is ⌘ on a Mac and Ctrl elsewhere; `shift` and `alt` follow the platform too. */
export type Key = 'mod' | 'shift' | 'alt' | string
export type Shortcut = { keys: Key[]; label: string }
export type ShortcutGroup = { title: string; items: Shortcut[] }

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

/** One key as it's printed on this platform's keyboard. */
export function keyLabel(key: Key, mac = isMac): string {
  if (key === 'mod') return mac ? '⌘' : 'Ctrl'
  if (key === 'shift') return mac ? '⇧' : 'Shift'
  if (key === 'alt') return mac ? '⌥' : 'Alt'
  return key
}

/** Modifiers in the platform's order: ⌥⇧⌘ on a Mac, Ctrl+Shift+Alt elsewhere; the key last. */
export function orderedKeys(keys: Key[], mac = isMac): Key[] {
  const rank: Record<string, number> = mac ? { alt: 0, shift: 1, mod: 2 } : { mod: 0, shift: 1, alt: 2 }
  return [...keys].sort((a, b) => (rank[a] ?? 3) - (rank[b] ?? 3))
}

/** A whole chord as text, e.g. "⇧⌘Z" on a Mac and "Ctrl+Shift+Z" elsewhere. */
export function chordLabel(keys: Key[], mac = isMac): string {
  return orderedKeys(keys, mac).map((k) => keyLabel(k, mac)).join(mac ? '' : '+')
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Add',
    items: [
      { keys: ['N'], label: 'Note' },
      { keys: ['T'], label: 'To-do list' },
      { keys: ['B'], label: 'Board' },
      { keys: ['L'], label: 'Line between two cards' },
    ],
  },
  {
    title: 'Selected cards',
    items: [
      { keys: ['Enter'], label: 'Edit, or open a board' },
      { keys: ['Esc'], label: 'Finish editing, or deselect' },
      { keys: ['Delete'], label: COPY.bury },
      { keys: ['mod', 'D'], label: 'Duplicate' },
      { keys: ['mod', 'A'], label: 'Select all' },
      { keys: ['←↑→↓'], label: 'Nudge' },
      { keys: ['shift', '←↑→↓'], label: 'Nudge further' },
      { keys: ['alt', '←↑→↓'], label: 'Go to the next card' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { keys: ['mod', 'Z'], label: 'Undo' },
      { keys: ['shift', 'mod', 'Z'], label: 'Redo' },
      { keys: ['mod', 'C'], label: 'Copy' },
      { keys: ['mod', 'X'], label: 'Cut' },
      { keys: ['mod', 'V'], label: 'Paste' },
      { keys: ['shift', 'mod', 'V'], label: 'Paste as plain text' },
      { keys: ['mod', 'B'], label: 'Bold, in a note' },
      { keys: ['mod', 'I'], label: 'Italic, in a note' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: ['mod', 'K'], label: COPY.search },
      { keys: ['Space'], label: 'Hold and drag to pan' },
      { keys: ['mod', '='], label: 'Zoom in' },
      { keys: ['mod', '−'], label: 'Zoom out' },
      { keys: ['mod', '0'], label: 'Zoom to 100%' },
      { keys: ['mod', '1'], label: 'Zoom to fit' },
      { keys: ['mod', "'"], label: 'Snap to grid' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ],
  },
]
