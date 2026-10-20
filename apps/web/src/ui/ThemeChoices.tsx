import { For } from 'solid-js'
import { THEME_MODES, type ThemeMode } from '@doggynote/theme'

export type ThemeChoicesProps = {
  mode: ThemeMode
  onThemeChange: (mode: ThemeMode) => void
}

const labels: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/** An explicit theme choice, shared by account and public-viewer menus. */
export function ThemeChoices(props: ThemeChoicesProps) {
  const move = (event: KeyboardEvent, index: number) => {
    let next: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % THEME_MODES.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + THEME_MODES.length - 1) % THEME_MODES.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = THEME_MODES.length - 1
    else return
    event.preventDefault()
    event.stopPropagation()
    const target = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]
    props.onThemeChange(THEME_MODES[next]!)
    target?.focus()
  }

  return (
    <div class="theme-choices" role="radiogroup" aria-label="Appearance">
      <For each={THEME_MODES}>{(mode, index) => (
        <button
          type="button"
          class="theme-choice"
          role="radio"
          aria-checked={props.mode === mode}
          tabIndex={props.mode === mode ? 0 : -1}
          onClick={() => props.onThemeChange(mode)}
          onKeyDown={(event) => move(event, index())}
        >{labels[mode]}</button>
      )}</For>
    </div>
  )
}
