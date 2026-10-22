import './navigation.css'
import { Show, createSignal } from 'solid-js'
import type { ThemeMode } from '@doggynote/theme'
import { ThemeChoices } from './ThemeChoices.tsx'
import { Icon } from './icons.tsx'
import { installMenu } from './menu.ts'

export function ViewerMenu(props: { mode: ThemeMode; onThemeChange: (mode: ThemeMode) => void }) {
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement, trigger!: HTMLButtonElement
  installMenu(open, () => setOpen(false), () => root, () => trigger)
  return <div class="zoom" ref={root}>
    <button ref={trigger} class="icon-btn" data-testid="viewer-more" aria-label="More options" aria-expanded={open()} data-tooltip="More options" onClick={() => setOpen(!open())}><Icon name="more" /></button>
    <Show when={open()}><div class="menu nav-menu viewer-menu"><div class="account-menu-section-label">Appearance</div><ThemeChoices mode={props.mode} onThemeChange={props.onThemeChange} /></div></Show>
  </div>
}
