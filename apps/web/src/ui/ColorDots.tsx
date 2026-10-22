import { For, Show, type JSX } from 'solid-js'
import { contrastRatio, normalizeSwatchHex } from '@doggynote/core'
import { surfaces } from '@doggynote/theme'
import { theme } from '../theme.ts'
import { Icon, ToolIcons } from './icons.tsx'
import './color-dots.css'

export type ColorDot = {
  value: string
  /** Accessible name and tooltip. */
  name: string
  /** The CSS colour to paint the dot with (a hex, or a theme variable). */
  paint: string
  /** Test hooks, e.g. `{ 'data-hex': '#FFFFFF' }`. */
  data?: Record<string, string>
}

/**
 * One row of colour dots with the system colour wheel in the last slot: the
 * shared picker for colour cards, labels, ink and sketch paper. The custom slot
 * shows a "+" until a colour outside the presets is chosen, then wears it.
 * Sizes come from `--cd-dot` and `--cd-gap` (24px and 8px; bigger for fingers).
 */
/** A colour too close to the panel to see its own edge (white in the day theme, charcoal in the den) gets a firmer one. */
const nearPanel = (paint: string | null) => !!paint && paint.startsWith('#') && contrastRatio(paint, surfaces[theme()].panel) < 1.5

export function ColorDots(props: {
  label: string
  dots: readonly ColorDot[]
  value: string | null
  onPick: (value: string) => void
  dotTestId: string
  /** The wheel. `value` is the custom colour when one is chosen (not a preset). */
  custom: { value: string | null; fallback: string; testid: string; onPick: (hex: string) => void; live?: boolean; autofocus?: boolean }
  /** Focus lands on the current dot when the panel opens. */
  autofocus?: boolean
  class?: string
  style?: JSX.CSSProperties
  onKeyDown?: (e: KeyboardEvent & { currentTarget: HTMLDivElement }) => void
}) {
  const pick = (raw: string) => {
    const hex = normalizeSwatchHex(raw)
    if (hex) props.custom.onPick(hex)
  }
  return (
    <div class={`color-dots ${props.class ?? ''}`} style={props.style} role="group" aria-label={props.label} onKeyDown={(e) => props.onKeyDown?.(e)}>
      <For each={props.dots}>
        {(d) => (
          <button
            type="button"
            class="color-dot"
            classList={{ on: props.value === d.value, edge: nearPanel(d.paint) }}
            style={{ '--dot': d.paint }}
            data-testid={props.dotTestId}
            {...d.data}
            data-autofocus={(props.autofocus && props.value === d.value) || undefined}
            aria-label={d.name}
            data-tip={d.name}
            aria-pressed={props.value === d.value}
            onClick={() => props.onPick(d.value)}
          />
        )}
      </For>
      <label class="color-dot color-custom" classList={{ on: !!props.custom.value, edge: nearPanel(props.custom.value) }} style={props.custom.value ? { '--dot': props.custom.value } : undefined} data-tip={props.custom.value ? `Custom colour ${props.custom.value}` : 'Custom colour'}>
        <Show when={!props.custom.value}>
          <Icon size={14}>{ToolIcons.plus()}</Icon>
        </Show>
        <input
          type="color"
          data-testid={props.custom.testid}
          data-autofocus={props.custom.autofocus || undefined}
          aria-label="Custom colour"
          value={(props.custom.value ?? props.custom.fallback).toLowerCase()}
          // The wheel fires input on every drag step; `live` follows it, otherwise it applies once on close.
          onInput={(e) => props.custom.live !== false && pick(e.currentTarget.value)}
          onChange={(e) => pick(e.currentTarget.value)}
        />
      </label>
    </div>
  )
}
