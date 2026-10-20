import { Show, createSignal } from 'solid-js'
import { Portal } from 'solid-js/web'
import { clearDone, settleItems, type Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { showToast } from '../state/toast.ts'
import { installMenu } from './menu.ts'
import { Icon, ToolIcons } from './icons.tsx'

// "List" in the selection bar of a to-do card: sort done tasks to the bottom,
// fold them away, or clear them. Each is one undo step.

export function TodoOptions(props: { card: Card<'todo'> }) {
  const [open, setOpen] = createSignal(false)
  const [at, setAt] = createSignal({ left: 0, top: 0 })
  let menu!: HTMLDivElement
  let trigger!: HTMLButtonElement
  // The bar clips its contents, so the menu lives in a portal, placed under the button.
  installMenu(open, () => setOpen(false), () => menu, () => trigger)
  let wasOpen = false
  const toggle = () => {
    if (wasOpen) return setOpen(false)
    const r = trigger.getBoundingClientRect()
    const width = 240
    const below = r.bottom + 6 + 150 < window.innerHeight
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: below ? r.bottom + 6 : r.top - 6 })
    setOpen(true)
    queueMicrotask(() => {
      if (!below && menu) setAt((a) => ({ ...a, top: r.top - 6 - menu.offsetHeight }))
    })
  }
  const content = () => props.card.content
  const sorting = () => content().sortDone !== false
  const done = () => content().items.filter((i) => i.done).length
  const set = (next: Partial<Card<'todo'>['content']>) => doc.update({ [props.card.id]: { content: { ...content(), ...next } } as Partial<Card> })

  const toggleSort = () => {
    // Turning sorting on tidies the list in the same step.
    set(sorting() ? { sortDone: false } : { sortDone: true, items: settleItems(content().items) })
  }
  const clear = () => {
    const n = done()
    set({ items: clearDone(content().items) })
    setOpen(false)
    showToast(`Cleared ${n} done ${n === 1 ? 'task' : 'tasks'}`, 5000, { label: 'Undo', run: () => doc.undo() })
  }

  return (
    <>
      <button
        ref={trigger}
        class="bar-btn"
        data-testid="todo-options"
        aria-haspopup="menu"
        aria-expanded={open()}
        title="List options"
        // Focus moving to this button closes the menu before the click lands; remember.
        onPointerDown={() => (wasOpen = open())}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') wasOpen = open() }}
        onClick={toggle}
      >
        <Icon size={18}>{ToolIcons.sliders()}</Icon>
        List
      </button>
      <Show when={open()}>
        <Portal>
        <div ref={menu} class="menu todo-options-menu" role="menu" aria-label="List options" data-testid="todo-options-menu" style={{ left: `${at().left}px`, top: `${at().top}px` }} onPointerDown={(e) => e.stopPropagation()}>
          <div class="nav-menu-head sheet-only" aria-hidden="true"><strong>List options</strong></div>
          <button class="menu-item" role="menuitemcheckbox" aria-checked={sorting()} data-testid="todo-sort-done" onClick={toggleSort}>
            <span class="menu-check" aria-hidden="true"><Show when={sorting()}><Icon size={16}>{ToolIcons.check()}</Icon></Show></span>
            Sort done to the bottom
          </button>
          <button class="menu-item" role="menuitemcheckbox" aria-checked={!!content().hideDone} data-testid="todo-hide-done" onClick={() => set({ hideDone: !content().hideDone })}>
            <span class="menu-check" aria-hidden="true"><Show when={content().hideDone}><Icon size={16}>{ToolIcons.check()}</Icon></Show></span>
            Fold away done tasks
          </button>
          <div class="menu-sep" role="separator" />
          <button class="menu-item" role="menuitem" data-testid="todo-clear-done" disabled={!done()} onClick={clear}>
            <span class="menu-check" aria-hidden="true"><Icon size={16}>{ToolIcons.trash()}</Icon></span>
            {done() ? `Clear ${done()} done` : 'Nothing done yet'}
          </button>
        </div>
        </Portal>
      </Show>
    </>
  )
}
