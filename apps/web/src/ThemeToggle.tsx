import { nextMode, type ThemeMode } from '@doggynote/theme'
import { Icon } from './ui/icons.tsx'

const LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const ICON = { system: 'system', light: 'sun', dark: 'moon' } as const

export type ThemeToggleProps = { mode: ThemeMode; onThemeChange: (mode: ThemeMode) => void }

/**
 * Appearance is one icon button. Each press moves System → Light → Dark → System,
 * so the "follow my device" choice stays one press away.
 */
export function ThemeToggle(props: ThemeToggleProps & { class?: string }) {
  const next = () => nextMode(props.mode)
  return (
    <button
      type="button"
      class={`icon-btn theme-toggle ${props.class ?? ''}`}
      data-testid="theme-toggle"
      data-mode={props.mode}
      aria-label={`Appearance: ${LABEL[props.mode]}`}
      data-tooltip={`Appearance: ${LABEL[props.mode]}. Switch to ${LABEL[next()]}`}
      onClick={() => props.onThemeChange(next())}
    >
      <Icon name={ICON[props.mode]} />
    </button>
  )
}
