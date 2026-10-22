import { Show } from 'solid-js'
import { clearDone, settleItems, type Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { showToast } from '../state/toast.ts'
import { editingId, endEdit } from '../state/ui.ts'
import { BarMenu } from './BarMenu.tsx'
import { Icon } from './icons.tsx'

// "List" in the selection bar of a to-do card: sort done tasks to the bottom,
// fold them away, or clear them. Each is one undo step.

export function TodoOptions(props: { card: Card<'todo'> }) {
  return <BarMenu label="List" title="List options" testId="todo-options" menuTestId="todo-options-menu" icon={<Icon size={18} name="sliders" />}>
    {(close) => <TodoMenuItems card={props.card} close={close} />}
  </BarMenu>
}

export function TodoMenuItems(props: { card: Card<'todo'>; close: () => void }) {
  const content = () => props.card.content
  const sorting = () => content().sortDone !== false
  const done = () => content().items.filter((i) => i.done).length
  const set = (next: Partial<Card<'todo'>['content']>, finishTyping = false) => {
    // Folding or clearing while typing in the list: finish typing first, so the
    // change shows at once and ⌘Z undoes it.
    if (finishTyping && editingId() === props.card.id) endEdit()
    doc.update({ [props.card.id]: { content: { ...content(), ...next } } as Partial<Card> })
  }
  // Turning sorting on tidies the list in the same step.
  const toggleSort = () => set(sorting() ? { sortDone: false } : { sortDone: true, items: settleItems(content().items) })
  const clear = () => {
    const n = done()
    set({ items: clearDone(content().items) }, true)
    showToast(`Cleared ${n} done ${n === 1 ? 'task' : 'tasks'}`, 5000, { label: 'Undo', run: () => doc.undo() })
  }
  const check = (on: boolean) => <span class="menu-check" aria-hidden="true"><Show when={on}><Icon size={16} name="check" /></Show></span>

  return (
    <>
          <button class="menu-item" role="menuitemcheckbox" aria-checked={sorting()} data-testid="todo-sort-done" onClick={toggleSort}>
            {check(sorting())}
            Sort done to the bottom
          </button>
          <button class="menu-item" role="menuitemcheckbox" aria-checked={!!content().hideDone} data-testid="todo-hide-done" onClick={() => set({ hideDone: !content().hideDone }, true)}>
            {check(!!content().hideDone)}
            Fold away done tasks
          </button>
          <div class="menu-sep" role="separator" />
          <button class="menu-item" role="menuitem" data-testid="todo-clear-done" disabled={!done()} onClick={() => { clear(); props.close() }}>
            <span class="menu-check" aria-hidden="true"><Icon size={16} name="bury" /></span>
            {done() ? `Clear ${done()} done` : 'Nothing done yet'}
          </button>
    </>
  )
}
