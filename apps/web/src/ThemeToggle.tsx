import { Match, Switch } from 'solid-js'
import type { ThemeMode } from '@doggynote/theme'

const LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' }

export function ThemeToggle(props: { mode: ThemeMode; onCycle: () => void }) {
  return (
    <button
      class="icon-btn"
      data-testid="theme-toggle"
      data-mode={props.mode}
      onClick={props.onCycle}
      title={`Theme: ${LABEL[props.mode]} (click to change)`}
      aria-label={`Theme: ${LABEL[props.mode]}`}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <Switch>
          <Match when={props.mode === 'light'}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </Match>
          <Match when={props.mode === 'dark'}>
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
          </Match>
          <Match when={props.mode === 'system'}>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </Match>
        </Switch>
      </svg>
      <span class="icon-btn-label">{LABEL[props.mode]}</span>
    </button>
  )
}
