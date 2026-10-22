import { SheetGrip } from './SheetGrip.tsx'
import { Show, createSignal, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { installMenu } from './menu.ts'

// A selection-bar button with a menu. The bar clips its contents, so the menu
// lives in a portal under the button (a bottom sheet on phones, via mobile.css).

export function BarMenu(props: {
  label: string
  title: string
  icon: JSX.Element
  testId: string
  menuTestId: string
  /** Menu contents; call `close` after an action. */
  children: (close: () => void) => JSX.Element
}) {
  const [open, setOpen] = createSignal(false)
  const [at, setAt] = createSignal({ left: 0, top: 0 })
  let menu!: HTMLDivElement
  let trigger!: HTMLButtonElement
  installMenu(open, () => setOpen(false), () => menu, () => trigger)
  // Focus moving to the button closes the menu before its click lands: remember.
  let wasOpen = false
  const close = () => setOpen(false)
  const toggle = () => {
    if (wasOpen) return close()
    const r = trigger.getBoundingClientRect()
    const width = 240
    const below = r.bottom + 6 + 160 < window.innerHeight
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: below ? r.bottom + 6 : r.top - 6 })
    setOpen(true)
    queueMicrotask(() => {
      if (!below && menu) setAt((a) => ({ ...a, top: r.top - 6 - menu.offsetHeight }))
    })
  }
  return (
    <>
      <button
        ref={trigger}
        class="bar-btn"
        data-testid={props.testId}
        aria-haspopup="menu"
        aria-expanded={open()}
        title={props.title}
        onPointerDown={() => (wasOpen = open())}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') wasOpen = open() }}
        onClick={toggle}
      >
        {props.icon}
        {props.label}
      </button>
      <Show when={open()}>
        <Portal>
          <div ref={menu} class="menu bar-menu" role="menu" aria-label={props.title} data-testid={props.menuTestId} style={{ left: `${at().left}px`, top: `${at().top}px` }} onPointerDown={(e) => e.stopPropagation()}><SheetGrip onDismiss={() => { close(); trigger.focus() }} />
            <div class="nav-menu-head sheet-only" aria-hidden="true"><strong>{props.title}</strong></div>
            {props.children(close)}
          </div>
        </Portal>
      </Show>
    </>
  )
}
