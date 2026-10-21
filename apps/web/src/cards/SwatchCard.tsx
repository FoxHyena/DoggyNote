import { Popover } from '../ui/Popover.tsx'
import { Icon, ToolIcons } from '../ui/icons.tsx'
import { cardEl } from '../canvas/layout.ts'
import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import { normalizeSwatchHex, swatchHex, swatchText, type Card } from '@doggynote/core'
import type { CardProps } from '../canvas/CardView.tsx'
import * as doc from '../state/doc.ts'
import { beginEdit, endEdit } from '../state/ui.ts'
import './swatch.css'

export function SwatchCard(props: CardProps<'swatch'>) {
  const hex = () => swatchHex(props.card)
  const draft = () => typeof props.card.swatchHexDraft === 'string' ? props.card.swatchHexDraft : null
  const invalid = () => draft() !== null && !normalizeSwatchHex(draft())
  const [copyState, setCopyState] = createSignal('Copy HEX')
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = async () => {
    const value = hex()
    try {
      // Copy synchronously within the gesture: async Clipboard may wait for a
      // permission prompt indefinitely in embedded/headless Chromium. WebKit's
      // embedded view also supports this selection-based path.
      const el = document.createElement('textarea')
      el.value = value
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.append(el)
      const focus = document.activeElement as HTMLElement | null
      let copied = false
      try {
        el.focus({ preventScroll: true })
        el.select()
        copied = document.execCommand('copy')
      } catch {
        // A blocked legacy clipboard path can throw rather than return false.
      } finally {
        el.remove()
        focus?.focus({ preventScroll: true })
      }
      if (!copied) {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
        await Promise.race([
          navigator.clipboard.writeText(value),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Clipboard unavailable')), 1500)),
        ])
      }
      setCopyState('Copied!')
    } catch { setCopyState('Select HEX to copy') }
    clearTimeout(timer)
    timer = setTimeout(() => setCopyState('Copy HEX'), 2200)
  }

  return <div class="color-card">
    <div class="color-card-paint" data-testid="swatch-paint" role="img" aria-label={`Color ${hex()}`} style={{ background: hex() }} />
    <div class="color-card-details">
      <h3 class="color-card-name" data-testid="swatch-name">{swatchText(props.card.swatchName) || 'Untitled color'}</h3>
      <code class="color-card-hex" data-testid="swatch-value" data-nodrag>{hex()}</code>
      <Show when={props.card.swatchCaption}><p class="color-card-caption">{swatchText(props.card.swatchCaption)}</p></Show>
      <Show when={invalid()}><p class="color-card-hint" data-export-exclude>Unfinished HEX edit saved</p></Show>
      <div class="color-card-actions" data-nodrag data-export-exclude onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (!e.metaKey && !e.ctrlKey) { if (e.key === 'Backspace' || e.key === 'Delete') e.preventDefault(); e.stopPropagation() } }}>
          <button type="button" class="bar-btn" data-testid="copy-swatch" onClick={copy} aria-live="polite">{copyState()}</button>
          <Show when={!props.readOnly}><button type="button" class="bar-btn bar-icon" data-testid="edit-swatch" aria-label="Edit color" data-tip="Edit color (or double-click the card)" onClick={() => beginEdit(props.card.id)}><Icon size={16}>{ToolIcons.edit()}</Icon></button></Show>
        </div>
      <Show when={props.editing && !props.readOnly}><SwatchEditor card={props.card} /></Show>
    </div>
  </div>
}

/** `<input type=color>` only takes lowercase #rrggbb. */
const pickerValue = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : /^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join('')}`.toLowerCase() : '#000000'

/** One bounded editor, outside world transforms, using the existing durable edit session. */
function SwatchEditor(props: { card: Card<'swatch'> }) {
  const hex = () => swatchHex(props.card)
  const draft = () => typeof props.card.swatchHexDraft === 'string' ? props.card.swatchHexDraft : null
  const invalid = () => draft() !== null && !normalizeSwatchHex(draft())
  const patch = (fields: Partial<Card>) => doc.transient(props.card.id, fields)
  const setHex = (raw: string) => {
    const valid = normalizeSwatchHex(raw)
    patch({ swatchHexDraft: raw, ...(valid ? { swatchHex: valid } : {}) })
  }
  onCleanup(() => queueMicrotask(() => cardEl(props.card.id)?.querySelector<HTMLButtonElement>('[data-testid="edit-swatch"]')?.focus()))
  // A panel beside the card, like Labels and Note copies; edits save as you type.
  return <Popover anchor={cardEl(props.card.id) ?? document.body} label="Edit color" class="color-editor-dialog" close={endEdit}>
    <div onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); endEdit() } }}>
      <div class="color-card-editor">
        {/* The preview is also the picker: click it for the system colour wheel. Keyboard users type HEX. */}
        <label class="color-editor-preview" data-tip="Pick a colour" style={{ background: hex() }}><input type="color" tabIndex={-1} data-testid="swatch-color-picker" aria-label="Pick a colour" value={pickerValue(hex())} onInput={(e) => setHex(e.currentTarget.value.toUpperCase())} /></label>
        <label>HEX<input ref={(el) => onMount(() => { el.focus(); el.select() })} data-testid="swatch-hex-input" spellcheck={false} autocomplete="off" maxlength={100} aria-invalid={!!invalid()} aria-describedby={`hex-hint-${props.card.id}`} value={draft() ?? hex()} onInput={(e) => setHex(e.currentTarget.value)} /></label>
        <p class="color-card-hint" classList={{ 'color-card-error': !!invalid() }} id={`hex-hint-${props.card.id}`} role={invalid() ? 'status' : undefined}>{invalid() ? `Use 3 or 6 HEX digits. Showing ${hex()}; your draft is saved.` : '3 or 6 HEX digits, with or without #'}</p>
        <label>Name<input data-testid="swatch-name-input" maxlength={1000} placeholder="e.g. Forest" value={swatchText(props.card.swatchName)} onInput={(e) => patch({ swatchName: e.currentTarget.value })} /></label>
        <label>Caption (optional)<textarea data-testid="swatch-caption-input" rows={2} maxlength={10000} placeholder="What is this color for?" value={swatchText(props.card.swatchCaption)} onInput={(e) => patch({ swatchCaption: e.currentTarget.value })} /></label>
      </div>
      <footer><button type="button" class="bar-btn bar-icon color-card-done" aria-label="Done" data-tip="Done (Escape)" onClick={endEdit}><Icon size={16}>{ToolIcons.check()}</Icon></button></footer>
    </div>
  </Popover>
}
