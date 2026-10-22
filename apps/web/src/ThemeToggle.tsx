import { Icon } from './ui/icons.tsx'
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
      <Icon name={props.mode === 'light' ? 'sun' : props.mode === 'dark' ? 'moon' : 'system'} />
      <span class="icon-btn-label">{LABEL[props.mode]}</span>
    </button>
  )
}
